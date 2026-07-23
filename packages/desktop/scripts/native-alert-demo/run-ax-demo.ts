#!/usr/bin/env bun
/**
 * Live demo: open fixture → observe native alert → dismiss via Terra AX (not Ego CDP).
 * Requires macOS Accessibility permission for this process / Terra app.
 */
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { dismissJsAlertViaAx } from "../../src/main/js-alert-ax"

const root = join(import.meta.dir)
const html = readFileSync(join(root, "index.html"))
const holdOpenMs = Number(process.env.TERRA_ALERT_DEMO_HOLD_MS || 16_000)
const axAfterMs = Number(process.env.TERRA_ALERT_DEMO_AX_AFTER_MS || 6_000)

const server = createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/index")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
    return
  }
  res.writeHead(404)
  res.end("not found")
})

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("failed to bind demo server")
const url = `http://127.0.0.1:${address.port}/`
console.log(`[demo] fixture ready: ${url}`)
console.log(`[demo] opening Ego Lite; AX will run after ${axAfterMs}ms`)

const script = `
const task = await useOrCreateTaskSpace('Terra native-alert ax demo')
cliLog('DEMO_TASK_SPACE:' + task.id)
await openOrReuseTab(${JSON.stringify(url)}, { wait: true, timeout: 30 })
await wait(800)
const before = await pageInfo()
cliLog('DEMO_BEFORE:' + JSON.stringify(before))
if (before && before.dialog) throw new Error('dialog already open before click: ' + JSON.stringify(before))

const target = await js("(() => { const el = document.querySelector('#save'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height } })()")
if (!target || !(target.w > 0)) throw new Error('Save button missing: ' + JSON.stringify(target))
cliLog('DEMO_CLICK_SAVE:' + JSON.stringify(target))

const actionPromise = Promise.resolve().then(async () => {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
})

let dialogInfo = null
const deadline = Date.now() + 12000
while (Date.now() < deadline) {
  const info = await Promise.race([
    Promise.resolve().then(() => pageInfo()),
    new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
  ])
  if (info && info.dialog) {
    dialogInfo = info
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 120))
}
if (!dialogInfo || !dialogInfo.dialog) throw new Error('native alert was not observed via pageInfo')

cliLog('DEMO_DIALOG_SEEN:' + JSON.stringify(dialogInfo.dialog))
cliLog('DEMO_HOLD_OPEN_MS:${holdOpenMs}')
await new Promise((resolve) => setTimeout(resolve, ${holdOpenMs}))

await Promise.race([actionPromise, new Promise((resolve) => setTimeout(resolve, 2000))])
await wait(500)

const after = await pageInfo()
cliLog('DEMO_AFTER:' + JSON.stringify(after))
if (after && after.dialog) throw new Error('dialog still open after AX dismiss: ' + JSON.stringify(after))
const state = await js("document.body.dataset.alertState")
cliLog('DEMO_PAGE_STATE:' + state)
if (state !== 'accepted') throw new Error('page did not resume after alert dismiss')
cliLog('DEMO_SUCCESS')
`

const ego = spawn("ego-browser", ["nodejs"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
})
ego.stdin.write(script)
ego.stdin.end()

let output = ""
const append = (chunk: Buffer | string) => {
  const text = String(chunk)
  output += text
  process.stdout.write(text)
}
ego.stdout.on("data", append)
ego.stderr.on("data", append)

const egoDone = new Promise<number>((resolve) => ego.on("close", (code) => resolve(code ?? 1)))

await Bun.sleep(axAfterMs)
console.log("[demo] calling dismissJsAlertViaAx…")
let ax = await dismissJsAlertViaAx(10_000)
if (!ax.dismissed) {
  await Bun.sleep(1500)
  ax = await dismissJsAlertViaAx(10_000)
}
console.log("[demo] AX result:", JSON.stringify(ax))

const status = await Promise.race([
  egoDone,
  Bun.sleep(holdOpenMs + 15_000).then(() => {
    ego.kill("SIGTERM")
    return 1
  }),
])
server.close()

if (!ax.dismissed) {
  console.error("[demo] AX did not dismiss. Grant Accessibility to Terminal/Cursor/Terra and retry.")
  console.error("[demo] detail:", ax.error || ax.method)
  process.exit(1)
}
if (!/Major is required/i.test(ax.message)) {
  console.warn("[demo] warning: unexpected alert message:", ax.message)
}
if (output.includes("DEMO_SUCCESS") || status === 0) {
  console.log("[demo] completed — alert dismissed via AX, page resumed")
  process.exit(0)
}
if (ax.dismissed && /Major is required/i.test(ax.message)) {
  console.log("[demo] completed — alert dismissed via AX")
  process.exit(0)
}
console.error("[demo] ego exit=", status)
process.exit(1)
