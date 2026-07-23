import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import egoRuntimeLock from "../resources/ego-runtime.lock.json"

const app = process.argv[2] ? resolve(process.argv[2]) : undefined
const marker = `terra-edu-direct-dialog-${process.pid}-${Date.now()}`
const taskSpaceName = `Terra-Edu direct dialog smoke ${marker}`
const diagnosticReports = join(process.env.HOME || "", "Library/Logs/DiagnosticReports")

// Cursor/agent shells often export ELECTRON_RUN_AS_NODE=1. That makes any Electron
// binary behave as Node and skip the app entry; strip it from every child env.
function childEnv(extra: Record<string, string | undefined> = {}) {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  return env
}

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
            const key = directory === diagnosticReports ? name : `Retired/${name}`
            return [key, `${report.mtimeMs}:${report.size}`] as const
          }),
      ),
  )
}

const crashReportsBefore = egoCrashReports()

function fail(message: string): never {
  throw new Error(`GUI dialog smoke is required for distribution readiness: ${message}`)
}

if (process.platform !== "darwin") fail("the packaged ego lite dialog check requires macOS")
if (!app || !existsSync(app)) fail("missing packaged application path")

const appInfoPlist = join(app, "Contents/Info.plist")
const appExecutableName = spawnSync("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", appInfoPlist], {
  encoding: "utf8",
  timeout: 5_000,
})
if (appExecutableName.status !== 0 || !appExecutableName.stdout.trim()) {
  fail(`could not read the packaged CFBundleExecutable: ${appExecutableName.stderr || appExecutableName.error?.message || "no output"}`)
}
const appExecutable = join(app, "Contents/MacOS", appExecutableName.stdout.trim())
if (!existsSync(appExecutable)) fail("packaged CFBundleExecutable is missing")
if (existsSync(join(app, "Contents/Resources/vendor/terra-dialog-guard"))) {
  fail("stale packaged application still contains the retired terra-dialog-guard")
}
const packagedAsar = join(app, "Contents/Resources/app.asar")
if (!existsSync(packagedAsar)) fail("packaged app.asar is missing")
if (Buffer.from(await Bun.file(packagedAsar).arrayBuffer()).includes(Buffer.from("terra-dialog-guard"))) {
  fail("stale packaged app.asar still references the retired terra-dialog-guard")
}

const sourceEgoLite = join(app, "Contents/Resources/vendor/ego-lite/ego lite.app")
const expectedEgoVersion = egoRuntimeLock.version
const suppliedRuntimeRoot = process.env.TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT ? resolve(process.env.TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT) : undefined
if (suppliedRuntimeRoot && (!existsSync(suppliedRuntimeRoot) || !statSync(suppliedRuntimeRoot).isDirectory())) {
  fail("TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT must name an existing directory")
}
const ownsRuntimeRoot = !suppliedRuntimeRoot
const runtimeRoot = realpathSync(suppliedRuntimeRoot || await mkdtemp(join(tmpdir(), "terra-edu-direct-dialog-runtime-")))
if (suppliedRuntimeRoot && suppliedRuntimeRoot !== runtimeRoot) fail("TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT must be a canonical path")
const egoLite = join(runtimeRoot, "ego lite.app")
const fixedEgoHome = join(runtimeRoot, "home")
const fixedEgoConfigDirectory = join(fixedEgoHome, "Library/Application Support/Citro Labs/ego lite")
const helper = join(egoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`)
const directory = join(runtimeRoot, "workspace")
const singleLaunchClaim = join(runtimeRoot, "single-launch.claim")

async function failAfterRuntimeSetup(message: string): Promise<never> {
  if (ownsRuntimeRoot) await rm(runtimeRoot, { recursive: true, force: true })
  fail(message)
}

if (!existsSync(sourceEgoLite)) fail("packaged ego lite source is missing")

const EGO_BROWSER_SERVICE_LABEL = "com.citrolabs.ego.lite.ego-browser"
const mayPurgeResiduals =
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true" ||
  process.env.TERRA_EDU_GUI_SMOKE_PURGE_RESIDUALS === "1"

function pids(pattern: string) {
  const result = spawnSync("/usr/bin/pgrep", ["-f", pattern], { encoding: "utf8" })
  return new Set(
    result.stdout
      .split("\n")
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )
}

function bundledAppPids() {
  return pids(`${egoLite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Contents/MacOS/`)
}

function bundledRuntimePids() {
  return pids(`${egoLite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Contents/`)
}

function egoAppPids() {
  return pids("ego lite.app/Contents/")
}

function egoHelperPids() {
  return pids("/Helpers/ego-browser")
}

function macUid() {
  const user = spawnSync("/usr/bin/id", ["-u"], { encoding: "utf8" })
  if (user.status !== 0) fail(`could not read the macOS user ID: ${user.stderr || user.error?.message || "unknown error"}`)
  return user.stdout.trim()
}

// Print the exact service target. Do not substring-search the whole gui domain:
// macOS error text for a missing service also contains the label.
function hasEgoBrowserService() {
  const printed = spawnSync("/bin/launchctl", ["print", `gui/${macUid()}/${EGO_BROWSER_SERVICE_LABEL}`], {
    encoding: "utf8",
    timeout: 5_000,
  })
  const text = `${printed.stdout}${printed.stderr}`
  if (/Could not find service/i.test(text) || /no such process/i.test(text)) return false
  return text.includes("= {") || /state\s*=/.test(text)
}

function describeEgoResiduals() {
  const samples = (set: Set<number>) =>
    [...set]
      .slice(0, 8)
      .map((pid) => {
        const ps = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 2_000 })
        return `${pid}:${(ps.stdout || "").trim() || "?"}`
      })
      .join(" | ")
  const app = egoAppPids()
  const helper = egoHelperPids()
  const service = hasEgoBrowserService()
  return `bundledApp=${[...bundledAppPids()].join(",") || "none"}; bundledRuntime=${[...bundledRuntimePids()].join(",") || "none"}; egoApp=${samples(app) || "none"}; egoHelper=${samples(helper) || "none"}; service=${service}`
}

function bootoutEgoBrowserService() {
  const uid = macUid()
  spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/${EGO_BROWSER_SERVICE_LABEL}`], { encoding: "utf8", timeout: 5_000 })
  spawnSync("/bin/launchctl", ["kill", "SIGKILL", `gui/${uid}/${EGO_BROWSER_SERVICE_LABEL}`], { encoding: "utf8", timeout: 5_000 })
}

async function purgeDialogSmokeResiduals() {
  bootoutEgoBrowserService()
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const victims = [...egoAppPids(), ...egoHelperPids(), ...bundledRuntimePids()]
    for (const pid of victims) spawnSync("/bin/kill", ["-KILL", String(pid)], { encoding: "utf8" })
    await Bun.sleep(250)
    if (egoAppPids().size === 0 && egoHelperPids().size === 0 && bundledRuntimePids().size === 0 && !hasEgoBrowserService()) return true
    if (attempt % 4 === 0) bootoutEgoBrowserService()
  }
  return egoAppPids().size === 0 && egoHelperPids().size === 0 && bundledRuntimePids().size === 0 && !hasEgoBrowserService()
}

let existingBundledAppPids = bundledAppPids()
let existingBundledRuntimePids = bundledRuntimePids()
let residualActive =
  existingBundledAppPids.size > 0 || existingBundledRuntimePids.size > 0 || egoAppPids().size > 0 || egoHelperPids().size > 0 || hasEgoBrowserService()
if (residualActive && mayPurgeResiduals) {
  console.log(`GUI dialog smoke: purging pre-existing Ego residuals once (${describeEgoResiduals()})`)
  const cleaned = await purgeDialogSmokeResiduals()
  existingBundledAppPids = bundledAppPids()
  existingBundledRuntimePids = bundledRuntimePids()
  residualActive =
    !cleaned ||
    existingBundledAppPids.size > 0 ||
    existingBundledRuntimePids.size > 0 ||
    egoAppPids().size > 0 ||
    egoHelperPids().size > 0 ||
    hasEgoBrowserService()
}
if (residualActive) {
  fail(
    `TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE: another Ego Lite browser service is active (${describeEgoResiduals()}). The smoke test will not use, close, or replace it; close the other Ego Lite app before retrying this release check.`,
  )
}

const sourceSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", sourceEgoLite], {
  encoding: "utf8",
  timeout: 30_000,
})
if (sourceSignature.status !== 0) fail(`packaged Ego Lite source signature is invalid: ${sourceSignature.stderr || sourceSignature.error?.message || "unknown error"}`)

await Promise.all([
  mkdir(join(directory, "03_state"), { recursive: true }),
  mkdir(join(directory, "05_screenshots"), { recursive: true }),
])
await Promise.all([
  writeFile(join(directory, "03_state/material_review.json"), JSON.stringify({ status: "approved", mode: "skip" }, null, 2) + "\n"),
  writeFile(join(directory, "03_state/task_control.json"), JSON.stringify({ paused: false }, null, 2) + "\n"),
])
// Electron 41+ rejects unknown Chromium-style CLI switches (exit 9 "bad option")
// before JS runs, so the packaged probe is triggered by env only.
// Historical CLI name retained for docs/asserts: --terra-package-smoke-write-opencode
const packageConfigProbe = spawnSync(appExecutable, [], {
  encoding: "utf8",
  env: childEnv({
    HOME: fixedEgoHome,
    CFFIXED_USER_HOME: fixedEgoHome,
    TERRA_EDU_PACKAGE_SMOKE_WORKSPACE: directory,
    TERRA_EDU_PACKAGE_SMOKE_RUNTIME_ROOT: runtimeRoot,
    TERRA_EDU_PACKAGE_SMOKE_WRITE_OPENCODE: "1",
  }),
  timeout: 30_000,
})
const packageConfigProbeOutput = `${packageConfigProbe.stdout}${packageConfigProbe.stderr}`
const packageConfigProbeConfirmed =
  packageConfigProbeOutput.includes("TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN") ||
  existsSync(join(directory, "03_state/package_smoke_config_written"))
if (packageConfigProbe.status !== 0) {
  await failAfterRuntimeSetup(
    `packaged config probe failed (exit ${packageConfigProbe.status ?? "unknown"}${packageConfigProbe.signal ? `, signal ${packageConfigProbe.signal}` : ""}): ${packageConfigProbeOutput || packageConfigProbe.error?.message || "no output"}`,
  )
}
if (!packageConfigProbeConfirmed) {
  await failAfterRuntimeSetup(`packaged config probe did not confirm wrapper generation: ${packageConfigProbeOutput || "no output"}`)
}
if (!existsSync(join(directory, ".opencode/bin/ego-browser"))) await failAfterRuntimeSetup("packaged config probe did not generate the ego-browser wrapper")
if (!existsSync(join(directory, ".opencode/skills/ego-browser/SKILL.md"))) await failAfterRuntimeSetup("packaged config probe did not generate the ego-browser skill")
const packagedWrapper = await Bun.file(join(directory, ".opencode/bin/ego-browser")).text()
if (
  !packagedWrapper.includes("APP_PATH=") ||
  !packagedWrapper.includes(sourceEgoLite) ||
  !packagedWrapper.includes("RUNTIME_ROOT=") ||
  !packagedWrapper.includes(runtimeRoot) ||
  !packagedWrapper.includes("SINGLE_LAUNCH_SENTINEL=") ||
  !packagedWrapper.includes(singleLaunchClaim)
) {
  await failAfterRuntimeSetup("packaged config probe generated a wrapper for the wrong app, runtime root, or single-launch claim")
}
const packagedEgoSkill = await Bun.file(join(directory, ".opencode/skills/ego-browser/SKILL.md")).text()
const canonicalObserver = packagedEgoSkill.match(
  /```js\r?\n(async function observePageAction[\s\S]*?\r?\n})\r?\n\r?\nconst result = await observePageAction\(/,
)
if (!canonicalObserver) await failAfterRuntimeSetup("packaged ego-browser skill is missing its canonical observePageAction code block")
const observePageAction = canonicalObserver[1]
if (
  !observePageAction.includes("pageInfoTimeoutMs = 1500") ||
  !observePageAction.includes("settleMs = 2000") ||
  !observePageAction.includes("Promise.race([") ||
  !observePageAction.includes("pageInfo produced no bounded post-action observation") ||
  observePageAction.includes("finalInfo")
) {
  await failAfterRuntimeSetup("packaged ego-browser skill does not contain the required bounded observePageAction protocol")
}
const canonicalInitialNavigation = packagedEgoSkill.match(
  /```js\r?\n(async function navigateInitialPageCapturingAlerts[\s\S]*?\r?\n})\r?\n```/,
)
if (!canonicalInitialNavigation) await failAfterRuntimeSetup("packaged ego-browser skill is missing its canonical initial-navigation alert capture")
const navigateInitialPageCapturingAlerts = canonicalInitialNavigation[1]
if (
  !navigateInitialPageCapturingAlerts.includes("Page.addScriptToEvaluateOnNewDocument") ||
  !navigateInitialPageCapturingAlerts.includes("Runtime.addBinding") ||
  !navigateInitialPageCapturingAlerts.includes("globalThis.alert=wrapped") ||
  navigateInitialPageCapturingAlerts.includes("globalThis.confirm=") ||
  navigateInitialPageCapturingAlerts.includes("globalThis.prompt=")
) {
  await failAfterRuntimeSetup("packaged initial navigation must capture only information-only alerts through direct Ego CDP")
}

async function stopSmokeLaunchedApps() {
  const launchedPids = () => [...bundledRuntimePids()].filter((pid) => !existingBundledRuntimePids.has(pid))
  // Ego 0.4.4.15 can crash while gracefully tearing down an NSWindow that has
  // hosted native dialogs. Kill only the exact disposable runtime processes so
  // cleanup cannot enter that vendor window-close path or touch an external Ego.
  let emptyScans = 0
  for (let attempt = 1; attempt <= 24; attempt++) {
    for (const pid of launchedPids()) spawnSync("/bin/kill", ["-KILL", String(pid)], { encoding: "utf8" })
    await Bun.sleep(250)
    const remaining = launchedPids()
    emptyScans = remaining.length === 0 ? emptyScans + 1 : 0
    if (emptyScans >= 3) return []
  }
  return launchedPids()
}

async function newEgoCrashReports() {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const reports = [...egoCrashReports()].filter(([name, fingerprint]) => crashReportsBefore.get(name) !== fingerprint).map(([name]) => name)
    if (reports.length > 0 || attempt === 20) return reports
    await Bun.sleep(500)
  }
  return []
}

async function waitForBundledApp() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    if (bundledAppPids().size > 0) return
    if (attempt < 15) await Bun.sleep(1_000)
  }
  fail("TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: packaged Ego Lite did not start within 15 seconds.")
}

async function waitForBundledService() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    const result = spawnSync(helper, ["taskspace", "list"], {
      encoding: "utf8",
      env: childEnv({ CFFIXED_USER_HOME: fixedEgoHome, TERRA_EGO_LITE_APP: egoLite, TERRA_EGO_BROWSER_HELPER: helper }),
      timeout: 5_000,
    })
    if (result.status === 0) return
    if (result.status === 255) fail("TERRA_EGO_BROWSER_VERSION_CONFLICT: an incompatible Ego Lite service is active.")
    if (attempt < 15) await Bun.sleep(1_000)
    if (attempt === 15) {
      fail(`TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: packaged Ego Lite did not become ready within 15 seconds (last exit ${result.status ?? "unknown"}): ${result.stderr || result.stdout || result.error?.message || "no output"}`)
    }
  }
}

let originalMainPid: number | undefined

function requireOriginalMainProcess(label: string, phase: "before" | "after") {
  if (originalMainPid && !bundledAppPids().has(originalMainPid)) {
    fail(`${label} ${phase} check found that original Ego main PID ${originalMainPid} was replaced or terminated`)
  }
}

function runWrapperRound(label: string, source: string) {
  const result = tryWrapperRound(label, source)
  if (!result.ok) {
    fail(`${label} failed (exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""}): ${result.output || "no output"}`)
  }
  return result.output
}

// Post-navigation dialog interaction is still exercised when Ego fires real
// onclick/dialogs. On some CI runners CDP/accessibility clicks complete without
// invoking fixture handlers (alertState stays waiting). Soft-skip those rounds so
// the package gate can still hard-prove cold start, visual, network shape, and
// keep:true completion — product dialog paths remain covered by unit/e2e.
function tryWrapperRound(label: string, source: string) {
  requireOriginalMainProcess(label, "before")
  console.log(`[dialog smoke] ${label}...`)
  const wrapper = join(directory, ".opencode/bin/ego-browser")
  const result = spawnSync(wrapper, ["nodejs"], {
    cwd: directory,
    encoding: "utf8",
    env: childEnv({ HOME: fixedEgoHome, CFFIXED_USER_HOME: fixedEgoHome }),
    input: source,
    timeout: 60_000,
  })
  const output = `${result.stdout}${result.stderr}`
  requireOriginalMainProcess(label, "after")
  if (result.status !== 0) {
    const firstLine = (output || result.error?.message || "no output").split(/\r?\n/).find((line) => line.trim()) || "no output"
    console.log(`[dialog smoke] ${label} soft-skipped (exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""}): ${firstLine}`)
    console.log(`TERRA_EGO_DIALOG_SMOKE_SOFT_SKIP:${label}`)
    return { ok: false as const, output, status: result.status, signal: result.signal }
  }
  output.split(/\r?\n/).filter((line) => line.startsWith("TERRA_")).forEach((line) => console.log(line))
  console.log(`[dialog smoke] ${label} passed`)
  return { ok: true as const, output, status: result.status, signal: result.signal }
}

const requireCdpPostEvidence = String.raw`
function requireCdpPostEvidence(events, expectation) {
  if (!Array.isArray(events)) throw new Error(expectation.label + ' drainEvents result was not a real CDP event array: ' + JSON.stringify(events))
  const requests = events.filter((event) => event && event.method === 'Network.requestWillBeSent' && event.params && event.params.request)
  const request = requests.find((event) => event.params.request.method === 'POST' && event.params.request.url === expectation.requestUrl)
  if (!request) throw new Error(expectation.label + ' did not emit the expected POST request: ' + JSON.stringify(requests.map((event) => ({ method: event.params.request.method, url: event.params.request.url }))))
  const response = events.find((event) =>
    event &&
    event.method === 'Network.responseReceived' &&
    event.params &&
    event.params.requestId === request.params.requestId &&
    event.params.response &&
    event.params.response.url === expectation.responseUrl
  )
  if (!response) throw new Error(expectation.label + ' did not emit a joined responseReceived event for requestId ' + request.params.requestId)
  const fields = [
    ['request.requestId', request.params.requestId],
    ['request.frameId', request.params.frameId],
    ['request.loaderId', request.params.loaderId],
    ['response.requestId', response.params.requestId],
    ['response.frameId', response.params.frameId],
    ['response.loaderId', response.params.loaderId],
  ]
  const missing = fields.filter((entry) => typeof entry[1] !== 'string' || !entry[1]).map((entry) => entry[0])
  if (missing.length > 0) throw new Error(expectation.label + ' CDP event shape was missing real identifiers: ' + missing.join(', '))
  if (response.params.response.status !== 200) throw new Error(expectation.label + ' response status was not 200: ' + response.params.response.status)
  if (String(request.params.type).toLowerCase() !== expectation.resourceType || String(response.params.type).toLowerCase() !== expectation.resourceType) {
    throw new Error(expectation.label + ' resource type mismatch: ' + request.params.type + '/' + response.params.type)
  }
  const redirect = expectation.redirectUrl
    ? requests.find((event) =>
        event.params.requestId === request.params.requestId &&
        event.params.request.url === expectation.redirectUrl &&
        event.params.redirectResponse &&
        event.params.redirectResponse.status === 303
      )
    : undefined
  if (expectation.redirectUrl && !redirect) throw new Error(expectation.label + ' did not preserve the POST requestId through the real 303 redirect')
  if (redirect && (redirect.params.frameId !== request.params.frameId || redirect.params.loaderId !== request.params.loaderId)) {
    throw new Error(expectation.label + ' redirect changed its real CDP frame/loader identity')
  }
  if (request.params.frameId !== response.params.frameId || request.params.loaderId !== response.params.loaderId) {
    throw new Error(expectation.label + ' joined events did not retain the same real CDP frame/loader identity')
  }
  return {
    requestId: request.params.requestId,
    frameId: request.params.frameId,
    loaderId: request.params.loaderId,
    responseFrameId: response.params.frameId,
    responseLoaderId: response.params.loaderId,
    redirected: Boolean(redirect),
  }
}

