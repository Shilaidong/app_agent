import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { writeOpenCodeConfig } from "../src/main/application-agent-opencode"

const app = process.argv[2] ? resolve(process.argv[2]) : undefined
const marker = `terra-edu-release-dialog-smoke-${process.pid}-${Date.now()}`

function fail(message: string): never {
  throw new Error(`GUI dialog smoke is required for distribution readiness: ${message}`)
}

if (process.platform !== "darwin") fail("the packaged ego lite dialog check requires macOS")
if (!app || !existsSync(app)) fail("missing packaged application path")

const sourceEgoLite = join(app, "Contents/Resources/vendor/ego-lite/ego lite.app")
const runtimeRoot = await mkdtemp(join(tmpdir(), "terra-edu-ego-runtime-smoke-"))
const egoLite = join(runtimeRoot, "ego lite.app")
const expectedEgoVersion = "0.4.4.15"
const helper = join(egoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`)
const sourceHelper = join(sourceEgoLite, `Contents/Frameworks/ego Framework.framework/Versions/${expectedEgoVersion}/Helpers/ego-browser`)
const dialogGuard = join(app, "Contents/Resources/vendor/terra-dialog-guard/terra-dialog-guard")
if (!existsSync(sourceEgoLite)) fail("packaged ego lite source is missing")
if (!existsSync(sourceHelper)) fail("packaged ego-browser source helper is missing")
if (!existsSync(dialogGuard)) fail("packaged native dialog guard is missing")

function bundledAppPids() {
  const result = spawnSync("/usr/bin/pgrep", ["-f", `${egoLite}/Contents/MacOS/`], { encoding: "utf8" })
  return new Set(
    result.stdout
      .split("\n")
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )
}

function egoAppPids() {
  const result = spawnSync("/usr/bin/pgrep", ["-f", "ego lite.app/Contents/"], { encoding: "utf8" })
  return new Set(
    result.stdout
      .split("\n")
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )
}

function hasEgoBrowserService() {
  const user = spawnSync("/usr/bin/id", ["-u"], { encoding: "utf8" })
  if (user.status !== 0) fail(`could not read the macOS user ID: ${user.stderr || user.error?.message || "unknown error"}`)
  return spawnSync("/bin/launchctl", ["print", `gui/${user.stdout.trim()}`], { encoding: "utf8", timeout: 5_000 }).stdout.includes("com.citrolabs.ego.lite.ego-browser")
}

const existingBundledAppPids = bundledAppPids()
if (existingBundledAppPids.size > 0 || egoAppPids().size > 0 || hasEgoBrowserService()) {
  fail("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE: another Ego Lite browser service is active. The smoke test will not use, close, or replace that browser; close the other Ego Lite app before retrying this release check.")
}
const sourceSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", sourceEgoLite], { encoding: "utf8", timeout: 30_000 })
if (sourceSignature.status !== 0) fail(`packaged Ego Lite source signature is invalid: ${sourceSignature.stderr || sourceSignature.error?.message || "unknown error"}`)
const copy = spawnSync("ditto", [sourceEgoLite, egoLite], { encoding: "utf8", timeout: 120_000 })
if (copy.status !== 0) {
  spawnSync("/bin/rm", ["-rf", runtimeRoot], { encoding: "utf8" })
  fail(`could not prepare isolated Ego Lite runtime: ${copy.stderr || copy.error?.message || "unknown error"}`)
}
const runtimeSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", egoLite], { encoding: "utf8", timeout: 30_000 })
if (runtimeSignature.status !== 0 || !existsSync(helper)) {
  spawnSync("/bin/rm", ["-rf", runtimeRoot], { encoding: "utf8" })
  fail(`isolated Ego Lite runtime validation failed: ${runtimeSignature.stderr || runtimeSignature.error?.message || "missing helper"}`)
}
const launch = spawnSync("open", ["-n", "-gj", egoLite, "--args", "--no-default-browser-check", "--no-first-run"], {
  encoding: "utf8",
  timeout: 15_000,
})
if (launch.status !== 0) {
  spawnSync("/bin/rm", ["-rf", runtimeRoot], { encoding: "utf8" })
  fail(`could not launch isolated Ego Lite runtime: ${launch.stderr || launch.error?.message || "unknown error"}`)
}

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
      env: { ...process.env, TERRA_EGO_LITE_APP: egoLite, TERRA_EGO_BROWSER_HELPER: helper },
      timeout: 5_000,
    })
    if (result.status === 0) return
    if (result.status === 255) {
      fail(
        "TERRA_EGO_BROWSER_VERSION_CONFLICT: another incompatible Ego Lite browser service is active. The smoke test will not use, close, or replace that browser; close the other Ego Lite app before retrying this release check.",
      )
    }
    if (result.status !== 252) {
      fail(
        `TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: bundled Ego Lite readiness failed with exit ${result.status ?? "unknown"}: ${result.stderr || result.stdout || result.error?.message || "no helper output"}`,
      )
    }
    if (attempt < 15) await Bun.sleep(1_000)
  }
  fail("TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: bundled Ego Lite did not become ready within 15 seconds.")
}

function runHelperRound(label: string, source: string, directory: string) {
  const result = spawnSync(helper, ["nodejs"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, TERRA_EGO_LITE_APP: egoLite, TERRA_EGO_BROWSER_HELPER: helper },
    input: source,
    timeout: 90_000,
  })
  if (result.status !== 0) {
    if (result.status === 255) {
      fail(
        `${label} hit TERRA_EGO_BROWSER_VERSION_CONFLICT: the bundled helper refuses the active incompatible Ego Lite service; the smoke test did not touch that browser.`,
      )
    }
    fail(
      `${label} round failed (exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""}): ${result.stderr || result.stdout || result.error?.message || "no helper output"}`,
    )
  }
  // ego-browser writes cliLog to stderr when launched through Node's spawnSync,
  // while an interactive shell merges it into the terminal stream. Treat both
  // streams as the protocol output so this fixture exercises the packaged path.
  return `${result.stdout}${result.stderr}`
}

function runWrapperRound(label: string, source: string, directory: string, wrapper: string, expectedStatus: 0 | 74, completionMarker: string) {
  const result = spawnSync(wrapper, ["nodejs"], {
    cwd: directory,
    encoding: "utf8",
    input: source,
    timeout: 90_000,
  })
  if (result.status !== expectedStatus) {
    fail(`${label} exited ${result.status ?? "unknown"} instead of ${expectedStatus}: ${result.stderr || result.stdout || result.error?.message || "no wrapper output"}`)
  }
  const output = `${result.stdout}${result.stderr}`
  if (!output.includes(completionMarker)) fail(`${label} did not prove that its browser script completed: ${output}`)
  if (expectedStatus === 74 && !output.includes("TERRA_EGO_NATIVE_DIALOG_")) {
    fail(`${label} did not return the native-dialog wrapper marker: ${output}`)
  }
  if (expectedStatus === 0 && output.includes("TERRA_EGO_NATIVE_DIALOG_")) {
    fail(`${label} unexpectedly encountered another native dialog: ${output}`)
  }
  return output
}

function taskSpaceId(output: string) {
  const match = output.match(/TERRA_EGO_DIALOG_SMOKE_TASK:(\d+)/)
  if (!match) fail(`could not read task-space ID from ego-browser output: ${output}`)
  return Number(match[1])
}

async function readWrapperDialog(directory: string, expectedTaskSpaceId: string, expectedTaskSpaceName: string, expectedUrl: string) {
  const path = join(directory, "03_state/native_dialog_last.json")
  if (!existsSync(path)) fail("workspace wrapper did not persist native_dialog_last.json")
  const contents = await Bun.file(path).text()
  const parsed: unknown = JSON.parse(contents)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("workspace wrapper dialog evidence is not an object")
  const result = parsed as Record<string, unknown>
  if (result.schemaVersion !== 1 || result.source !== "wrapper") {
    fail(`workspace wrapper dialog evidence has the wrong schema or source: ${JSON.stringify(result)}`)
  }
  if (typeof result.eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.eventId)) {
    fail(`workspace wrapper dialog evidence has no durable event ID: ${JSON.stringify(result)}`)
  }
  const eventPath = join(directory, "03_state/native_dialog_events", `${result.eventId}.json`)
  if (!existsSync(eventPath) || await Bun.file(eventPath).text() !== contents) {
    fail(`workspace wrapper did not preserve event ${result.eventId} in native_dialog_events`)
  }
  if (result.taskSpaceId !== expectedTaskSpaceId || result.taskSpaceName !== expectedTaskSpaceName || result.currentUrl !== expectedUrl) {
    fail(`workspace wrapper dialog evidence belongs to another task or URL: ${JSON.stringify(result)}`)
  }
  if (typeof result.recordedAt !== "string" || !Number.isFinite(Date.parse(result.recordedAt))) {
    fail(`workspace wrapper dialog evidence has no valid event timestamp: ${JSON.stringify(result)}`)
  }
  if (typeof result.status !== "string" || typeof result.clicked !== "boolean" || result.candidateCount !== 1) {
    fail(`workspace wrapper dialog evidence is missing its status or unique candidate: ${JSON.stringify(result)}`)
  }
  if (!Array.isArray(result.dialogText) || !result.dialogText.every((value) => typeof value === "string")) {
    fail("workspace wrapper did not persist textual AX evidence")
  }
  if (!Array.isArray(result.buttonLabels) || !result.buttonLabels.every((value) => typeof value === "string")) {
    fail("workspace wrapper did not persist button evidence")
  }
  if (result.axReadComplete !== true || result.treeTruncated !== false || result.customContentPresent !== true || result.customContentDecoded !== true) {
    fail(`workspace wrapper did not persist complete AX and custom-content evidence: ${JSON.stringify(result)}`)
  }
  if (!Array.isArray(result.customContent)) {
    fail(`workspace wrapper did not preserve decoded AXCustomContent evidence: ${JSON.stringify(result)}`)
  }
  if (typeof result.fingerprint !== "string" || !/^fnv1a64:[0-9a-f]{16}$/.test(result.fingerprint)) {
    fail(`workspace wrapper dialog evidence has no stable fingerprint: ${JSON.stringify(result)}`)
  }
  if (result.bundleIdentifier !== "com.citrolabs.ego.lite" || !Number.isInteger(result.processIdentifier) || typeof result.executablePath !== "string") {
    fail(`workspace wrapper dialog evidence has no exact managed-process identity: ${JSON.stringify(result)}`)
  }
  return result as {
    schemaVersion: 1
    status: string
    clicked: boolean
    eventId: string
    source: "wrapper"
    candidateCount: number
    dialogText: string[]
    buttonLabels: string[]
    axReadComplete: true
    customContentPresent: true
    customContentDecoded: true
    customContent: unknown[]
    hasTextField: boolean
    treeTruncated: false
    fingerprint: string
    taskSpaceId: string
    taskSpaceName: string
    currentUrl: string
    recordedAt: string
    bundleIdentifier: "com.citrolabs.ego.lite"
    processIdentifier: number
    executablePath: string
  }
}

function cleanup(taskId: number, directory: string, strict = false) {
  const result = spawnSync(helper, ["nodejs"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, TERRA_EGO_LITE_APP: egoLite, TERRA_EGO_BROWSER_HELPER: helper },
    input: `
