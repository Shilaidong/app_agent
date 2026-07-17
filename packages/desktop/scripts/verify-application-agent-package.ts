import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const dist = join(root, "dist")
const expectedVersion = "1.0.12"
const expectedEgoVersion = "0.4.4.15"
const zip = join(dist, "terra-edu-application-agent-mac-arm64.zip")
const dmg = join(dist, "terra-edu-application-agent-mac-arm64.dmg")

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function plistValue(path: string, key: string) {
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path], { encoding: "utf8" })
  if (result.status !== 0) return undefined
  return result.stdout.trim()
}

function listPaths(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return [path, ...listPaths(path)]
    return entry.isFile() ? [path] : []
  })
}

function requireExecutable(path: string, label: string) {
  assert(existsSync(path), `Missing ${label}: ${path}`)
  assert((statSync(path).mode & 0o111) !== 0, `${label} is not executable: ${path}`)
}

function run(command: string, args: string[], label: string, timeout = 30_000) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout })
  assert(result.status === 0, `${label} failed: ${result.stderr || result.error?.message || "unknown error"}`)
  return result.stdout
}

function signatureDetails(path: string) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", path], { encoding: "utf8", timeout: 30_000 })
  assert(result.status === 0, `Could not read code signature for ${path}: ${result.stderr || result.error?.message || "unknown error"}`)
  return `${result.stdout}\n${result.stderr}`
}

function isUpdaterPayload(file: string) {
  return file.includes("/EgoUpdater.app/") || file.includes("/EgoSoftwareUpdate.bundle/") || file.endsWith("/com.citrolabs.ego.UpdaterPrivilegedHelper")
}