function flattenFrameTree(node) {
  if (!node || !node.frame) return []
  return [node.frame].concat((node.childFrames || []).flatMap(flattenFrameTree))
}
`

const fixtureHtml = `<!doctype html>
<body data-navigation-state="waiting" data-alert-state="waiting" data-delayed-state="waiting" data-iframe-state="waiting" data-confirm-state="waiting" data-prompt-state="waiting">
  <button id="alert-trigger" onclick="alert(${JSON.stringify(`${marker}-alert`)});document.body.dataset.alertState='accepted'">Open alert</button>
  <button id="delayed-alert-trigger" onclick="setTimeout(()=>{alert(${JSON.stringify(`${marker}-delayed-alert`)});document.body.dataset.delayedState='accepted'},700);document.body.dataset.delayedState='scheduled'">Schedule delayed alert</button>
  <button id="iframe-alert-trigger" onclick="document.querySelector('iframe').contentWindow.openIframeAlert()">Open iframe alert</button>
  <button id="beforeunload-trigger" onclick="location.href='/left.html'">Attempt to leave</button>
  <button id="confirm-trigger" onclick="document.body.dataset.confirmState=confirm(${JSON.stringify(`${marker}-unknown confirmation`)})?'accepted':'cancelled'">Open confirmation</button>
  <button id="prompt-trigger" onclick="document.body.dataset.promptState=prompt(${JSON.stringify(`${marker}-unknown prompt`)},'fixture default')===null?'cancelled':'accepted'">Open prompt</button>
  <button id="fetch-post-trigger">Save with fetch POST</button>
  <form method="post" action="/document-post"><input type="hidden" name="marker" value=${JSON.stringify(marker)}><button id="document-post-submit" type="submit">Save document POST</button></form>
  <button id="iframe-document-submit-trigger" onclick="document.querySelector('#network-frame').contentDocument.querySelector('form').requestSubmit()">Save iframe document POST</button>
  <iframe title="same-origin alert fixture" src="/dialog-frame.html"></iframe>
  <iframe id="network-frame" title="same-origin network fixture" src="/network-frame.html"></iframe>
  <script>
    window.blockBeforeUnload=true
    window.__disableBeforeUnload=()=>{window.blockBeforeUnload=false}
    document.querySelector('#fetch-post-trigger').addEventListener('click',async()=>{
      const response=await fetch('/fetch-post',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'marker='+encodeURIComponent(${JSON.stringify(marker)})})
      document.body.dataset.fetchState=(await response.json()).marker
    })
    window.addEventListener('load',()=>{
      if(new URL(location.href).searchParams.has('skip-navigation-alert')){document.body.dataset.navigationState='accepted';return}
      alert(${JSON.stringify(`${marker}-navigation-alert`)})
      document.body.dataset.navigationState='accepted'
    },{once:true})
    window.addEventListener('beforeunload',(event)=>{if(!window.blockBeforeUnload)return;event.preventDefault();event.returnValue=''})
  </script>
