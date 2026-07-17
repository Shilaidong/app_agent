import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const app = process.argv[2] ? resolve(process.argv[2]) : undefined
const marker = `terra-edu-direct-dialog-${process.pid}-${Date.now()}`
const taskSpaceName = `Terra-Edu direct dialog smoke ${marker}`

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

const sourceEgoLite = join(app, "Contents/Resources/vendor/ego-lite/ego lite.app")
const expectedEgoVersion = "0.4.4.15"
const runtimeRoot = await mkdtemp(join(tmpdir(), "terra-edu-direct-dialog-runtime-"))
const egoLite = join(runtimeRoot, "ego lite.app")
const fixedEgoHome = join(runtimeRoot, "home")
const fixedEgoConfigDirectory = join(fixedEgoHome, "Library/Application Support/Citro Labs/ego lite")
const helper = join(egoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`)
const directory = join(runtimeRoot, "workspace")

async function failAfterRuntimeSetup(message: string): Promise<never> {
  await rm(runtimeRoot, { recursive: true, force: true })
  fail(message)
}

if (!existsSync(sourceEgoLite)) fail("packaged ego lite source is missing")

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
  return pids(`${egoLite}/Contents/MacOS/`)
}

function egoAppPids() {
  return pids("ego lite.app/Contents/")
}

function hasEgoBrowserService() {
  const user = spawnSync("/usr/bin/id", ["-u"], { encoding: "utf8" })
  if (user.status !== 0) fail(`could not read the macOS user ID: ${user.stderr || user.error?.message || "unknown error"}`)
  return spawnSync("/bin/launchctl", ["print", `gui/${user.stdout.trim()}`], { encoding: "utf8", timeout: 5_000 }).stdout.includes(
    "com.citrolabs.ego.lite.ego-browser",
  )
}

const existingBundledAppPids = bundledAppPids()
if (existingBundledAppPids.size > 0 || egoAppPids().size > 0 || hasEgoBrowserService()) {
  fail(
    "TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE: another Ego Lite browser service is active. The smoke test will not use, close, or replace it; close the other Ego Lite app before retrying this release check.",
  )
}

const sourceSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", sourceEgoLite], {
  encoding: "utf8",
  timeout: 30_000,
})
if (sourceSignature.status !== 0) fail(`packaged Ego Lite source signature is invalid: ${sourceSignature.stderr || sourceSignature.error?.message || "unknown error"}`)

const copy = spawnSync("ditto", [sourceEgoLite, egoLite], { encoding: "utf8", timeout: 120_000 })
if (copy.status !== 0) fail(`could not prepare isolated Ego Lite runtime: ${copy.stderr || copy.error?.message || "unknown error"}`)
if (!existsSync(helper)) fail("isolated Ego Lite helper is missing")

const runtimeSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", egoLite], {
  encoding: "utf8",
  timeout: 30_000,
})
if (runtimeSignature.status !== 0) fail(`isolated Ego Lite signature is invalid: ${runtimeSignature.stderr || runtimeSignature.error?.message || "unknown error"}`)

await mkdir(fixedEgoConfigDirectory, { recursive: true })
await writeFile(join(fixedEgoConfigDirectory, "ego_config.json"), JSON.stringify({ not_first_run: true }) + "\n", { flag: "wx", mode: 0o600 })
await mkdir(join(directory, "03_state"), { recursive: true })
await Promise.all([
  writeFile(join(directory, "03_state/material_review.json"), JSON.stringify({ status: "approved", mode: "skip" }, null, 2) + "\n"),
  writeFile(join(directory, "03_state/task_control.json"), JSON.stringify({ paused: false }, null, 2) + "\n"),
])
const packageConfigProbe = spawnSync(appExecutable, ["--terra-package-smoke-write-opencode"], {
  encoding: "utf8",
  env: {
    ...process.env,
    CFFIXED_USER_HOME: fixedEgoHome,
    TERRA_EDU_PACKAGE_SMOKE_WORKSPACE: directory,
    TERRA_EDU_PACKAGE_SMOKE_RUNTIME_ROOT: runtimeRoot,
  },
  timeout: 30_000,
})
const packageConfigProbeOutput = `${packageConfigProbe.stdout}${packageConfigProbe.stderr}`
if (packageConfigProbe.status !== 0) {
  await failAfterRuntimeSetup(
    `packaged config probe failed (exit ${packageConfigProbe.status ?? "unknown"}${packageConfigProbe.signal ? `, signal ${packageConfigProbe.signal}` : ""}): ${packageConfigProbeOutput || packageConfigProbe.error?.message || "no output"}`,
  )
}
if (!packageConfigProbeOutput.includes("TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN")) {
  await failAfterRuntimeSetup(`packaged config probe did not confirm wrapper generation: ${packageConfigProbeOutput || "no output"}`)
}
if (!existsSync(join(directory, ".opencode/bin/ego-browser"))) await failAfterRuntimeSetup("packaged config probe did not generate the ego-browser wrapper")
if (!existsSync(join(directory, ".opencode/skills/ego-browser/SKILL.md"))) await failAfterRuntimeSetup("packaged config probe did not generate the ego-browser skill")
const packagedWrapper = await Bun.file(join(directory, ".opencode/bin/ego-browser")).text()
if (
  !packagedWrapper.includes("APP_PATH=") ||
  !packagedWrapper.includes(sourceEgoLite) ||
  !packagedWrapper.includes("RUNTIME_ROOT=") ||
  !packagedWrapper.includes(runtimeRoot)
) {
  await failAfterRuntimeSetup("packaged config probe generated a wrapper for the wrong app or runtime root")
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

const launch = spawnSync(
  "open",
  ["-n", "-gj", "--env", `CFFIXED_USER_HOME=${fixedEgoHome}`, egoLite, "--args", "--no-default-browser-check", "--no-first-run"],
  { encoding: "utf8", timeout: 15_000 },
)
if (launch.status !== 0) fail(`could not launch isolated Ego Lite runtime: ${launch.stderr || launch.error?.message || "unknown error"}`)

async function stopSmokeLaunchedApps() {
  const launchedPids = () => [...bundledAppPids()].filter((pid) => !existingBundledAppPids.has(pid))
  for (const pid of launchedPids()) spawnSync("/bin/kill", ["-TERM", String(pid)], { encoding: "utf8" })
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (launchedPids().length === 0) return
    await Bun.sleep(1_000)
  }
  for (const pid of launchedPids()) spawnSync("/bin/kill", ["-KILL", String(pid)], { encoding: "utf8" })
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
      env: { ...process.env, CFFIXED_USER_HOME: fixedEgoHome, TERRA_EGO_LITE_APP: egoLite, TERRA_EGO_BROWSER_HELPER: helper },
      timeout: 5_000,
    })
    if (result.status === 0) return
    if (result.status === 255) fail("TERRA_EGO_BROWSER_VERSION_CONFLICT: an incompatible Ego Lite service is active.")
    if (result.status !== 252) fail(`bundled Ego readiness failed with exit ${result.status ?? "unknown"}: ${result.stderr || result.stdout || result.error?.message || "no output"}`)
    if (attempt < 15) await Bun.sleep(1_000)
  }
  fail("TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: packaged Ego Lite did not become ready within 15 seconds.")
}

function runWrapperRound(label: string, source: string) {
  const wrapper = join(directory, ".opencode/bin/ego-browser")
  const result = spawnSync(wrapper, ["nodejs"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, CFFIXED_USER_HOME: fixedEgoHome },
    input: source,
    timeout: 60_000,
  })
  const output = `${result.stdout}${result.stderr}`
  if (result.status !== 0) {
    fail(`${label} failed (exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""}): ${output || result.error?.message || "no output"}`)
  }
  return output
}

const fixturePort = 40_000 + (process.pid % 10_000)
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`
const fixtureHtml = `<!doctype html>
<body data-navigation-state="waiting" data-alert-state="waiting" data-delayed-state="waiting" data-iframe-state="waiting" data-confirm-state="waiting" data-prompt-state="waiting">
  <button id="alert-trigger" onclick="alert(${JSON.stringify(`${marker}-alert`)});document.body.dataset.alertState='accepted'">Open alert</button>
  <button id="delayed-alert-trigger" onclick="setTimeout(()=>{alert(${JSON.stringify(`${marker}-delayed-alert`)});document.body.dataset.delayedState='accepted'},700);document.body.dataset.delayedState='scheduled'">Schedule delayed alert</button>
  <button id="iframe-alert-trigger" onclick="document.querySelector('iframe').contentWindow.openIframeAlert()">Open iframe alert</button>
  <button id="beforeunload-trigger" onclick="location.href='/left.html'">Attempt to leave</button>
  <button id="confirm-trigger" onclick="document.body.dataset.confirmState=confirm(${JSON.stringify(`${marker}-unknown confirmation`)})?'accepted':'cancelled'">Open confirmation</button>
  <button id="prompt-trigger" onclick="document.body.dataset.promptState=prompt(${JSON.stringify(`${marker}-unknown prompt`)},'fixture default')===null?'cancelled':'accepted'">Open prompt</button>
  <iframe title="same-origin alert fixture" src="/dialog-frame.html"></iframe>
  <script>window.blockBeforeUnload=true;window.__disableBeforeUnload=()=>{window.blockBeforeUnload=false};setTimeout(()=>{alert(${JSON.stringify(`${marker}-navigation-alert`)});document.body.dataset.navigationState='accepted'},600);window.addEventListener('beforeunload',(event)=>{if(!window.blockBeforeUnload)return;event.preventDefault();event.returnValue=''})</script>
</body>`
const fixtureFrameHtml = `<!doctype html><body><script>window.openIframeAlert=()=>{alert(${JSON.stringify(`${marker}-iframe-alert: Title of degree; Abbreviation; Date of award`)});parent.document.body.dataset.iframeState='accepted'}</script></body>`
const fixtureServer = Bun.spawn(
  [
    process.execPath,
    "-e",
    "Bun.serve({hostname:'127.0.0.1',port:Number(process.env.TERRA_EDU_FIXTURE_PORT),fetch(request){const path=new URL(request.url).pathname;if(path==='/dialog-frame.html')return new Response(process.env.TERRA_EDU_FIXTURE_FRAME_HTML,{headers:{'content-type':'text/html; charset=utf-8'}});if(path==='/left.html')return new Response('<!doctype html><title>unexpected navigation</title>',{headers:{'content-type':'text/html; charset=utf-8'}});if(path!=='/dialog-smoke.html')return new Response('Not found',{status:404});return new Response(process.env.TERRA_EDU_FIXTURE_HTML,{headers:{'content-type':'text/html; charset=utf-8'}})}});setInterval(()=>{},2**30)",
  ],
  {
    env: {
      ...process.env,
      TERRA_EDU_FIXTURE_PORT: String(fixturePort),
      TERRA_EDU_FIXTURE_HTML: fixtureHtml,
      TERRA_EDU_FIXTURE_FRAME_HTML: fixtureFrameHtml,
    },
    stderr: "pipe",
    stdout: "ignore",
  },
)

