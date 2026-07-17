import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const dist = join(root, "dist")
const expectedVersion = "1.0.12"
const expectedEgoVersion = "0.4.4.15"
const zip = join(dist, "terra-edu-application-agent-mac-arm64.zip")

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
const dialogGuard = join(app, "Contents/Resources/vendor/terra-dialog-guard/terra-dialog-guard")
requireExecutable(helper, "Packaged ego-browser helper")
requireExecutable(paddleOcr, "Packaged PaddleOCR executable")
requireExecutable(dialogGuard, "Packaged native dialog guard")
run("codesign", ["--verify", "--strict", dialogGuard], "Packaged native dialog guard code-signature verification")
assert(run("file", [dialogGuard], "Packaged native dialog guard architecture check").includes("arm64"), "Packaged native dialog guard must be arm64")
const dialogGuardLoadCommands = run("otool", ["-l", dialogGuard], "Packaged native dialog guard deployment-target check")
assert(dialogGuardLoadCommands.includes("minos 12.0"), "Packaged native dialog guard must retain the macOS 12 deployment target")

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
assert(asarBytes.includes(Buffer.from("TERRA_EGO_NATIVE_DIALOG_")), "Packaged app must report native dialog interception explicitly")
assert(asarBytes.includes(Buffer.from("application-agent_native_dialog")), "Packaged app must expose the native-dialog fallback to OpenCode")
assert(asarBytes.includes(Buffer.from("UPDATER_EXECUTABLE")), "Packaged app must reject any enabled bundled updater executable")
assert(asarBytes.includes(Buffer.from(`EGO_LITE_VENDOR_VERSION = \"${expectedEgoVersion}\"`)), "Packaged app must retain the ego lite version pin")

const zipEntries = run("unzip", ["-Z1", zip], "ZIP listing")
for (const suffix of [
  "/Contents/Info.plist",
  "/Contents/Resources/vendor/ego-lite/ego lite.app/Contents/Info.plist",
  `/Contents/Resources/vendor/ego-lite/ego lite.app/Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`,
  "/Contents/Resources/vendor/terra-paddleocr/terra-paddleocr",
  "/Contents/Resources/vendor/terra-dialog-guard/terra-dialog-guard",
]) {
  assert(zipEntries.split("\n").some((entry) => entry.endsWith(suffix)), `Final ZIP archive is missing ${suffix}`)
}
run("codesign", ["--verify", "--deep", "--strict", app], "Packaged app code-signature verification")

const extractedZip = mkdtempSync(join(tmpdir(), "terra-edu-package-"))
try {
  run("ditto", ["-x", "-k", zip, extractedZip], "Final ZIP extraction", 120_000)
  const archivedApp = join(extractedZip, basename(app))
  const archivedEgoLite = join(archivedApp, "Contents/Resources/vendor/ego-lite/ego lite.app")
  const archivedDialogGuard = join(archivedApp, "Contents/Resources/vendor/terra-dialog-guard/terra-dialog-guard")
  assert(existsSync(archivedEgoLite), "Final ZIP archive must preserve the bundled Ego Lite app")
  run("codesign", ["--verify", "--deep", "--strict", archivedApp], "Final ZIP app code-signature verification")
  run("codesign", ["--verify", "--deep", "--strict", archivedEgoLite], "Final ZIP Ego Lite code-signature verification")
  run("codesign", ["--verify", "--strict", archivedDialogGuard], "Final ZIP native dialog guard code-signature verification")
  const archivedEgoSignature = signatureDetails(archivedEgoLite)
  assert(archivedEgoSignature.includes("Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)"), "Final ZIP must preserve Citro's Ego Lite signature")
  assert(archivedEgoSignature.includes("TeamIdentifier=JGQLC6YQYJ"), "Final ZIP must preserve Citro's Ego Lite signing team")

  // The native Ego dialog fixture intentionally performs several isolated browser
  // rounds. A cold, signed browser launch can take roughly 30 seconds per round,
  // so its release budget must exceed the per-round failure diagnostics inside
  // the smoke script itself.
  const smoke = spawnSync("bun", [join(root, "scripts/verify-application-agent-gui-dialog.ts"), archivedApp], { encoding: "utf8", timeout: 420_000 })
  assert(
    smoke.status === 0,
    `Package is NOT DISTRIBUTION READY because the required GUI dialog smoke failed: ${smoke.stderr || smoke.stdout || smoke.error?.message || "unknown error"}`,
  )
  run("codesign", ["--verify", "--deep", "--strict", archivedApp], "Final ZIP app post-smoke code-signature verification")
  run("codesign", ["--verify", "--deep", "--strict", archivedEgoLite], "Final ZIP Ego Lite post-smoke code-signature verification")
} finally {
  rmSync(extractedZip, { recursive: true, force: true })
}

console.log("Application Agent macOS package verification passed.")
console.log(`App: ${app}`)