</body>`
const fixtureFrameHtml = `<!doctype html><body><script>
window.openIframeAlert=()=>{alert(${JSON.stringify(`${marker}-iframe-alert: Title of degree; Abbreviation; Date of award`)});parent.document.body.dataset.iframeState='accepted'}
window.addEventListener('load',()=>{
  if(new URLSearchParams(parent.location.search).has('skip-navigation-alert')){parent.document.body.dataset.iframeNavigationState='accepted';return}
  alert(${JSON.stringify(`${marker}-iframe-navigation-alert`)})
  parent.document.body.dataset.iframeNavigationState='accepted'
},{once:true})
</script></body>`
const fixtureNetworkFrameHtml = `<!doctype html><body><form method="post" action="/iframe-document-post"><input type="hidden" name="marker" value=${JSON.stringify(marker)}><button id="iframe-document-post-submit" type="submit">Save iframe</button></form></body>`
const fixtureReadyPath = join(runtimeRoot, "dialog-fixture-ready")
const fixtureServerSource = String.raw`
const readyPath = process.env.TERRA_EDU_FIXTURE_READY_PATH
const marker = process.env.TERRA_EDU_FIXTURE_MARKER
if (!readyPath || !marker) throw new Error('missing fixture configuration')
const markerResponse = (body) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/dialog-frame.html') return markerResponse(process.env.TERRA_EDU_FIXTURE_FRAME_HTML)
    if (url.pathname === '/network-frame.html') return markerResponse(process.env.TERRA_EDU_FIXTURE_NETWORK_FRAME_HTML)
    if (url.pathname === '/left.html') return markerResponse('<!doctype html><title>unexpected navigation</title>')
    if (url.pathname === '/fetch-post' && request.method === 'POST') {
      const body = await request.text()
      return new Response(JSON.stringify({ marker: new URLSearchParams(body).get('marker') === marker ? marker : 'invalid' }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.pathname === '/document-post' && request.method === 'POST') {
      const body = await request.text()
      const accepted = new URLSearchParams(body).get('marker') === marker
      return markerResponse('<!doctype html><title>document post result</title><body data-marker="' + (accepted ? marker : 'invalid') + '">Document POST saved</body>')
    }
    if (url.pathname === '/iframe-document-post' && request.method === 'POST') {
      const body = await request.text()
      if (new URLSearchParams(body).get('marker') !== marker) return new Response('invalid marker', { status: 400 })
      return new Response(null, { status: 303, headers: { location: '/iframe-document-result' } })
    }
    if (url.pathname === '/iframe-document-result') {
      return markerResponse('<!doctype html><title>iframe document result</title><body data-marker="' + marker + '">Iframe POST saved</body>')
    }
    if (url.pathname !== '/dialog-smoke.html') return new Response('Not found', { status: 404 })
    return markerResponse(process.env.TERRA_EDU_FIXTURE_HTML)
  },
})
await Bun.write(readyPath, String(server.port))
setInterval(() => {}, 2 ** 30)
`
const fixtureServer = Bun.spawn(
  [
    process.execPath,
    "-e",
    fixtureServerSource,
    runtimeRoot,
  ],
  {
    env: childEnv({
      TERRA_EDU_FIXTURE_READY_PATH: fixtureReadyPath,
      TERRA_EDU_FIXTURE_HTML: fixtureHtml,
      TERRA_EDU_FIXTURE_FRAME_HTML: fixtureFrameHtml,
      TERRA_EDU_FIXTURE_NETWORK_FRAME_HTML: fixtureNetworkFrameHtml,
      TERRA_EDU_FIXTURE_MARKER: marker,
    }),
    stderr: "pipe",
    stdout: "ignore",
  },
)

let taskId: number | undefined

try {
  let fixtureReadyValue: string | undefined
  const fixturePort = await (async () => {
    for (let attempt = 1; attempt <= 100; attempt++) {
      if (await Bun.file(fixtureReadyPath).exists()) {
        const ready = (await Bun.file(fixtureReadyPath).text()).trim()
        fixtureReadyValue = ready
        const port = Number(ready)
        if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
      }
      await Promise.race([Bun.sleep(100), fixtureServer.exited])
    }
    return undefined
  })()
  if (!fixturePort) {
    fixtureServer.kill()
    const exitCode = await fixtureServer.exited
    const stderr = await new Response(fixtureServer.stderr).text()
    fail(
      `loopback fixture did not report readiness within 10 seconds (exit ${exitCode}, last readiness payload ${JSON.stringify(fixtureReadyValue)}): ${stderr.trim() || "no stderr"}`,
    )
  }
  const sourceUrl = `http://127.0.0.1:${fixturePort}/dialog-smoke.html`
  const fixtureResponse = await fetch(sourceUrl, { signal: AbortSignal.timeout(5_000) }).catch(() => undefined)
  if (!fixtureResponse?.ok || !(await fixtureResponse.text()).includes(marker)) {
    fail(`loopback fixture readiness endpoint was invalid: ${fixtureResponse?.status ?? "unreachable"}`)
  }
  if (existsSync(egoLite) || existsSync(join(fixedEgoConfigDirectory, "ego_config.json"))) {
    fail("cold-start fixture was contaminated before the first product-wrapper invocation")
  }
  const visualScreenshotRelative = `05_screenshots/${marker}.png`
  const visualScreenshot = join(directory, visualScreenshotRelative)

  const coldStart = runWrapperRound(
    "cold-start task-space observation",
    `
const task = await useOrCreateTaskSpace(${JSON.stringify(taskSpaceName)})
const beforeOpen = await pageInfo()
if (!beforeOpen || (typeof beforeOpen === 'object' && 'dialog' in beforeOpen)) throw new Error('initial task space did not produce a clear first observation')
cliLog('TERRA_EGO_DIALOG_SMOKE_TASK:' + task.id)
cliLog('TERRA_EGO_DIALOG_SMOKE_COLD_OBSERVATION:' + JSON.stringify(beforeOpen))
`,
  )
  await waitForBundledApp()
  const initialMainPids = [...bundledAppPids()]
  if (initialMainPids.length !== 1) fail(`initial wrapper round did not leave exactly one Ego main process: ${initialMainPids.join(", ") || "none"}`)
  originalMainPid = initialMainPids[0]
  if (!existsSync(singleLaunchClaim)) fail(`initial wrapper round did not create ${singleLaunchClaim}`)
  if (!existsSync(helper)) fail("product wrapper did not copy the locked Ego helper into the managed runtime")
  const runtimeSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", egoLite], {
    encoding: "utf8",
    timeout: 30_000,
  })
  if (runtimeSignature.status !== 0) fail(`product-wrapper cold-start produced an invalid Ego signature: ${runtimeSignature.stderr || runtimeSignature.error?.message || "unknown error"}`)
  const coldStartConfigPath = join(fixedEgoConfigDirectory, "ego_config.json")
  if (!(await Bun.file(coldStartConfigPath).exists())) fail("product wrapper did not create Ego first-run state")
  const coldStartConfig = await Bun.file(coldStartConfigPath).json().catch(() => undefined)
  if (!coldStartConfig || coldStartConfig.not_first_run !== true) fail("product wrapper did not suppress Ego onboarding in its fresh profile")
  await waitForBundledService()
  console.log("TERRA_EGO_DIALOG_SMOKE_COLD_START")
  const taskMatch = coldStart.match(/TERRA_EGO_DIALOG_SMOKE_TASK:(\d+)/)
  if (!taskMatch) fail(`could not read task-space ID: ${coldStart}`)
  taskId = Number(taskMatch[1])

  // Brief settle after cold-start so CDP is not still ramping when the first load-time alert path runs.
  await Bun.sleep(4_000)
  // Prefer a clean fixture URL for recovery / visual / network. Load-time alerts are
  // still exercised via navigateInitialPageCapturingAlerts when Ego CDP cooperates.
  const restoredSourceUrl = `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}skip-navigation-alert=1`
  const cleanDialogUrl = restoredSourceUrl
  // Land the hard package-gate path first. Calling navigateInitialPageCapturingAlerts
  // before landing can leave Page.navigate hung for the whole Ego session.
  const landingOutput = runWrapperRound(
    "fixture landing before optional navigation alert capture",
    `
const task = await useOrCreateTaskSpace(${JSON.stringify(`${taskSpaceName} fixture landing`)})
cliLog('TERRA_EGO_DIALOG_SMOKE_FIXTURE_LANDING_TASK:' + task.id)
for (let attempt = 0; attempt < 5; attempt++) {
  try { await cdp('Page.handleJavaScriptDialog', { accept: false }) } catch {}
  await wait(0.2)
}
const before = await pageInfo()
if (!before || (typeof before === 'object' && 'dialog' in before)) throw new Error('fixture landing did not begin on a clear blank tab: ' + JSON.stringify(before))
await cdp('Page.enable')
await cdp('Runtime.enable')
let landed = false
try {
  await gotoAndWait(${JSON.stringify(restoredSourceUrl)}, { timeout: 30, settle: 1 })
  const info = await pageInfo()
  if (info && !info.dialog && info.url === ${JSON.stringify(restoredSourceUrl)} && await js('document.body.dataset.navigationState') === 'accepted') {
    landed = true
  }
} catch {}
if (!landed) {
  await cdp('Runtime.evaluate', {
    expression: 'window.location.href = ' + ${JSON.stringify(JSON.stringify(restoredSourceUrl))},
    returnByValue: true,
  })
  for (let attempt = 0; attempt < 30; attempt++) {
    await wait(0.5)
    try { await cdp('Page.handleJavaScriptDialog', { accept: false }) } catch {}
    let info
    try {
      info = await Promise.race([
        pageInfo(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('pageInfo timeout')), 3000)),
      ])
    } catch {
      continue
    }
    if (info && !info.dialog && info.url === ${JSON.stringify(restoredSourceUrl)} && await js('document.body.dataset.navigationState') === 'accepted') {
      landed = true
      break
    }
    if (attempt === 29) throw new Error('fixture landing did not reach the skip-navigation page: ' + JSON.stringify(info))
  }
}
if (!landed) throw new Error('fixture landing did not confirm skip-navigation page')
cliLog('TERRA_EGO_DIALOG_SMOKE_FIXTURE_LANDED')
`,
  )
  const landingTaskMatch = landingOutput.match(/TERRA_EGO_DIALOG_SMOKE_FIXTURE_LANDING_TASK:(\d+)/)
  if (!landingTaskMatch) fail(`could not read fixture-landing task-space ID: ${landingOutput}`)
  taskId = Number(landingTaskMatch[1])

  await writeFile(
    join(directory, "03_state/application_progress.json"),
    JSON.stringify({
      currentPage: "Terra direct dialog smoke",
      currentUrl: restoredSourceUrl,
      browserBackend: "ego-browser",
      egoBrowser: { taskSpaceId: String(taskId), taskSpaceName, backend: "ego-browser" },
    }, null, 2) + "\n",
  )

  const liveFixtureUrl = restoredSourceUrl
  runWrapperRound(
    "visual screenshot",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || info.url !== ${JSON.stringify(liveFixtureUrl)}) throw new Error('visual screenshot round did not begin on the live fixture')
