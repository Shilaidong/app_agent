import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { readEgoRuntimeLock, verifyEgoRuntime } from "./ego-runtime-lock"

const root = fileURLToPath(new URL("..", import.meta.url))
const dist = join(root, "dist")
const expectedVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version
assert(expectedVersion, "Desktop package.json must contain a version")
const egoRuntimeLock = await readEgoRuntimeLock()
const expectedEgoVersion = egoRuntimeLock.version
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

const EGO_BROWSER_SERVICE_LABEL = "com.citrolabs.ego.lite.ego-browser"
// Patterns that the GUI dialog preflight treats as "another Ego is active".
// Keep these aligned with verify-application-agent-gui-dialog.ts.
const EGO_LITE_PROCESS_PATTERNS = ["ego lite.app/Contents/", "/Helpers/ego-browser"] as const
// CI runners have no interactive Ego session worth protecting. Local package
// verification still refuses to clobber a real consultant Ego unless explicitly opted in.
const purgePackageSmokeResiduals =
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true" ||
  process.env.TERRA_EDU_GUI_SMOKE_PURGE_RESIDUALS === "1"

function macUid() {
  const user = spawnSync("/usr/bin/id", ["-u"], { encoding: "utf8" })
  assert(user.status === 0, `Could not read the macOS user ID: ${user.stderr || user.error?.message || "unknown error"}`)
  return user.stdout.trim()
}