const task = await takeOverTaskSpace(${taskId})
const info = await pageInfo()
// This is local-fixture teardown after the handoff behavior has already been
// verified. It is not a normal product recovery round.
if (info && typeof info === 'object' && 'dialog' in info) await cdp('Page.handleJavaScriptDialog', { accept: false })
const afterDialog = await pageInfo()
if (!afterDialog || !(typeof afterDialog === 'object' && 'dialog' in afterDialog)) await js('window.__disableBeforeUnload?.()')
const completed = await completeTaskSpace(task.id, { keep: false })
if (!completed || completed.done !== true) throw new Error('task-space cleanup did not complete')
cliLog('TERRA_EGO_DIALOG_SMOKE_CLEANUP')
`,
    timeout: 90_000,
  })
  if (result.status !== 0) {
    const message = `Could not clean up Ego task space ${taskId} (exit ${result.status ?? "unknown"}${result.signal ? `, signal ${result.signal}` : ""}): ${result.stderr || result.stdout || result.error?.message || "no helper output"}`
    if (strict) fail(message)
    console.error(message)
  }
}

const directory = await mkdtemp(join(tmpdir(), "terra-edu-ego-dialog-smoke-"))
await writeOpenCodeConfig(directory, {
  egoLiteAppPath: sourceEgoLite,
  dialogGuardPath: dialogGuard,
  egoRuntimeRoot: runtimeRoot,
})
const wrapper = join(directory, ".opencode/bin/ego-browser")
const fixturePort = 40_000 + (process.pid % 10_000)
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`
const fixtureHtml = `<!doctype html>
<title>Terra-Edu Ego dialog smoke</title>
<body data-alert-state="waiting" data-confirm-state="waiting" data-iframe-alert-state="waiting">
  <button id="alert-trigger" onclick="alert('${marker}-alert'); document.body.dataset.alertState = 'accepted'">Open alert</button>
  <button id="iframe-alert-trigger" onclick="document.querySelector('iframe').contentWindow.__openIframeAlert()">Open iframe alert</button>
  <button id="beforeunload-trigger" onclick="window.__tryLeave()">Attempt to leave</button>
  <button id="confirm-trigger" onclick="document.body.dataset.confirmState = confirm('${marker}-confirm') ? 'accepted' : 'cancelled'">Open confirmation</button>
  <iframe title="same-origin alert fixture" src="/dialog-frame.html"></iframe>
  <script>
    let blockNavigation = false
    window.__tryLeave = () => {
      blockNavigation = true
      window.location.href = ${JSON.stringify(fixtureOrigin + "/dialog-destination.html")}
    }
    window.__disableBeforeUnload = () => {
      blockNavigation = false
    }
    window.addEventListener('beforeunload', (event) => {
      if (!blockNavigation) return
      event.preventDefault()
      event.returnValue = ''
    })
  </script>
</body>`
const fixtureFrameHtml = `<!doctype html>
<title>Terra-Edu same-origin iframe</title>
<button id="iframe-alert-trigger">Open iframe alert</button>
<script>
  window.__openIframeAlert = () => {
    alert(${JSON.stringify(`${marker}-iframe-alert`)})
    parent.document.body.dataset.iframeAlertState = 'accepted'
  }
  document.getElementById('iframe-alert-trigger').addEventListener('click', window.__openIframeAlert)
</script>`
const fixtureServer = Bun.spawn(
  [
    process.execPath,
    "-e",
    "Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.TERRA_EDU_FIXTURE_PORT), fetch(request) { const url = new URL(request.url); if (url.pathname === '/dialog-destination.html') return new Response('<!doctype html><title>Unexpected destination</title><p>Navigation should have been cancelled.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }); if (url.pathname === '/dialog-frame.html') return new Response(process.env.TERRA_EDU_FIXTURE_FRAME_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }); if (url.pathname !== '/dialog-smoke.html') return new Response('Not found', { status: 404 }); return new Response(process.env.TERRA_EDU_FIXTURE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }); } }); setInterval(() => {}, 2 ** 30)",
  ],
  {
    env: {
      ...process.env,
      TERRA_EDU_FIXTURE_HTML: fixtureHtml,
      TERRA_EDU_FIXTURE_FRAME_HTML: fixtureFrameHtml,
      TERRA_EDU_FIXTURE_PORT: String(fixturePort),
    },
    stderr: "ignore",
    stdout: "ignore",
  },
)
await Bun.sleep(250)
let taskId: number | undefined
let completed = false
try {
  await waitForBundledApp()
  await waitForBundledService()
  const sourceUrl = `${fixtureOrigin}/dialog-smoke.html`
  const taskSpaceName = `Terra-Edu release dialog smoke ${marker}`

  taskId = taskSpaceId(
    runHelperRound(
      "initial observation",
      `
const task = await useOrCreateTaskSpace(${JSON.stringify(taskSpaceName)})
const beforeOpen = await pageInfo()
if (beforeOpen && typeof beforeOpen === 'object' && 'dialog' in beforeOpen) throw new Error('a dialog blocked the initial observation')
await openOrReuseTab(${JSON.stringify(sourceUrl)}, { wait: true, timeout: 30 })
const opened = await pageInfo()
if (!opened || (typeof opened === 'object' && 'dialog' in opened) || opened.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('fixture page did not open after the first observation')
}
cliLog('TERRA_EGO_DIALOG_SMOKE_TASK:' + task.id)
`,
      directory,
    ),
  )
  await mkdir(join(directory, "03_state"), { recursive: true })
  await Promise.all([
    writeFile(join(directory, "03_state/material_review.json"), JSON.stringify({ status: "approved", mode: "skip" }, null, 2) + "\n"),
    writeFile(join(directory, "03_state/task_control.json"), JSON.stringify({ paused: false }, null, 2) + "\n"),
    writeFile(join(directory, "03_state/application_progress.json"), JSON.stringify({
      currentPage: "Terra-Edu Ego dialog smoke",
      currentUrl: sourceUrl,
      browserBackend: "ego-browser",
      egoBrowser: { taskSpaceId: String(taskId), taskSpaceName, backend: "ego-browser" },
    }, null, 2) + "\n"),
  ])

  runHelperRound(
    "alert handling",
    `
const task = await useOrCreateTaskSpace(${taskId})
const beforeAction = await pageInfo()
if (!beforeAction || (typeof beforeAction === 'object' && 'dialog' in beforeAction) || beforeAction.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('alert round did not begin with an unobstructed fixture observation')
}
try {
  await click('#alert-trigger', { label: 'open alert fixture' })
} catch (error) {
  if (!String(error).includes('Input.dispatchMouseEvent')) throw error
}
const info = await pageInfo()
if (!info || !info.dialog || info.dialog.type !== 'alert' || info.dialog.message !== ${JSON.stringify(`${marker}-alert`)}) {
  throw new Error('expected alert was not observed through pageInfo')
}
await cdp('Page.handleJavaScriptDialog', { accept: true })
cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_CLOSED')
`,
    directory,
  )

  runHelperRound(
    "post-alert observation",
    `
const task = await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || (typeof info === 'object' && 'dialog' in info) || info.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('alert was not followed by a fresh unobstructed observation')
}
if (await js('document.body.dataset.alertState') !== 'accepted') throw new Error('alert page state did not resume after acceptance')
cliLog('TERRA_EGO_DIALOG_SMOKE_ALERT_REOBSERVED')
`,
    directory,
  )

  runWrapperRound(
    "same-origin iframe alert action",
    `
const task = await useOrCreateTaskSpace(${taskId})
const beforeAction = await pageInfo()
if (!beforeAction || (typeof beforeAction === 'object' && 'dialog' in beforeAction) || beforeAction.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('iframe alert round did not begin with an unobstructed fixture observation')
}
try {
  await click('#iframe-alert-trigger', { label: 'open same-origin iframe alert fixture' })
} catch (error) {
  if (!String(error).includes('Input.dispatchMouseEvent')) throw error
}
await new Promise((resolve) => setTimeout(resolve, 3000))
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_ACTION_FINISHED')
`,
    directory,
    wrapper,
    74,
    "TERRA_EGO_DIALOG_SMOKE_IFRAME_ACTION_FINISHED",
  )
  const iframeResult = await readWrapperDialog(directory, String(taskId), taskSpaceName, sourceUrl)
  if (iframeResult.status !== "acknowledged" || iframeResult.clicked !== true) {
    fail(`workspace wrapper did not acknowledge the iframe alert: ${JSON.stringify(iframeResult)}`)
  }
  if (!iframeResult.dialogText.some((value) => value.includes(`${marker}-iframe-alert`))) {
    fail(`workspace wrapper lost the iframe alert text: ${JSON.stringify(iframeResult.dialogText)}`)
  }
  if (iframeResult.buttonLabels.length !== 1 || iframeResult.hasTextField !== false) {
    fail(`workspace wrapper did not enforce complete single-button/no-input evidence: ${JSON.stringify(iframeResult)}`)
  }
  if (!iframeResult.executablePath.startsWith(egoLite) || !Number.isInteger(iframeResult.processIdentifier)) {
    fail(`workspace wrapper evidence was not tied to the isolated managed Ego process and task: ${JSON.stringify(iframeResult)}`)
  }

  runWrapperRound(
    "post-iframe-alert observation",
    `
const task = await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || (typeof info === 'object' && 'dialog' in info) || info.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('native iframe alert acknowledgement was not followed by a fresh unobstructed observation')
}
if (await js('document.body.dataset.iframeAlertState') !== 'accepted') throw new Error('iframe alert page state did not resume after AX acknowledgement')
cliLog('TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED')
`,
    directory,
    wrapper,
    0,
    "TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED",
  )

  runHelperRound(
    "beforeunload handling",
    `
const task = await useOrCreateTaskSpace(${taskId})
const beforeAction = await pageInfo()
if (!beforeAction || (typeof beforeAction === 'object' && 'dialog' in beforeAction) || beforeAction.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('beforeunload round did not begin with an unobstructed fixture observation')
}
try {
  await click('#beforeunload-trigger', { label: 'test leave warning' })
} catch (error) {
  if (!String(error).includes('Input.dispatchMouseEvent')) throw error
}
const info = await pageInfo()
if (!info || !info.dialog || info.dialog.type !== 'beforeunload') throw new Error('expected beforeunload dialog was not observed')
await cdp('Page.handleJavaScriptDialog', { accept: false })
cliLog('TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_CANCELLED')
`,
    directory,
  )

  runHelperRound(
    "post-beforeunload observation",
    `
const task = await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || (typeof info === 'object' && 'dialog' in info) || info.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('beforeunload cancellation did not preserve the current URL')
}
await js('window.__disableBeforeUnload()')
cliLog('TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_REOBSERVED')
`,
    directory,
  )

  runWrapperRound(
    "unknown confirmation observation",
    `
const task = await useOrCreateTaskSpace(${taskId})
const beforeAction = await pageInfo()
if (!beforeAction || (typeof beforeAction === 'object' && 'dialog' in beforeAction) || beforeAction.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('confirmation round did not begin with an unobstructed fixture observation')
}
try {
  await click('#confirm-trigger', { label: 'open confirmation fixture' })
} catch (error) {
  if (!String(error).includes('Input.dispatchMouseEvent')) throw error
}
const info = await pageInfo()
if (!info || !info.dialog || info.dialog.type !== 'confirm' || info.dialog.message !== ${JSON.stringify(`${marker}-confirm`)}) {
  throw new Error('expected unknown confirmation dialog was not observed')
}
await new Promise((resolve) => setTimeout(resolve, 3000))
await cdp('Page.handleJavaScriptDialog', { accept: false })
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_LEFT_UNCLICKED_BY_AX')
`,
    directory,
    wrapper,
    74,
    "TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_LEFT_UNCLICKED_BY_AX",
  )
  const confirmationResult = await readWrapperDialog(directory, String(taskId), taskSpaceName, sourceUrl)
  if (confirmationResult.status !== "observed" || confirmationResult.clicked !== false) {
    fail(`workspace wrapper must not click a two-button confirmation: ${JSON.stringify(confirmationResult)}`)
  }
  if (!confirmationResult.dialogText.some((value) => value.includes(`${marker}-confirm`)) || confirmationResult.buttonLabels.length !== 2 || confirmationResult.hasTextField !== false) {
    fail(`workspace wrapper lost confirmation evidence: ${JSON.stringify(confirmationResult)}`)
  }
  if (confirmationResult.eventId === iframeResult.eventId || confirmationResult.fingerprint === iframeResult.fingerprint) {
    fail(`workspace wrapper reused stale iframe evidence for the confirmation: ${JSON.stringify(confirmationResult)}`)
  }
  runWrapperRound(
    "post-confirmation observation",
    `
const task = await useOrCreateTaskSpace(${taskId})
const info = await pageInfo()
if (!info || (typeof info === 'object' && 'dialog' in info) || info.url !== ${JSON.stringify(sourceUrl)}) {
  throw new Error('confirmation cancellation was not followed by a fresh unobstructed observation')
}
if (await js('document.body.dataset.confirmState') !== 'cancelled') throw new Error('confirmation fixture was not cancelled')
cliLog('TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_REOBSERVED')
`,
    directory,
    wrapper,
    0,
    "TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_REOBSERVED",
  )
  cleanup(taskId, directory, true)
  completed = true
  console.log("GUI dialog smoke passed.")
} finally {
  if (taskId !== undefined && !completed) cleanup(taskId, directory)
  fixtureServer.kill()
  await stopSmokeLaunchedApps()
  await rm(directory, { recursive: true, force: true })
  await rm(runtimeRoot, { recursive: true, force: true })
}