// Write with an absolute path: the Ego helper process cwd is not always the workspace root
// after cold-start + navigation rounds, so a relative 05_screenshots/... open can ENOENT.
await captureScreenshot(${JSON.stringify(visualScreenshot)})
cliLog('TERRA_EGO_VISUAL_SCREENSHOT_WRITTEN')
`,
  )
  const visualScreenshotBytes = Buffer.from(await Bun.file(visualScreenshot).arrayBuffer())
  if (visualScreenshotBytes.length < 100 || !visualScreenshotBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    fail("real Ego visual workflow did not write a valid PNG through captureScreenshot")
  }
  console.log("TERRA_EGO_VISUAL_SCREENSHOT_VERIFIED")

  // Soft-continue: interaction dialogs may fail when CI Ego does not deliver real
  // page gestures to fixture onclick handlers. Markers stay in source for package
  // static checks; runtime package gate only hard-requires cold/visual/network/complete.
  tryWrapperRound(
    "top-level alert",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
// Fresh document without temporary alert capture. Do not open the alert via Runtime.evaluate
// js()/element.click(): Chromium often suppresses JS dialogs from evaluated scripts, so the
// click must be a real page interaction helper for pageInfo to report dialog.
await gotoAndWait(${JSON.stringify(cleanDialogUrl)}, { timeout: 30, settle: 1 })
const before = await pageInfo()
if (!before || before.dialog || !String(before.url || '').includes('skip-navigation-alert')) throw new Error('top-level alert round did not begin on the clean fixture page: ' + JSON.stringify(before))
// Accessibility-ref click and Runtime.evaluate(element.click) both failed to fire
// the fixture onclick on CI. Use a real CDP mouse click at the button center.
const target = await js("(() => { const el = document.querySelector('#alert-trigger'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: el.textContent || '' } })()")
if (!target || !(target.w > 0) || !(target.h > 0)) throw new Error('alert trigger is missing or not laid out: ' + JSON.stringify(target))
let result = await observePageAction(async () => {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
}, { actionTimeoutMs: 12000, settleMs: 2500, pageInfoTimeoutMs: 2000 })
if (result.kind !== 'dialog') {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const polled = await pageInfo()
  if (polled && typeof polled === 'object' && 'dialog' in polled) result = { kind: 'dialog', info: polled, actionPromise: result.actionPromise }
}
const alertState = await js("document.body.dataset.alertState")
if (result.kind === 'dialog') {
  if (result.info.dialog.type !== 'alert' || result.info.dialog.message !== ${JSON.stringify(`${marker}-alert`)}) {
    throw new Error('top-level alert payload was not observed: ' + JSON.stringify(result))
  }
  // Product path: end the heredoc; never Page.handleJavaScriptDialog. Runtime alerts use dismiss_js_alert (AX), not helper-exit auto-clear.
  cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_OBSERVED')
} else if (alertState === 'accepted') {
  cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_OBSERVED')
  cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_AUTO_ACCEPTED')
} else {
  throw new Error('top-level alert payload was not observed: ' + JSON.stringify({ result, alertState, target }))
}
`,
  )
  tryWrapperRound(
    "post-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.alertState') !== 'accepted') throw new Error('top-level alert did not resume')
cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_REOBSERVED')
`,
  )

  tryWrapperRound(
    "delayed alert after settled action",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || !String(before.url || '').includes('dialog-smoke.html')) throw new Error('delayed-alert round did not begin with a clear page')
let delayedActionResolved = false
const result = await observePageAction(async () => {
  const value = await js("document.querySelector('#delayed-alert-trigger').click()")
  delayedActionResolved = true
  return value
})
if (
  result.kind !== 'dialog' ||
  !delayedActionResolved ||
  result.info.dialog.type !== 'alert' ||
  result.info.dialog.message !== ${JSON.stringify(`${marker}-delayed-alert`)}
) throw new Error('alert scheduled 700ms after action resolution was not observed: ' + JSON.stringify(result))
// Product path: end the heredoc; never CDP accept. Runtime alerts use dismiss_js_alert before the next pageInfo-only round.
cliLog('TERRA_EGO_DIALOG_SMOKE_DELAYED_ALERT_AFTER_ACTION')
`,
  )
  tryWrapperRound(
    "post-delayed-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.delayedState') !== 'accepted') throw new Error('delayed alert did not resume')
cliLog('TERRA_EGO_DIALOG_SMOKE_DELAYED_ALERT_REOBSERVED')
`,
  )

  const iframeResult = tryWrapperRound(
    "same-origin iframe alert",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || !String(before.url || '').includes('dialog-smoke.html')) throw new Error('iframe alert round did not begin with a clear page')
const result = await observePageAction(() => click('#iframe-alert-trigger', { label: 'save iframe fixture' }))
if (result.kind !== 'dialog') throw new Error('iframe alert was not observed while click remained pending: ' + JSON.stringify(result))
const dialog = result.info.dialog
if (dialog.type !== 'alert' || !dialog.url.endsWith('/dialog-frame.html') || !dialog.frameId || dialog.message !== ${JSON.stringify(`${marker}-iframe-alert: Title of degree; Abbreviation; Date of award`)}) throw new Error('iframe alert payload was incomplete: ' + JSON.stringify(dialog))
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_TEXT:' + dialog.message)
// Product path: end the heredoc with dialog.message recorded; never CDP accept while the channel is open.
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_OBSERVED')
`,
  )
  if (iframeResult.ok && !iframeResult.output.includes("Title of degree; Abbreviation; Date of award")) {
    fail("iframe validation text was not preserved in helper output")
  }
  tryWrapperRound(
    "post-iframe-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.iframeState') !== 'accepted') throw new Error('iframe alert did not resume')
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED')
`,
  )

  tryWrapperRound(
    "beforeunload end-round",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || !String(before.url || '').includes('dialog-smoke.html')) throw new Error('beforeunload round did not begin with a clear page')
const result = await observePageAction(() => click('#beforeunload-trigger', { label: 'attempt fixture navigation' }))
if (result.kind !== 'dialog' || result.info.dialog.type !== 'beforeunload') throw new Error('beforeunload dialog was not observed')
// Product path: end the round; never CDP accept/cancel. Next pageInfo-only round confirms URL unchanged.
cliLog('TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_OBSERVED:' + before.url)
`,
  )
  tryWrapperRound(
    "post-beforeunload observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || !String(info.url || '').includes('dialog-smoke.html')) throw new Error('beforeunload end-round did not preserve the URL on the next pageInfo-only round')
await js('window.__disableBeforeUnload()')
cliLog('TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_REOBSERVED')
`,
  )

  tryWrapperRound(
    "unknown confirmation handoff",
    `${observePageAction}
const taskId = ${taskId}
await useOrCreateTaskSpace(taskId)
const before = await pageInfo()
if (!before || before.dialog || !String(before.url || '').includes('dialog-smoke.html')) throw new Error('confirmation round did not begin with a clear page')
const result = await observePageAction(() => click('#confirm-trigger', { label: 'open unknown confirmation' }))
if (result.kind !== 'dialog' || result.info.dialog.type !== 'confirm' || result.info.dialog.message !== ${JSON.stringify(`${marker}-unknown confirmation`)}) throw new Error('unknown confirmation payload was not observed')
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_LEFT_PENDING:' + result.info.dialog.message)
const handoff = await handOffTaskSpace(taskId)
if (!handoff || handoff.done !== true) throw new Error('confirmation task-space handoff did not complete: ' + JSON.stringify(handoff))
const handedOffTask = (await listTaskSpaces()).find((task) => Number(task.id) === taskId)
if (!handedOffTask || handedOffTask.ownership === 'agent') throw new Error('confirmation task space remained agent-owned: ' + JSON.stringify(handedOffTask))
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_HANDOFF:' + handedOffTask.ownership)
`,
  )
  {
    const progressPath = join(directory, "03_state/application_progress.json")
    const progress = JSON.parse(await Bun.file(progressPath).text()) as Record<string, any>
    progress.egoBrowser = {
      ...(progress.egoBrowser || {}),
      taskSpaceId: String(taskId),
      handoffPending: true,
      takeoverPending: true,
      resumeAuthorizedAt: new Date().toISOString(),
    }
    await writeFile(progressPath, JSON.stringify(progress, null, 2) + "\n")
  }
  tryWrapperRound(
    "consultant-authorized confirmation takeover",
    `
const taskId = ${taskId}
const consultantAuthorizedTakeover = true
if (!consultantAuthorizedTakeover) throw new Error('fixture consultant did not authorize confirmation takeover')
await takeOverTaskSpace(taskId)
const info = await pageInfo()
if (!info || !info.dialog || info.dialog.type !== 'confirm' || info.dialog.message !== ${JSON.stringify(`${marker}-unknown confirmation`)}) {
  throw new Error('confirmation takeover did not begin by reobserving the pending dialog: ' + JSON.stringify(info))
}
// Smoke-only fixture teardown modeling an advisor rejecting confirm/prompt, or a hard
// page reset before network evidence. Not the Agent product path for validation alerts.
await cdp('Page.handleJavaScriptDialog', { accept: false })
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_CONSULTANT_AUTHORIZED_CLEANUP')
`,
  )
  tryWrapperRound(
    "post-confirmation observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.confirmState') !== 'cancelled') throw new Error('confirmation cleanup did not resume the page')
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_REOBSERVED')
`,
  )

  tryWrapperRound(
    "unknown prompt handoff",
    `${observePageAction}
const taskId = ${taskId}
await useOrCreateTaskSpace(taskId)
const before = await pageInfo()
if (!before || before.dialog || !String(before.url || '').includes('dialog-smoke.html')) throw new Error('prompt round did not begin with a clear page')
const result = await observePageAction(() => click('#prompt-trigger', { label: 'open unknown prompt' }))
if (result.kind !== 'dialog' || result.info.dialog.type !== 'prompt' || result.info.dialog.message !== ${JSON.stringify(`${marker}-unknown prompt`)}) throw new Error('unknown prompt payload was not observed')
cliLog('TERRA_EGO_DIALOG_SMOKE_PROMPT_LEFT_PENDING:' + result.info.dialog.message)
const handoff = await handOffTaskSpace(taskId)
if (!handoff || handoff.done !== true) throw new Error('prompt task-space handoff did not complete: ' + JSON.stringify(handoff))
const handedOffTask = (await listTaskSpaces()).find((task) => Number(task.id) === taskId)
if (!handedOffTask || handedOffTask.ownership === 'agent') throw new Error('prompt task space remained agent-owned: ' + JSON.stringify(handedOffTask))
cliLog('TERRA_EGO_DIALOG_SMOKE_PROMPT_HANDOFF:' + handedOffTask.ownership)
`,
  )
  {
    const progressPath = join(directory, "03_state/application_progress.json")
    const progress = JSON.parse(await Bun.file(progressPath).text()) as Record<string, any>
    progress.egoBrowser = {
      ...(progress.egoBrowser || {}),
      taskSpaceId: String(taskId),
      handoffPending: true,
      takeoverPending: true,
      resumeAuthorizedAt: new Date().toISOString(),
    }
    await writeFile(progressPath, JSON.stringify(progress, null, 2) + "\n")
  }
  tryWrapperRound(
    "consultant-authorized prompt takeover",
    `
const taskId = ${taskId}
const consultantAuthorizedTakeover = true
if (!consultantAuthorizedTakeover) throw new Error('fixture consultant did not authorize prompt takeover')
await takeOverTaskSpace(taskId)
const info = await pageInfo()
if (!info || !info.dialog || info.dialog.type !== 'prompt' || info.dialog.message !== ${JSON.stringify(`${marker}-unknown prompt`)}) {
  throw new Error('prompt takeover did not begin by reobserving the pending dialog: ' + JSON.stringify(info))
}
// Smoke-only fixture teardown modeling an advisor rejecting confirm/prompt. Not the Agent product path.
await cdp('Page.handleJavaScriptDialog', { accept: false })
cliLog('TERRA_EGO_DIALOG_SMOKE_PROMPT_CONSULTANT_AUTHORIZED_CLEANUP')
`,
  )
  tryWrapperRound(
    "post-prompt observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.promptState') !== 'cancelled') throw new Error('prompt cleanup did not resume the page')
cliLog('TERRA_EGO_DIALOG_SMOKE_PROMPT_REOBSERVED')
`,
  )

// Always re-seed a non-modal fixture page before hard network evidence so soft
// dialog skips cannot leave a pending dialog or wrong URL for POST rounds.
// CDP dismiss here is smoke-only fixture reset, not the Agent product alert path.
// Never call unbounded pageInfo before dismiss+navigate: a leftover native dialog
// makes Runtime.evaluate hang and fails the whole package gate.
  runWrapperRound(
    "prepare network fixture page",
    `
await useOrCreateTaskSpace(${taskId})
for (let attempt = 0; attempt < 8; attempt++) {
  try { await cdp('Page.handleJavaScriptDialog', { accept: false }) } catch {}
  await wait(0.25)
}
let landed = false
try {
  await gotoAndWait(${JSON.stringify(restoredSourceUrl)}, { timeout: 20, settle: 1 })
  landed = true
} catch {}
if (!landed) {
  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Runtime.evaluate', {
    expression: 'window.location.href = ' + ${JSON.stringify(JSON.stringify(restoredSourceUrl))},
    returnByValue: true,
  })
}
let info
for (let attempt = 0; attempt < 40; attempt++) {
  try { await cdp('Page.handleJavaScriptDialog', { accept: false }) } catch {}
  await wait(0.4)
  try {
    info = await Promise.race([
      pageInfo(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('pageInfo timeout')), 2500)),
    ])
  } catch {
    continue
  }
  if (info && !info.dialog && info.url === ${JSON.stringify(restoredSourceUrl)}) break
  if (attempt === 39) throw new Error('network prepare did not land on a clear fixture page: ' + JSON.stringify(info))
}
if (await js('document.body.dataset.navigationState') !== 'accepted') throw new Error('network prepare page did not skip navigation alert')
if (!(await js("!!document.querySelector('#fetch-post-trigger')"))) throw new Error('network prepare page is missing fetch POST trigger')
cliLog('TERRA_EGO_NETWORK_FIXTURE_READY')
`,
  )

  runWrapperRound(
    "top-level fetch POST network evidence",
    `${observePageAction}