if (process.platform !== "darwin") throw new Error("macOS package verification must run on macOS")
assert(existsSync(zip), `Missing final ZIP archive: ${zip}`)
const macDirectory = join(dist, "mac-arm64")
assert(existsSync(macDirectory), `Missing unpacked macOS application directory: ${macDirectory}`)
const app = readdirSync(macDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
  .map((entry) => join(macDirectory, entry.name))
  .find((candidate) => plistValue(join(candidate, "Contents/Info.plist"), "CFBundleIdentifier") === "edu.terra.application-agent")
assert(app, "Missing packaged production Terra-Edu Application Agent.app")

const appInfo = join(app, "Contents/Info.plist")
assert(plistValue(appInfo, "CFBundleShortVersionString") === expectedVersion, `Packaged app must be version ${expectedVersion}`)
const egoLite = join(app, "Contents/Resources/vendor/ego-lite/ego lite.app")
const egoInfo = join(egoLite, "Contents/Info.plist")
assert(existsSync(egoInfo), "Packaged ego lite Info.plist is missing")
assert(plistValue(egoInfo, "CFBundleShortVersionString") === expectedEgoVersion, `Packaged ego lite must be ${expectedEgoVersion}`)
const helper = join(egoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`)
const paddleOcr = join(app, "Contents/Resources/vendor/terra-paddleocr/terra-paddleocr")
requireExecutable(helper, "Packaged ego-browser helper")
requireExecutable(paddleOcr, "Packaged PaddleOCR executable")
assert(!listPaths(app).some((path) => path.includes("/terra-dialog-guard")), "Packaged app must not contain the retired terra-dialog-guard")

const updaterFiles = listPaths(egoLite).filter((file) => statSync(file).isFile() && isUpdaterPayload(file))
assert(updaterFiles.length > 0, "Packaged ego lite must retain its original signed updater payload")
assert(!updaterFiles.some((file) => (statSync(file).mode & 0o111) !== 0), `Packaged ego lite contains an enabled updater executable: ${updaterFiles.filter((file) => (statSync(file).mode & 0o111) !== 0).join(", ")}`)
run("codesign", ["--verify", "--deep", "--strict", egoLite], "Packaged Ego Lite code-signature verification")
const egoSignature = signatureDetails(egoLite)
assert(egoSignature.includes("Identifier=com.citrolabs.ego.lite"), "Packaged Ego Lite must retain its official bundle identity")
assert(egoSignature.includes("Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)"), "Packaged Ego Lite must retain Citro's Developer ID signature")
assert(egoSignature.includes("TeamIdentifier=JGQLC6YQYJ"), "Packaged Ego Lite must retain Citro's signing team")
const asar = join(app, "Contents/Resources/app.asar")
assert(existsSync(asar), "Packaged app.asar is missing")
const asarBytes = readFileSync(asar)
assert(!asarBytes.includes(Buffer.from("terra-dialog-guard")), "Packaged app.asar must not reference the retired terra-dialog-guard")
assert(!asarBytes.includes(Buffer.from("application-agent_native_dialog")), "Packaged app.asar must not expose the retired native-dialog tool")
assert(!asarBytes.includes(Buffer.from("TERRA_EGO_NATIVE_DIALOG")), "Packaged app.asar must not contain the retired native-dialog wrapper protocol")
assert(asarBytes.includes(Buffer.from("--no-default-browser-check")), "Packaged app must pass --no-default-browser-check to ego lite")
assert(asarBytes.includes(Buffer.from("--no-first-run")), "Packaged app must pass --no-first-run to ego lite")
assert(asarBytes.includes(Buffer.from('"$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"')) && asarBytes.includes(Buffer.from('RUNTIME_ROOT=${runtimeRoot}')), "Packaged app must isolate mutable Ego runtime files outside the signed app")
assert(asarBytes.includes(Buffer.from('/usr/bin/ditto "$APP_PATH" "$STAGED_APP"')), "Packaged app must copy the signed Ego source before launch")
assert(asarBytes.includes(Buffer.from('open -n -gj "$RUNTIME_APP"')), "Packaged app must launch its managed Ego Lite runtime")
assert(asarBytes.includes(Buffer.from('/usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/"')), "Packaged app must reuse its managed Ego Lite runtime across browser rounds")
assert(asarBytes.includes(Buffer.from("taskspace list")), "Packaged app must verify bundled Ego Lite readiness before browser work")
assert(asarBytes.includes(Buffer.from("helper_status=$?")), "Packaged app must translate a service conflict that happens after readiness")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_BROWSER_VERSION_CONFLICT")), "Packaged app must report an incompatible external Ego Lite service instead of using it")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE")), "Packaged app must leave an external compatible Ego Lite service untouched")
assert(asarBytes.includes(Buffer.from("UPDATER_EXECUTABLE")), "Packaged app must reject any enabled bundled updater executable")
assert(asarBytes.includes(Buffer.from(`EGO_LITE_VENDOR_VERSION = \"${expectedEgoVersion}\"`)), "Packaged app must retain the ego lite version pin")

const zipEntries = run("unzip", ["-Z1", zip], "ZIP listing").split("\n")
assert(!zipEntries.some((entry) => entry.includes("terra-dialog-guard")), "Final ZIP archive must not contain the retired terra-dialog-guard")
for (const suffix of [
  "/Contents/Info.plist",
  "/Contents/Resources/vendor/ego-lite/ego lite.app/Contents/Info.plist",
  `/Contents/Resources/vendor/ego-lite/ego lite.app/Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`,
  "/Contents/Resources/vendor/terra-paddleocr/terra-paddleocr",
]) {
  assert(zipEntries.some((entry) => entry.endsWith(suffix)), `Final ZIP archive is missing ${suffix}`)
}
run("codesign", ["--verify", "--deep", "--strict", app], "Packaged app code-signature verification")

if (existsSync(dmg)) {
  const mountRoot = realpathSync(mkdtempSync(join(tmpdir(), "terra-edu-dmg-")))
  const mountPoint = join(mountRoot, "volume")
  mkdirSync(mountPoint)
  const attach = spawnSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, dmg], {
    encoding: "utf8",
    timeout: 120_000,
  })
  try {
    assert(attach.status === 0, `DMG read-only attach failed: ${attach.stderr || attach.error?.message || "unknown error"}`)
    const mountedApp = listPaths(mountPoint)
      .filter((candidate) => candidate.endsWith(".app"))
      .find((candidate) => plistValue(join(candidate, "Contents/Info.plist"), "CFBundleIdentifier") === "edu.terra.application-agent")
    assert(mountedApp, "DMG is missing the edu.terra.application-agent app")
    assert(plistValue(join(mountedApp, "Contents/Info.plist"), "CFBundleShortVersionString") === expectedVersion, `DMG app must be version ${expectedVersion}`)
    const mountedEgoLite = join(mountedApp, "Contents/Resources/vendor/ego-lite/ego lite.app")
    const mountedEgoInfo = join(mountedEgoLite, "Contents/Info.plist")
    assert(existsSync(mountedEgoInfo), "DMG app is missing the bundled Ego Lite Info.plist")
    assert(plistValue(mountedEgoInfo, "CFBundleShortVersionString") === expectedEgoVersion, `DMG Ego Lite must be ${expectedEgoVersion}`)
    requireExecutable(
      join(mountedEgoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`),
      "DMG Ego Browser helper",
    )
    requireExecutable(join(mountedApp, "Contents/Resources/vendor/terra-paddleocr/terra-paddleocr"), "DMG PaddleOCR executable")
    const mountedAsar = join(mountedApp, "Contents/Resources/app.asar")
    assert(existsSync(mountedAsar), "DMG app.asar is missing")
    assert(
      createHash("sha256").update(readFileSync(mountedAsar)).digest("hex") === createHash("sha256").update(asarBytes).digest("hex"),
      "DMG app.asar must match the verified dist/mac-arm64 app.asar",
    )
    run("codesign", ["--verify", "--deep", "--strict", mountedApp], "DMG app code-signature verification")
    run("codesign", ["--verify", "--deep", "--strict", mountedEgoLite], "DMG Ego Lite code-signature verification")
  } finally {
    const detach = spawnSync("hdiutil", ["detach", mountPoint], { encoding: "utf8", timeout: 30_000 })
    const forcedDetach = detach.status === 0 ? undefined : spawnSync("hdiutil", ["detach", "-force", mountPoint], { encoding: "utf8", timeout: 30_000 })
    const mounts = spawnSync("/sbin/mount", [], { encoding: "utf8", timeout: 5_000 })
    const stillMounted = mounts.status === 0
      ? mounts.stdout.split("\n").some((line) => line.includes(` on ${mountPoint} (`))
      : attach.status === 0 && detach.status !== 0 && forcedDetach?.status !== 0
    if (!stillMounted) rmSync(mountRoot, { recursive: true, force: true })
    assert(!stillMounted, `DMG detach failed: ${forcedDetach?.stderr || detach.stderr || forcedDetach?.error?.message || detach.error?.message || "unknown error"}`)
  }
}

const guiSmokeScript = join(root, "scripts/verify-application-agent-gui-dialog.ts")
const guiSmokeSource = readFileSync(guiSmokeScript, "utf8")
assert(!guiSmokeSource.includes("application-agent-opencode"), "GUI dialog smoke must not import application-agent-opencode from unpackaged source")
for (const marker of [
  "--terra-package-smoke-write-opencode",
  "TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN",
  "TERRA_EDU_PACKAGE_SMOKE_WORKSPACE",
  "TERRA_EDU_PACKAGE_SMOKE_RUNTIME_ROOT",
]) {
  assert(guiSmokeSource.includes(marker), `GUI dialog smoke is missing packaged config probe marker: ${marker}`)
}

const extractedZip = mkdtempSync(join(tmpdir(), "terra-edu-package-"))
try {
  run("ditto", ["-x", "-k", zip, extractedZip], "Final ZIP extraction", 120_000)
  const archivedApp = join(extractedZip, basename(app))
  const archivedEgoLite = join(archivedApp, "Contents/Resources/vendor/ego-lite/ego lite.app")
  const archivedAsarBytes = readFileSync(join(archivedApp, "Contents/Resources/app.asar"))
  assert(existsSync(archivedEgoLite), "Final ZIP archive must preserve the bundled Ego Lite app")
  assert(!listPaths(archivedApp).some((path) => path.includes("/terra-dialog-guard")), "Final ZIP app must not contain the retired terra-dialog-guard")
  assert(!archivedAsarBytes.includes(Buffer.from("terra-dialog-guard")), "Final ZIP app.asar must not reference the retired terra-dialog-guard")
  assert(!archivedAsarBytes.includes(Buffer.from("application-agent_native_dialog")), "Final ZIP app.asar must not expose the retired native-dialog tool")
  assert(!archivedAsarBytes.includes(Buffer.from("TERRA_EGO_NATIVE_DIALOG")), "Final ZIP app.asar must not contain the retired native-dialog wrapper protocol")
  run("codesign", ["--verify", "--deep", "--strict", archivedApp], "Final ZIP app code-signature verification")
  run("codesign", ["--verify", "--deep", "--strict", archivedEgoLite], "Final ZIP Ego Lite code-signature verification")
  const archivedEgoSignature = signatureDetails(archivedEgoLite)
  assert(archivedEgoSignature.includes("Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)"), "Final ZIP must preserve Citro's Ego Lite signature")
  assert(archivedEgoSignature.includes("TeamIdentifier=JGQLC6YQYJ"), "Final ZIP must preserve Citro's Ego Lite signing team")

  // Exercise the dialog behavior through the app extracted from the final ZIP,
  // while keeping the signed Ego source immutable.
  const smoke = spawnSync("bun", [join(root, "scripts/verify-application-agent-gui-dialog.ts"), archivedApp], { encoding: "utf8", timeout: 420_000 })
  assert(
    smoke.status === 0,
    `Package is NOT DISTRIBUTION READY because the required Ego dialog smoke failed: ${smoke.stderr || smoke.stdout || smoke.error?.message || "unknown error"}`,
  )
  run("codesign", ["--verify", "--deep", "--strict", archivedApp], "Final ZIP app post-smoke code-signature verification")
  run("codesign", ["--verify", "--deep", "--strict", archivedEgoLite], "Final ZIP Ego Lite post-smoke code-signature verification")
} finally {
  rmSync(extractedZip, { recursive: true, force: true })
}

console.log("Application Agent macOS package verification passed.")
console.log(`App: ${app}`)
