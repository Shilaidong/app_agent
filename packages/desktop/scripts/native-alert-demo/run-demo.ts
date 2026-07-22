#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir)
const html = readFileSync(join(root, "index.html"))
const holdOpenMs = Number(process.env.TERRA_ALERT_DEMO_HOLD_MS || 12_000)
const afterCloseMs = Number(process.env.TERRA_ALERT_DEMO_AFTER_CLOSE_MS || 8_000)

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
console.log(`[demo] opening Ego Lite… watch the window; alert will stay ~${Math.round(holdOpenMs / 1000)}s`)

const script = `
const task = await useOrCreateTaskSpace('Terra native-alert live demo')
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

cliLog('DEMO_DISMISS_VIA_CDP:Page.handleJavaScriptDialog accept:true')
await cdp('Page.handleJavaScriptDialog', { accept: true })
await Promise.race([actionPromise, new Promise((resolve) => setTimeout(resolve, 2000))])
await wait(500)

const after = await pageInfo()
cliLog('DEMO_AFTER:' + JSON.stringify(after))
if (after && after.dialog) throw new Error('dialog still open after CDP dismiss: ' + JSON.stringify(after))
const state = await js('document.body.dataset.alertState')
cliLog('DEMO_PAGE_STATE:' + state)
if (state !== 'accepted') throw new Error('page did not resume after alert dismiss')
cliLog('DEMO_SUCCESS:native alert read and dismissed via Ego CDP')
await new Promise((resolve) => setTimeout(resolve, ${afterCloseMs}))
cliLog('DEMO_DONE')
`

const ego = spawn("ego-browser", ["nodejs"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
})
ego.stdin.write(script)
ego.stdin.end()

let stdout = ""
let stderr = ""
ego.stdout.on("data", (chunk) => {
  const text = String(chunk)
  stdout += text
  process.stdout.write(text)
})
ego.stderr.on("data", (chunk) => {
  const text = String(chunk)
  stderr += text
  process.stderr.write(text)
})

const status = await new Promise<number>((resolve) => {
  ego.on("close", (code) => resolve(code ?? 1))
})

server.close()
if (status !== 0) {
  console.error(`[demo] ego-browser exited ${status}`)
  if (!stdout.includes("DEMO_SUCCESS")) process.exit(status || 1)
}
if (!stdout.includes("DEMO_SUCCESS")) {
  console.error("[demo] missing DEMO_SUCCESS marker")
  process.exit(1)
}
console.log("[demo] completed — Ego Lite closed the native alert with CDP")