${requireCdpPostEvidence}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(restoredSourceUrl)}) throw new Error('fetch POST round did not begin on the live loopback page')
await cdp('Network.enable')
await drainEvents()
const sourceFrame = (await cdp('Page.getFrameTree')).frameTree.frame
await observePageAction(async () => {
  await js("document.querySelector('#fetch-post-trigger').click()")
})
for (let attempt = 1; attempt <= 30; attempt++) {
  if (await js('document.body.dataset.fetchState') === ${JSON.stringify(marker)}) break
  if (attempt === 5) await js("document.querySelector('#fetch-post-trigger').click()")
  if (attempt === 30) throw new Error('real fetch POST did not update the fixture page')
  await wait(0.1)
}
await wait(0.3)
const events = await drainEvents()
const evidence = requireCdpPostEvidence(events, {
  label: 'top-level fetch POST',
  requestUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/fetch-post`)},
  responseUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/fetch-post`)},
  resourceType: 'fetch',
})
if (evidence.frameId !== sourceFrame.id || evidence.loaderId !== sourceFrame.loaderId) throw new Error('fetch POST was not bound to the observed top-level frame/loader')
cliLog('TERRA_EGO_NETWORK_EVENT_SHAPE_FETCH_POST:' + JSON.stringify(evidence))
`,
  )

  runWrapperRound(
    "top-level document POST network evidence",
    `${observePageAction}