const sourceUrl = `${fixtureOrigin}/dialog-smoke.html`
let taskId: number | undefined

try {
  const fixtureReady = await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      await Bun.sleep(index * 50)
      return fetch(sourceUrl).then((response) => response.ok).catch(() => false)
    }),
  )
  if (!fixtureReady.some(Boolean)) fail("loopback fixture did not start")
  await waitForBundledApp()
  await waitForBundledService()

  const initial = runWrapperRound(
    "initial observation",
    `${observePageAction}
const task = await useOrCreateTaskSpace(${JSON.stringify(taskSpaceName)})
const beforeOpen = await pageInfo()
if (!beforeOpen || (typeof beforeOpen === 'object' && 'dialog' in beforeOpen)) throw new Error('initial task space did not produce a clear first observation')
const result = await observePageAction(
  () => openOrReuseTab(${JSON.stringify(sourceUrl)}, { wait: true, timeout: 30 }),
  { actionTimeoutMs: 30000 },
)
if (
  result.kind !== 'dialog' ||
  result.info.dialog.type !== 'alert' ||
  result.info.dialog.message !== ${JSON.stringify(`${marker}-navigation-alert`)} ||
  result.info.dialog.url !== ${JSON.stringify(sourceUrl)}
) throw new Error('navigation alert payload was not observed: ' + JSON.stringify(result))
await cdp('Page.handleJavaScriptDialog', { accept: true })
const action = await Promise.race([
  result.actionPromise,
  new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 5000)),
])
if (!action || action.status !== 'resolved') throw new Error('initial navigation did not settle after its alert was handled: ' + JSON.stringify(action))
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_HANDLED')
cliLog('TERRA_EGO_DIALOG_SMOKE_TASK:' + task.id)
`,
  )
  const taskMatch = initial.match(/TERRA_EGO_DIALOG_SMOKE_TASK:(\d+)/)
  if (!taskMatch) fail(`could not read task-space ID: ${initial}`)
  taskId = Number(taskMatch[1])
  await writeFile(
    join(directory, "03_state/application_progress.json"),
    JSON.stringify({
      currentPage: "Terra direct dialog smoke",
      currentUrl: sourceUrl,
      browserBackend: "ego-browser",
      egoBrowser: { taskSpaceId: String(taskId), taskSpaceName, backend: "ego-browser" },
    }, null, 2) + "\n",
  )

  runWrapperRound(
    "post-navigation-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (
  !info ||
  info.dialog ||
  info.url !== ${JSON.stringify(sourceUrl)} ||
  await js('document.body.dataset.navigationState') !== 'accepted'
) throw new Error('navigation alert did not resume on the loopback fixture: ' + JSON.stringify(info))
cliLog('TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_REOBSERVED')
`,
  )

  runWrapperRound(
    "top-level alert",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(sourceUrl)}) throw new Error('top-level alert round did not begin with a clear page')
const result = await observePageAction(() => click('#alert-trigger', { label: 'open alert fixture' }))
if (result.kind !== 'dialog' || result.info.dialog.type !== 'alert' || result.info.dialog.message !== ${JSON.stringify(`${marker}-alert`)}) throw new Error('top-level alert payload was not observed')
await cdp('Page.handleJavaScriptDialog', { accept: true })
await Promise.race([result.actionPromise, new Promise((resolve) => setTimeout(resolve, 2000))])
cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_HANDLED')
`,
  )
  runWrapperRound(
    "post-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.alertState') !== 'accepted') throw new Error('top-level alert did not resume')
cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_REOBSERVED')
`,
  )

  runWrapperRound(
    "delayed alert after settled action",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(sourceUrl)}) throw new Error('delayed-alert round did not begin with a clear page')
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
await cdp('Page.handleJavaScriptDialog', { accept: true })
cliLog('TERRA_EGO_DIALOG_SMOKE_DELAYED_ALERT_AFTER_ACTION')
`,
  )
  runWrapperRound(
    "post-delayed-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.delayedState') !== 'accepted') throw new Error('delayed alert did not resume')
cliLog('TERRA_EGO_DIALOG_SMOKE_DELAYED_ALERT_REOBSERVED')
`,
  )

  const iframeOutput = runWrapperRound(
    "same-origin iframe alert",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(sourceUrl)}) throw new Error('iframe alert round did not begin with a clear page')
const result = await observePageAction(() => click('#iframe-alert-trigger', { label: 'save iframe fixture' }))
if (result.kind !== 'dialog') throw new Error('iframe alert was not observed while click remained pending: ' + JSON.stringify(result))
const dialog = result.info.dialog
if (dialog.type !== 'alert' || !dialog.url.endsWith('/dialog-frame.html') || !dialog.frameId || dialog.message !== ${JSON.stringify(`${marker}-iframe-alert: Title of degree; Abbreviation; Date of award`)}) throw new Error('iframe alert payload was incomplete: ' + JSON.stringify(dialog))
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_TEXT:' + dialog.message)
await cdp('Page.handleJavaScriptDialog', { accept: true })
const action = await Promise.race([result.actionPromise, new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 2000))])
if (!action || action.status !== 'resolved') throw new Error('iframe click did not settle after direct dialog handling: ' + JSON.stringify(action))
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_HANDLED')
`,
  )
  if (!iframeOutput.includes("Title of degree; Abbreviation; Date of award")) fail("iframe validation text was not preserved in helper output")
  runWrapperRound(
    "post-iframe-alert observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.iframeState') !== 'accepted') throw new Error('iframe alert did not resume')
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED')
`,
  )

  runWrapperRound(
    "beforeunload cancellation",
    `${observePageAction}
await useOrCreateTaskSpace(${taskId})
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(sourceUrl)}) throw new Error('beforeunload round did not begin with a clear page')
const result = await observePageAction(() => click('#beforeunload-trigger', { label: 'attempt fixture navigation' }))
if (result.kind !== 'dialog' || result.info.dialog.type !== 'beforeunload') throw new Error('beforeunload dialog was not observed')
await cdp('Page.handleJavaScriptDialog', { accept: false })
await Promise.race([result.actionPromise, new Promise((resolve) => setTimeout(resolve, 2000))])
cliLog('TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_CANCELLED:' + before.url)
`,
  )
  runWrapperRound(
    "post-beforeunload observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || info.url !== ${JSON.stringify(sourceUrl)}) throw new Error('beforeunload cancellation did not preserve the URL')
await js('window.__disableBeforeUnload()')
cliLog('TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_REOBSERVED')
`,
  )

  runWrapperRound(
    "unknown confirmation handoff",
    `${observePageAction}
const taskId = ${taskId}
await useOrCreateTaskSpace(taskId)
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(sourceUrl)}) throw new Error('confirmation round did not begin with a clear page')
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
  runWrapperRound(
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
// This local fixture models an advisor-authorized takeover; rejecting the dialog is teardown, not an autonomous product decision.
await cdp('Page.handleJavaScriptDialog', { accept: false })
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_CONSULTANT_AUTHORIZED_CLEANUP')
`,
  )
  runWrapperRound(
    "post-confirmation observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.confirmState') !== 'cancelled') throw new Error('confirmation cleanup did not resume the page')
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_REOBSERVED')
`,
  )

  runWrapperRound(
    "unknown prompt handoff",
    `${observePageAction}
const taskId = ${taskId}
await useOrCreateTaskSpace(taskId)
const before = await pageInfo()
if (!before || before.dialog || before.url !== ${JSON.stringify(sourceUrl)}) throw new Error('prompt round did not begin with a clear page')
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
  runWrapperRound(
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
// This local fixture models an advisor-authorized takeover; rejecting the dialog is teardown, not an autonomous product decision.
await cdp('Page.handleJavaScriptDialog', { accept: false })
cliLog('TERRA_EGO_DIALOG_SMOKE_PROMPT_CONSULTANT_AUTHORIZED_CLEANUP')
`,
  )
  runWrapperRound(
    "post-prompt observation",
    `
await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || info.dialog || await js('document.body.dataset.promptState') !== 'cancelled') throw new Error('prompt cleanup did not resume the page')
cliLog('TERRA_EGO_DIALOG_SMOKE_PROMPT_REOBSERVED')
`,
  )

  runWrapperRound(
    "task-space cleanup",
    `
const result = await completeTaskSpace(${taskId}, { keep: false })
if (!result || result.done !== true) throw new Error('dialog smoke task space did not close')
cliLog('TERRA_EGO_DIALOG_SMOKE_CLEANUP')
`,
  )
  taskId = undefined
  console.log("Application Agent direct Ego dialog GUI smoke passed.")
  console.log(`Ego source: ${realpathSync(sourceEgoLite)}`)
} finally {
  if (taskId) {
    try {
      runWrapperRound("failure cleanup", `const result = await completeTaskSpace(${taskId}, { keep: false }); cliLog(JSON.stringify(result))`)
    } catch {}
  }
  fixtureServer.kill()
  await fixtureServer.exited
  await stopSmokeLaunchedApps()
  await rm(runtimeRoot, { recursive: true, force: true })
}