function pidsMatching(pattern: string) {
  const result = spawnSync("/usr/bin/pgrep", ["-f", pattern], { encoding: "utf8" })
  assert(result.status === 0 || result.status === 1, `Could not inspect processes matching ${pattern}: ${result.stderr || result.error?.message || "unknown error"}`)
  return result.stdout
    .split("\n")
    .map((value) => Number(value.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function exactRuntimePids(runtimeRoot: string) {
  const escapedRuntimeRoot = runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return pidsMatching(`(${escapedRuntimeRoot}/|${escapedRuntimeRoot}([[:space:]]|$))`)
}

function egoLiteResidualPids() {
  return [...new Set(EGO_LITE_PROCESS_PATTERNS.flatMap((pattern) => pidsMatching(pattern)))]
}

// Prefer printing the exact service target. Grepping `launchctl print gui/<uid>`
// for a substring is brittle: the domain dump is large and macOS error text for a
// missing service also contains the label.
function hasEgoBrowserLaunchdService() {
  const printed = spawnSync("/bin/launchctl", ["print", `gui/${macUid()}/${EGO_BROWSER_SERVICE_LABEL}`], {
    encoding: "utf8",
    timeout: 5_000,
  })
  const text = `${printed.stdout}${printed.stderr}`
  if (/Could not find service/i.test(text) || /no such process/i.test(text)) return false
  return text.includes("= {") || /state\s*=/.test(text)
}

function citrolabsEgoLaunchdLabels() {
  const domain = spawnSync("/bin/launchctl", ["print", `gui/${macUid()}`], {
    encoding: "utf8",
    timeout: 5_000,
  })
  if (domain.status !== 0) return [EGO_BROWSER_SERVICE_LABEL]
  const labels = new Set<string>([EGO_BROWSER_SERVICE_LABEL])
  for (const match of domain.stdout.matchAll(/\b(com\.citrolabs\.[A-Za-z0-9._-]*ego[A-Za-z0-9._-]*)\b/gi)) {
    labels.add(match[1])
  }
  return [...labels]
}

function bootoutEgoLaunchdServices() {
  const uid = macUid()
  for (const label of citrolabsEgoLaunchdLabels()) {
    spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/${label}`], { encoding: "utf8", timeout: 5_000 })
    spawnSync("/bin/launchctl", ["kill", "SIGKILL", `gui/${uid}/${label}`], { encoding: "utf8", timeout: 5_000 })
  }
}

async function killPids(pids: number[]) {
  for (const pid of pids) spawnSync("/bin/kill", ["-KILL", String(pid)], { encoding: "utf8" })
}

async function killExactRuntimeProcesses(runtimeRoot: string) {
  let emptyScans = 0
  for (let attempt = 1; attempt <= 24; attempt++) {
    await killPids(exactRuntimePids(runtimeRoot))
    await Bun.sleep(250)
    const remaining = exactRuntimePids(runtimeRoot)
    emptyScans = remaining.length === 0 ? emptyScans + 1 : 0
    if (emptyScans >= 3) return []
  }
  return exactRuntimePids(runtimeRoot)
}

// Kill every Ego Lite / helper process the dialog preflight recognizes — not just
// the archived-zip path. Helpers may keep the dist/mac-arm64 vendor path, a
// managed Application Support runtime, or only "ego-browser" on the command line.
async function killAllEgoLiteProcesses() {
  let emptyScans = 0
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const pids = egoLiteResidualPids()
    await killPids(pids)
    await Bun.sleep(250)
    emptyScans = pids.length === 0 ? emptyScans + 1 : 0
    if (emptyScans >= 3) return []
  }
  return egoLiteResidualPids()
}

// Clear launchd first so KeepAlive cannot respawn helpers while we SIGKILL them,
// then kill processes, then re-check. Used as CI pre-flight and post-attempt cleanup.
async function purgeEgoSmokeResiduals(label: string) {
  bootoutEgoLaunchdServices()
  const lingeringRuntimeAgnostic = await killAllEgoLiteProcesses()
  bootoutEgoLaunchdServices()
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const pids = egoLiteResidualPids()
    const service = hasEgoBrowserLaunchdService()
    if (pids.length === 0 && !service) {
      if (attempt === 1) console.log(`GUI smoke residual purge (${label}): clean`)
      else console.log(`GUI smoke residual purge (${label}): clean after ${attempt} polls`)
      return { ok: true as const, pids, service: false }
    }
    if (service) bootoutEgoLaunchdServices()
    if (pids.length > 0) await killPids(pids)
    await Bun.sleep(250)
  }
  const pids = egoLiteResidualPids()
  const service = hasEgoBrowserLaunchdService()
  console.log(
    `GUI smoke residual purge (${label}): incomplete (pids=${pids.join(",") || "none"}; service=${service}; priorAgnostic=${lingeringRuntimeAgnostic.join(",") || "none"})`,
  )
  return { ok: pids.length === 0 && !service, pids, service }
}

async function waitForEgoBrowserLaunchdServiceRemoval() {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    if (!hasEgoBrowserLaunchdService()) return true
    if (attempt === 1 || attempt % 4 === 0) bootoutEgoLaunchdServices()
    if (attempt < 40) await Bun.sleep(250)
  }
  return false
}

const diagnosticReports = join(process.env.HOME || "", "Library/Logs/DiagnosticReports")

function egoCrashReports() {
  if (!existsSync(diagnosticReports)) return new Map<string, string>()
  return new Map(
    [diagnosticReports, join(diagnosticReports, "Retired")]
      .filter((directory) => existsSync(directory))
      .flatMap((directory) =>
        readdirSync(directory)
          .filter((name) => /^ego (?:lite|helper).*\.ips$/i.test(name))
          .map((name) => {
            const report = statSync(join(directory, name))
            return [directory === diagnosticReports ? name : `Retired/${name}`, `${report.mtimeMs}:${report.size}`] as const
          }),
      ),
  )
}

async function newStableEgoCrashReports(baseline: Map<string, string>) {
  let previousFingerprint = ""
  let stableScans = 0
  for (let attempt = 1; attempt <= 30; attempt++) {
    const reports = egoCrashReports()
    const fingerprint = JSON.stringify([...reports].sort(([left], [right]) => left.localeCompare(right)))
    stableScans = fingerprint === previousFingerprint ? stableScans + 1 : 0
    previousFingerprint = fingerprint
    if (attempt >= 20 && stableScans >= 4) {
      return [...reports].filter(([name, value]) => baseline.get(name) !== value).map(([name]) => name)
    }
    await Bun.sleep(500)
  }
  return [...egoCrashReports()].filter(([name, value]) => baseline.get(name) !== value).map(([name]) => name)
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
await verifyEgoRuntime(egoLite, egoRuntimeLock)
const helper = join(egoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`)
const paddleOcr = join(app, "Contents/Resources/vendor/terra-paddleocr/terra-paddleocr")
requireExecutable(helper, "Packaged ego-browser helper")
requireExecutable(paddleOcr, "Packaged PaddleOCR executable")
assert(!listPaths(app).some((path) => path.includes("/terra-dialog-guard")), "Packaged app must not contain the retired terra-dialog-guard")

const asar = join(app, "Contents/Resources/app.asar")
assert(existsSync(asar), "Packaged app.asar is missing")
const asarBytes = readFileSync(asar)
assert(!asarBytes.includes(Buffer.from("terra-dialog-guard")), "Packaged app.asar must not reference the retired terra-dialog-guard")
assert(!asarBytes.includes(Buffer.from("application-agent_native_dialog")), "Packaged app.asar must not expose the retired native-dialog tool")
assert(!asarBytes.includes(Buffer.from("TERRA_EGO_NATIVE_DIALOG")), "Packaged app.asar must not contain the retired native-dialog protocol")
assert(asarBytes.includes(Buffer.from("--no-default-browser-check")), "Packaged app must pass --no-default-browser-check to ego lite")
assert(asarBytes.includes(Buffer.from("--no-first-run")), "Packaged app must pass --no-first-run to ego lite")
assert(asarBytes.includes(Buffer.from("--password-store=basic")) && asarBytes.includes(Buffer.from("--use-mock-keychain")), "Packaged app must avoid blocking macOS ego keychain dialogs during managed Ego launches")
assert(asarBytes.includes(Buffer.from('EGO_CONFIG="$EGO_USER_DATA_ROOT/ego_config.json"')) && asarBytes.includes(Buffer.from('{"not_first_run":true}')), "Packaged app must initialize a fresh Ego profile without interactive onboarding")
assert(asarBytes.includes(Buffer.from('/usr/bin/plutil -extract not_first_run raw')) && asarBytes.includes(Buffer.from('/usr/bin/mktemp "$EGO_USER_DATA_ROOT/.ego_config.terra.XXXXXX"')) && asarBytes.includes(Buffer.from('/bin/ln "$EGO_CONFIG_STAGED" "$EGO_CONFIG"')), "Packaged app must validate and atomically create Ego onboarding state without clobbering an existing config")
assert(asarBytes.includes(Buffer.from('"$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"')) && asarBytes.includes(Buffer.from('RUNTIME_ROOT=${runtimeRoot}')), "Packaged app must isolate mutable Ego runtime files outside the signed app")
assert(asarBytes.includes(Buffer.from('/usr/bin/ditto "$APP_PATH" "$STAGED_APP"')), "Packaged app must copy the signed Ego source before launch")
assert(asarBytes.includes(Buffer.from('/usr/bin/open --env "HOME=$HOME" --env "CFFIXED_USER_HOME=$CFFIXED_USER_HOME"')) && asarBytes.includes(Buffer.from('-n -gj "$RUNTIME_APP"')), "Packaged app must launch managed Ego Lite with the isolated HOME/CFFIXED_USER_HOME cold-start environment")
assert(asarBytes.includes(Buffer.from('/usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/"')), "Packaged app must reuse its managed Ego Lite runtime across browser rounds")
assert(asarBytes.includes(Buffer.from("taskspace list")), "Packaged app must verify bundled Ego Lite readiness before browser work")
assert(asarBytes.includes(Buffer.from("helper_status=$?")), "Packaged app must translate a service conflict that happens after readiness")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_BROWSER_VERSION_CONFLICT")), "Packaged app must report an incompatible external Ego Lite service instead of using it")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE")), "Packaged app must leave an external compatible Ego Lite service untouched")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_SCRIPT_FAILED")), "Packaged app must propagate hidden Ego nodejs failures")
assert(asarBytes.includes(Buffer.from("UPDATER_EXECUTABLE")), "Packaged app must reject any enabled bundled updater executable")
assert(asarBytes.includes(Buffer.from(egoRuntimeLock.egoBrowserHelperSha256)), "Packaged app must retain the exact Ego helper hash pin")
assert(asarBytes.includes(Buffer.from(egoRuntimeLock.officialSkill.sha256)), "Packaged app must retain the authoritative Ego Skill hash pin")
assert(asarBytes.includes(Buffer.from(egoRuntimeLock.terraPolicyRevision)), "Packaged app must retain the Terra browser-policy revision")
assert(asarBytes.includes(Buffer.from("qwen3.7-plus")), "Packaged app must use Qwen 3.7 Plus for application sessions")
assert(asarBytes.includes(Buffer.from("completeTaskSpace(taskSpaceId, { keep: true })")) && asarBytes.includes(Buffer.from("一律不得使用 keep:false")), "Packaged app must preserve completed Ego windows and forbid the crashing close path")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE")) && asarBytes.includes(Buffer.from("EGO_NODE_STDIN_COMPACT")), "Packaged app must reject destructive nodejs close scripts before launching Ego")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_UNSAFE_PAGE_RELOAD")) && asarBytes.includes(Buffer.from("completeTaskSpace 只能使用可验证的字面量")), "Packaged app must reject automatic reloads and every unverifiable completion form before launching Ego")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_SCRIPTED_SUBMIT_DENIED")) && asarBytes.includes(Buffer.from("TERRA_EGO_SAVE_MUST_USE_OBSERVE_PAGE_ACTION")) && asarBytes.includes(Buffer.from("TERRA_EGO_NATIVE_ALERT_CLICK_DENIED")) && asarBytes.includes(Buffer.from("TERRA_EGO_ALERT_MUST_END_ROUND")) && asarBytes.includes(Buffer.from("TERRA_EGO_SYNTHETIC_DOM_EVENT_DENIED")) && asarBytes.includes(Buffer.from("TERRA_EGO_UNAUTHORIZED_TAKEOVER")) && asarBytes.includes(Buffer.from("TERRA_EGO_SELECT_FILLINPUT_DENIED")) && asarBytes.includes(Buffer.from("selectOptionByKeyboard")), "Packaged app must reject scripted submit, bare Save/Continue clicks, native-alert OK clicks, same-round fill-after-dialog, synthetic DOM events, unauthorized takeOver, and select fillInput; must ship selectOptionByKeyboard")
assert(asarBytes.includes(Buffer.from("Major is required.")) && asarBytes.includes(Buffer.from("本页落盘/前进控件")) && asarBytes.includes(Buffer.from("dismiss_js_alert")) && asarBytes.includes(Buffer.from("PAGE_LEFT_WITHOUT_SAVE_EVIDENCE")), "Packaged app must ship the page-commit, dismiss_js_alert, and leave-without-save policy")
assert(asarBytes.includes(Buffer.from("先填完再查")) && asarBytes.includes(Buffer.from("Academic/Add Institution")) && asarBytes.includes(Buffer.from("未填完禁止 Save")), "Packaged app must ship fill-then-verify and Academic hard-block hotspot policy")
assert(asarBytes.includes(Buffer.from("dismissJsAlertViaAx")) || asarBytes.includes(Buffer.from("JS_ALERT_AX_JXA")), "Packaged app must ship the JS-alert Accessibility helper")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_TASKSPACE_CONTAMINATED")) && asarBytes.includes(Buffer.from("exit 82")), "Packaged app must hard-stop contaminated task spaces in the managed wrapper")
assert(asarBytes.includes(Buffer.from("TERRA_EGO_ALERT_EVIDENCE_LOST")) && asarBytes.includes(Buffer.from("exit 83")), "Packaged app must hard-stop lost alert evidence in the managed wrapper with a distinct marker")
assert(asarBytes.includes(Buffer.from("record_browser_safety_stop")) && asarBytes.includes(Buffer.from("resolve_browser_safety_stop")), "Packaged app must include structured browser safetyStop CUA actions")
assert(asarBytes.includes(Buffer.from("BROWSER_SAFETY_DESKTOP_AUTHORIZATION_REQUIRED")), "Packaged app must require desktop authorization for alert_evidence_lost continue")
assert(asarBytes.includes(Buffer.from("authorizeBrowserSafetyContinue")) || asarBytes.includes(Buffer.from("authorize-browser-safety-continue")), "Packaged app must expose a desktop IPC path for trusted safety continue")
assert(!asarBytes.includes(Buffer.from("browser_safety_stop.json")), "Packaged app must keep one safetyStop truth in application_progress.json")
assert(asarBytes.includes(Buffer.from("Never reload an application page")) && asarBytes.includes(Buffer.from("never close tabs programmatically")) && asarBytes.includes(Buffer.from("Further filling requires the advisor to choose 重新填写")), "Packaged app must generate conflict-free managed Ego guidance with terminal completion")
assert(!asarBytes.includes(Buffer.from("NODE_OPTIONS=--permission")) && !asarBytes.includes(Buffer.from("/usr/bin/sandbox-exec")) && !asarBytes.includes(Buffer.from("TERRA_EGO_NODE_PERMISSION_")), "Packaged app must keep direct Ego service startup free of the retired permission middleware")
assert(asarBytes.includes(Buffer.from("egoBrowserTestHelperPath")) && asarBytes.includes(Buffer.from("TEST_HELPER_PATH=''")), "Packaged production wrapper generation must compile TEST_HELPER_PATH to an empty literal by default")
assert(!asarBytes.includes(Buffer.from("TERRA_EGO_BROWSER_TEST_HELPER")), "Packaged production wrappers must not accept a test helper path from the environment")
assert(asarBytes.includes(Buffer.from("BROWSER_TASK_ALREADY_COMPLETED")) && asarBytes.includes(Buffer.from("TERRA_EGO_COMPLETION_HELPER_FAILED:")) && asarBytes.includes(Buffer.from("BROWSER_TASK_FINALIZATION_FAILED")) && asarBytes.includes(Buffer.from("completionHelperFailedAt")), "Packaged app must atomically archive a failed final helper call and terminally lock that browser session")
assert(
  asarBytes.includes(Buffer.from("Multimodal reasoning model for visual analysis, planning, and tool use")),
  "Packaged app must include the Qwen 3.7 Plus model catalog in an empty customer cache",
)

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
    await verifyEgoRuntime(mountedEgoLite, egoRuntimeLock)
    assert(!listPaths(mountedApp).some((path) => path.includes("/terra-dialog-guard")), "DMG app must not contain the retired terra-dialog-guard")
    requireExecutable(join(mountedApp, "Contents/Resources/vendor/terra-paddleocr/terra-paddleocr"), "DMG PaddleOCR executable")
    const mountedAsar = join(mountedApp, "Contents/Resources/app.asar")
    assert(existsSync(mountedAsar), "DMG app.asar is missing")
    assert(
      createHash("sha256").update(readFileSync(mountedAsar)).digest("hex") === createHash("sha256").update(asarBytes).digest("hex"),
      "DMG app.asar must match the verified dist/mac-arm64 app.asar",
    )
    run("codesign", ["--verify", "--deep", "--strict", mountedApp], "DMG app code-signature verification")
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
// soft-coverage: source must keep these product paths, but runtime may soft-skip them.
for (const marker of [
  "--terra-package-smoke-write-opencode",
  "TERRA_EDU_PACKAGE_SMOKE_WRITE_OPENCODE",
  "TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN",
  "TERRA_EDU_PACKAGE_SMOKE_WORKSPACE",
  "TERRA_EDU_PACKAGE_SMOKE_RUNTIME_ROOT",
  "TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT",
  "single-launch.claim",
  "TERRA_EGO_DIALOG_SMOKE_COLD_START",
  "TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_CAPTURED",
  "TERRA_EGO_DIALOG_SMOKE_NAVIGATION_IFRAME_ALERT_CAPTURED",
  "TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ROUND_ENDED",
  "TERRA_EGO_DIALOG_SMOKE_ALERT_REOBSERVED",
  "TERRA_EGO_DIALOG_SMOKE_DELAYED_ALERT_AFTER_ACTION",
  "TERRA_EGO_DIALOG_SMOKE_IFRAME_TEXT",
  "TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED",
  "TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_REOBSERVED",
  "TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_HANDOFF",
  "TERRA_EGO_DIALOG_SMOKE_PROMPT_HANDOFF",
]) {
  assert(guiSmokeSource.includes(marker), `GUI dialog smoke is missing soft-coverage packaged behavior marker in source: ${marker}`)
}
// hard-runtime markers are also required in source; final ZIP smoke asserts them on stdout below.
for (const marker of [
  "TERRA_EGO_DIALOG_SMOKE_COLD_OBSERVATION",
  "TERRA_EGO_VISUAL_SCREENSHOT_VERIFIED",
  "TERRA_EGO_NETWORK_EVENT_SHAPE_FETCH_POST",
  "TERRA_EGO_NETWORK_EVENT_SHAPE_DOCUMENT_POST",
  "TERRA_EGO_NETWORK_EVENT_SHAPE_IFRAME_DOCUMENT_REDIRECT",
  "TERRA_EGO_DIALOG_SMOKE_COMPLETE_KEEP_TRUE",
  "TERRA_EGO_DIALOG_SMOKE_PAGE_PRESERVED",
  "TERRA_EGO_DIALOG_SMOKE_PROCESS_PRESERVED_AFTER_COMPLETION",
]) {
  assert(guiSmokeSource.includes(marker), `GUI dialog smoke is missing hard-runtime packaged behavior marker in source: ${marker}`)
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
  assert(!archivedAsarBytes.includes(Buffer.from("TERRA_EGO_NATIVE_DIALOG")), "Final ZIP app.asar must not contain the retired native-dialog protocol")
  run("codesign", ["--verify", "--deep", "--strict", archivedApp], "Final ZIP app code-signature verification")
  await verifyEgoRuntime(archivedEgoLite, egoRuntimeLock)

  // Exercise direct Ego dialog handling through the app extracted from the
  // final ZIP while keeping the signed Ego source immutable. The parent owns
  // this canonical root so timeout and failure paths receive the same cleanup.
  // Retry once or twice for known-transient Ego CDP/keychain cold-start races;
  // never treat those retries as a fake pass of product semantics.
  //
  // CI history (1.1.3–1.1.7): attempt 1 often dies in ~7s with EXTERNAL_SERVICE
  // *before* Ego is launched. Residual processes under dist/mac-arm64 or a prior
  // managed runtime are invisible to path-scoped cleanup of the extracted zip.
  // On CI we therefore purge every Ego residual before each attempt.
  let smoke: ReturnType<typeof spawnSync> | undefined
  let lastSmokeFailure = ""
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (purgePackageSmokeResiduals) {
      const preflight = await purgeEgoSmokeResiduals(`pre-attempt-${attempt}`)
      if (!preflight.ok) {
        lastSmokeFailure = `Could not clear Ego residuals before GUI smoke (pids=${preflight.pids.join(",") || "none"}; service=${preflight.service})`
        console.log(`GUI smoke attempt ${attempt}/3 failed: ${lastSmokeFailure}`)
        if (attempt === 3) break
        continue
      }
    }
    const guiRuntimeRoot = realpathSync(mkdtempSync(join(tmpdir(), "terra-edu-direct-dialog-runtime-")))
    console.log(`GUI smoke runtime root (attempt ${attempt}/3): ${guiRuntimeRoot}`)
    const crashReportsBeforeGuiSmoke = egoCrashReports()
    // Cleanup assertions (lingering processes, launchd service, crash reports)
    // are collected as a failure string instead of thrown from the finally block.
    // Throwing from finally would abort the IIFE and skip the retry loop below,
    // turning a transient launchd-deregister race into a hard release blocker.
    let cleanupFailure = ""
    const attemptResult = await (async () => {
      try {
        return spawnSync("bun", [guiSmokeScript, archivedApp, guiRuntimeRoot], {
          encoding: "utf8",
          env: (() => {
            const env = {
              ...process.env,
              TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT: guiRuntimeRoot,
              ...(purgePackageSmokeResiduals ? { TERRA_EDU_GUI_SMOKE_PURGE_RESIDUALS: "1" } : {}),
            }
            delete env.ELECTRON_RUN_AS_NODE
            delete env.ELECTRON_NO_ASAR
            return env
          })(),
          // Soft dialog skips each burn CDP timeouts; a healthy local run is ~7–8 min.
          timeout: 600_000,
        })
      } finally {
        try {
          // Boot out first so KeepAlive cannot respawn helpers mid-kill, then
          // kill runtime-scoped and any remaining Ego Lite processes globally.
          bootoutEgoLaunchdServices()
          const lingeringPids = await killExactRuntimeProcesses(guiRuntimeRoot)
          if (lingeringPids.length > 0) {
            cleanupFailure = `GUI smoke exact runtime processes survived repeated SIGKILL cleanup: ${lingeringPids.join(", ")}`
          } else {
            const lingeringEgoPids = await killAllEgoLiteProcesses()
            if (lingeringEgoPids.length > 0) {
              cleanupFailure = `GUI smoke left ego lite helper processes alive: ${lingeringEgoPids.join(", ")}`
            } else if (exactRuntimePids(guiRuntimeRoot).length > 0) {
              cleanupFailure = "GUI smoke exact runtime process count was not zero after cleanup"
            } else if (!(await waitForEgoBrowserLaunchdServiceRemoval())) {
              cleanupFailure = "GUI smoke left com.citrolabs.ego.lite.ego-browser registered with launchd"
            } else {
              const newCrashReports = await newStableEgoCrashReports(crashReportsBeforeGuiSmoke)
              if (newCrashReports.length > 0) cleanupFailure = `GUI smoke produced new Ego Lite crash reports: ${newCrashReports.join(", ")}`
            }
          }
        } finally {
          rmSync(guiRuntimeRoot, { recursive: true, force: true })
        }
      }
    })()
    if (cleanupFailure && attemptResult.status === 0) {
      // The smoke script itself succeeded but cleanup raced; surface the cleanup
      // issue as the failure so the retry loop can decide whether it is transient.
      lastSmokeFailure = cleanupFailure
    } else {
      // Prefer stderr for classification: stdout always contains "[dialog smoke]"
      // banners, which would mark nearly every failure as transient if matched.
      lastSmokeFailure = attemptResult.stderr || attemptResult.error?.message || cleanupFailure || attemptResult.stdout || "unknown error"
    }
    if (attemptResult.status === 0 && !cleanupFailure) {
      smoke = attemptResult
      break
    }
    // Full isolated GUI cold-starts are timing-sensitive on local macOS (CDP,
    // dialog observation races, keychain prompts). Retry the whole smoke with a
    // fresh runtime; never skip assertions on a successful attempt.
    const classificationText = (attemptResult.stderr || attemptResult.error?.message || cleanupFailure || "").split("\n").find((line) => line.trim()) || lastSmokeFailure.split("\n").find((line) => line.trim()) || ""
    const transient =
      /cleanup_failed|CDP request timed out|pageInfo timed out|钥匙串|alert payload was not observed|TERRA_EGO_SCRIPT_FAILED|exit 79|registered with launchd|runtime processes survived|process count was not zero|crash reports|helper processes alive|EXTERNAL_SERVICE_ACTIVE|Could not clear Ego residuals/.test(
        classificationText,
      )
    console.log(`GUI smoke attempt ${attempt}/3 failed${transient ? " (transient cold-start race)" : ""}: ${classificationText.split("\n")[0] || lastSmokeFailure.split("\n")[0]}`)
    if (!transient || attempt === 3) {
      smoke = attemptResult.status === 0 && !cleanupFailure ? attemptResult : undefined
      break
    }
  }
  assert(
    smoke?.status === 0,
    `Package is NOT DISTRIBUTION READY because the required Ego dialog smoke failed: ${lastSmokeFailure || smoke?.stderr || smoke?.stdout || smoke?.error?.message || "unknown error"}`,
  )
  for (const marker of [
    "TERRA_EGO_DIALOG_SMOKE_COLD_OBSERVATION",
    "TERRA_EGO_VISUAL_SCREENSHOT_VERIFIED",
    "TERRA_EGO_NETWORK_EVENT_SHAPE_FETCH_POST",
    "TERRA_EGO_NETWORK_EVENT_SHAPE_DOCUMENT_POST",
    "TERRA_EGO_NETWORK_EVENT_SHAPE_IFRAME_DOCUMENT_REDIRECT",
    "TERRA_EGO_DIALOG_SMOKE_COMPLETE_KEEP_TRUE",
    "TERRA_EGO_DIALOG_SMOKE_PAGE_PRESERVED",
    "TERRA_EGO_DIALOG_SMOKE_PROCESS_PRESERVED_AFTER_COMPLETION",
  ]) {
    assert(smoke.stdout.includes(marker), `Final ZIP Ego smoke did not emit required runtime marker: ${marker}`)
  }
  run("codesign", ["--verify", "--deep", "--strict", archivedApp], "Final ZIP app post-smoke code-signature verification")
  await verifyEgoRuntime(archivedEgoLite, egoRuntimeLock)
} finally {
  rmSync(extractedZip, { recursive: true, force: true })
}

console.log("Application Agent macOS package verification passed.")
console.log(`App: ${app}`)