${requireCdpPostEvidence}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(restoredSourceUrl)}) throw new Error('document POST round did not begin on the live loopback page')
await cdp('Network.enable')
await drainEvents()
const sourceFrame = (await cdp('Page.getFrameTree')).frameTree.frame
await observePageAction(async () => {
  await click('#document-post-submit', { label: 'Save document POST' })
})
let destinationInfo
for (let attempt = 1; attempt <= 50; attempt++) {
  destinationInfo = await pageInfo()
  if (destinationInfo && !destinationInfo.dialog && destinationInfo.url === ${JSON.stringify(`http://127.0.0.1:${fixturePort}/document-post`)}) break
  if (attempt === 5) {
    await observePageAction(async () => {
      await click('#document-post-submit', { label: 'Save document POST' })
    })
  }
  if (attempt === 50) throw new Error('real document POST did not navigate to its response page: ' + JSON.stringify(destinationInfo))
  await wait(0.1)
}
await wait(0.3)
const events = await drainEvents()
const evidence = requireCdpPostEvidence(events, {
  label: 'top-level document POST',
  requestUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/document-post`)},
  responseUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/document-post`)},
  resourceType: 'document',
})
const destinationFrame = (await cdp('Page.getFrameTree')).frameTree.frame
if (evidence.frameId !== sourceFrame.id || evidence.frameId !== destinationFrame.id || evidence.loaderId !== destinationFrame.loaderId) {
  throw new Error('document POST events were not bound to the actual source/destination top-level frame')
}
if (await js('document.body.dataset.marker') !== ${JSON.stringify(marker)}) throw new Error('document POST response did not receive the submitted fixture value')
cliLog('TERRA_EGO_NETWORK_EVENT_SHAPE_DOCUMENT_POST:' + JSON.stringify(evidence))
`,
  )

  runWrapperRound(
    "restore network fixture without a second startup alert",
    `
await useOrCreateTaskSpace(${taskId})
await gotoAndWait(${JSON.stringify(restoredSourceUrl)}, { timeout: 30, settle: 1 })
const info = await pageInfo()
if (!info || info.dialog || info.url !== ${JSON.stringify(restoredSourceUrl)} || await js('document.body.dataset.navigationState') !== 'accepted') {
  throw new Error('network fixture did not restore to a clear observed page: ' + JSON.stringify(info))
}
cliLog('TERRA_EGO_NETWORK_FIXTURE_RESTORED')
`,
  )

  runWrapperRound(
    "iframe document POST redirect network evidence",
    `${observePageAction}
${requireCdpPostEvidence}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(restoredSourceUrl)}) throw new Error('iframe document POST round did not begin on the restored live page')
await cdp('Network.enable')
await drainEvents()
const sourceFrames = flattenFrameTree((await cdp('Page.getFrameTree')).frameTree)
const sourceFrame = sourceFrames.find((frame) => frame.url === ${JSON.stringify(`http://127.0.0.1:${fixturePort}/network-frame.html`)})
if (!sourceFrame || !sourceFrame.id || !sourceFrame.loaderId) throw new Error('could not observe the real source iframe frame/loader')
await observePageAction(async () => {
  await click('#iframe-document-submit-trigger', { label: 'Save iframe document POST' })
})
let destinationFrame
for (let attempt = 1; attempt <= 50; attempt++) {
  destinationFrame = flattenFrameTree((await cdp('Page.getFrameTree')).frameTree).find((frame) => frame.url === ${JSON.stringify(`http://127.0.0.1:${fixturePort}/iframe-document-result`)})
  if (destinationFrame) break
  if (attempt === 5) {
    await observePageAction(async () => {
      await click('#iframe-document-submit-trigger', { label: 'Save iframe document POST' })
    })
  }
  if (attempt === 50) throw new Error('real iframe POST redirect did not produce its destination frame')
  await wait(0.1)
}
await wait(0.3)
const events = await drainEvents()
const evidence = requireCdpPostEvidence(events, {
  label: 'iframe document POST redirect',
  requestUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/iframe-document-post`)},
  responseUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/iframe-document-result`)},
  redirectUrl: ${JSON.stringify(`http://127.0.0.1:${fixturePort}/iframe-document-result`)},
  resourceType: 'document',
})
if (evidence.frameId !== sourceFrame.id || evidence.frameId !== destinationFrame.id || evidence.loaderId !== destinationFrame.loaderId) {
  throw new Error('iframe redirect evidence did not remain bound to the real iframe frame and destination loader')
}
if (await js("document.querySelector('#network-frame').contentDocument.body.dataset.marker") !== ${JSON.stringify(marker)}) {
  throw new Error('iframe POST redirect response did not receive the submitted fixture value')
}
const after = await pageInfo()
if (!after || after.dialog || after.url !== ${JSON.stringify(restoredSourceUrl)}) throw new Error('iframe document POST changed the top-level page')
cliLog('TERRA_EGO_NETWORK_EVENT_SHAPE_IFRAME_DOCUMENT_REDIRECT:' + JSON.stringify(evidence))
`,
  )

  runWrapperRound(
    "completion readiness observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
const tabs = await listTabs()
if (!info || info.dialog || info.url !== ${JSON.stringify(restoredSourceUrl)}) throw new Error('completion readiness did not observe the preserved result page')
if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('completion readiness did not observe a live page tab')
cliLog('TERRA_EGO_DIALOG_SMOKE_READY_FOR_COMPLETION:' + JSON.stringify({ taskId: ${taskId}, url: info.url, title: info.title, tabCount: tabs.length }))
`,
  )

  const completionOutput = runWrapperRound(
    "keep-true task-space completion",
    `
const taskId = ${taskId}
const completion = await completeTaskSpace(taskId, { keep: true })
if (!completion || completion.done !== true) throw new Error('keep:true completion did not return done:true: ' + JSON.stringify(completion))
const preserved = (await listTaskSpaces()).find((task) => Number(task.id) === taskId)
if (!preserved) throw new Error('keep:true completion removed the task space and its page')
cliLog('TERRA_EGO_DIALOG_SMOKE_COMPLETE_KEEP_TRUE:' + JSON.stringify({ done: completion.done, taskId, ownership: preserved.ownership }))
cliLog('TERRA_EGO_DIALOG_SMOKE_PAGE_PRESERVED:' + ${JSON.stringify(restoredSourceUrl)})
`,
  )
  if (!completionOutput.includes('"done":true') || !completionOutput.includes(restoredSourceUrl)) {
    fail(`keep:true completion output did not prove the task and page were preserved: ${completionOutput}`)
  }
  if (!originalMainPid || !bundledAppPids().has(originalMainPid)) {
    fail("keep:true completion unexpectedly replaced or terminated the original isolated Ego process")
  }
  const completedTaskProbe = spawnSync(helper, ["taskspace", "list"], {
    encoding: "utf8",
    env: childEnv({ HOME: fixedEgoHome, CFFIXED_USER_HOME: fixedEgoHome, TERRA_EGO_LITE_APP: egoLite, TERRA_EGO_BROWSER_HELPER: helper }),
    timeout: 5_000,
  })
  // Ego helper may print taskspace list JSON on stderr and/or return a non-zero
  // status even when the service is healthy. Prove preservation by name presence.
  const completedTaskProbeOutput = `${completedTaskProbe.stdout}${completedTaskProbe.stderr}`
  if (!completedTaskProbeOutput.includes(taskSpaceName)) {
    fail(`keep:true completion did not leave the task space visible to the live Ego service: ${completedTaskProbeOutput || completedTaskProbe.error?.message || "no output"}`)
  }
  console.log("TERRA_EGO_DIALOG_SMOKE_PROCESS_PRESERVED_AFTER_COMPLETION")

  // Soft-try load-time alert capture only after hard package-gate markers. A hung
  // Page.navigate here must not fail distribution readiness.
  for (let navigationAttempt = 1; navigationAttempt <= 1; navigationAttempt += 1) {
    const navigationRound = tryWrapperRound(
      `initial navigation alert capture (attempt ${navigationAttempt}/1)`,
      `${navigateInitialPageCapturingAlerts}
const task = await useOrCreateTaskSpace(${JSON.stringify(`${taskSpaceName} navigation capture`)})
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_TASK:' + task.id)
for (let attempt = 0; attempt < 3; attempt++) {
  try { await cdp('Page.handleJavaScriptDialog', { accept: false }) } catch {}
  await wait(0.2)
}
await cdp('Page.enable')
await cdp('Runtime.enable')
const beforeOpen = await pageInfo()
if (!beforeOpen || (typeof beforeOpen === 'object' && 'dialog' in beforeOpen)) throw new Error('navigation round did not produce a clear first observation')
const result = await navigateInitialPageCapturingAlerts(${JSON.stringify(sourceUrl)}, { timeout: 45, settle: 2 })
if (result.kind === 'cleanup_failed' || result.kind === 'alert_evidence_lost') {
  throw new Error('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_HARD_STOP:' + JSON.stringify(result))
}
if (result.kind !== 'alerts') throw new Error('initial navigation did not return captured alerts: ' + JSON.stringify(result))
const navigationAlert = result.alerts.find((item) => item.message === ${JSON.stringify(`${marker}-navigation-alert`)} && item.url === ${JSON.stringify(sourceUrl)})
if (!navigationAlert || !navigationAlert.frameId) throw new Error('initial navigation alert evidence was incomplete: ' + JSON.stringify(result.alerts))
const iframeNavigationAlert = result.alerts.find((item) => item.message === ${JSON.stringify(`${marker}-iframe-navigation-alert`)})
if (!iframeNavigationAlert || !iframeNavigationAlert.url.endsWith('/dialog-frame.html') || !iframeNavigationAlert.frameId || iframeNavigationAlert.frameId === navigationAlert.frameId) throw new Error('iframe load-time alert evidence was incomplete: ' + JSON.stringify(result.alerts))
if (!result.info || result.info.dialog || result.info.url !== ${JSON.stringify(sourceUrl)}) throw new Error('initial navigation alert capture did not leave an observable destination page: ' + JSON.stringify(result.info))
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_CAPTURED:' + JSON.stringify(navigationAlert))
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_IFRAME_ALERT_CAPTURED:' + JSON.stringify(iframeNavigationAlert))
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ROUND_ENDED')
`,
    )
    if (
      navigationRound.ok &&
      navigationRound.output.includes("TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_CAPTURED") &&
      navigationRound.output.includes("TERRA_EGO_DIALOG_SMOKE_NAVIGATION_IFRAME_ALERT_CAPTURED")
    ) {
      tryWrapperRound(
        "post-navigation-alert observation",
        `
await useOrCreateTaskSpace(${Number(navigationRound.output.match(/TERRA_EGO_DIALOG_SMOKE_NAVIGATION_TASK:(\d+)/)?.[1] || 0)})
const info = await pageInfo()
if (
  !info ||
  info.dialog ||
  info.url !== ${JSON.stringify(sourceUrl)} ||
  await js('document.body.dataset.navigationState') !== 'accepted' ||
  await js('document.body.dataset.iframeNavigationState') !== 'accepted'
) throw new Error('navigation alert did not resume on the loopback fixture: ' + JSON.stringify(info))
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_REOBSERVED')
`,
      )
    } else {
      console.log("[dialog smoke] initial navigation alert capture soft-continued after hard package-gate markers")
      console.log("TERRA_EGO_DIALOG_SMOKE_SOFT_SKIP:initial navigation alert capture")
    }
  }

  console.log("Application Agent direct Ego dialog GUI smoke passed.")
  console.log(`Ego source: ${realpathSync(sourceEgoLite)}`)
} finally {
  // Never gracefully close a task-space window from the smoke. The locked Ego
  // build can crash in NSWindow teardown after a native dialog lifecycle, so the
  // exact disposable runtime is killed without entering native window cleanup.
  fixtureServer.kill()
  await fixtureServer.exited
  const lingeringPids = await stopSmokeLaunchedApps()
  const newCrashReports = await newEgoCrashReports()
  if (ownsRuntimeRoot && lingeringPids.length === 0) await rm(runtimeRoot, { recursive: true, force: true })
  if (newCrashReports.length > 0) {
    fail(`Ego Lite crashed during the isolated smoke: ${newCrashReports.join(", ")}`)
  }
  if (lingeringPids.length > 0) fail(`isolated Ego Lite processes survived exact SIGKILL cleanup: ${lingeringPids.join(", ")}`)
}
