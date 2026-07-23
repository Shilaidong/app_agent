import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type JsAlertAxResult = {
  dismissed: boolean
  message: string
  method: "ax" | "ego_exit_fallback"
  error?: string
  buttonTitle?: string
}

/** JXA: find Chromium-style JS alert (only 确定/OK, no Cancel) in Ego Lite only and click it. */
export const JS_ALERT_AX_JXA = `(() => {
  const se = Application("System Events")
  const okTitles = ["确定", "OK", "Ok", "ok"]
  const cancelTitles = ["Cancel", "取消", "Don't Allow", "不允许"]
  // Only Terra-managed Ego Lite — never scan unrelated apps.
  const processNames = ["ego lite", "Ego Lite"]

  function titleOf(el) {
    try { return String(el.title() || "") } catch (e) { return "" }
  }
  function valueOf(el) {
    try { return String(el.value() || "") } catch (e) { return "" }
  }
  function descriptionOf(el) {
    try { return String(el.description() || "") } catch (e) { return "" }
  }
  function collectMessage(container) {
    const parts = []
    try {
      for (const text of container.staticTexts()) {
        const value = valueOf(text) || descriptionOf(text) || titleOf(text)
        if (value.trim()) parts.push(value.trim())
      }
    } catch (e) {}
    return parts.join("\\n").trim()
  }
  function tryDismissIn(container) {
    let buttons = []
    try { buttons = container.buttons() } catch (e) { return null }
    const ok = []
    const cancel = []
    for (const button of buttons) {
      const title = titleOf(button)
      if (okTitles.indexOf(title) >= 0) ok.push(button)
      if (cancelTitles.indexOf(title) >= 0) cancel.push(button)
    }
    if (ok.length !== 1 || cancel.length > 0) return null
    const message = collectMessage(container)
    ok[0].click()
    return { dismissed: true, message: message, method: "ax", buttonTitle: titleOf(ok[0]) }
  }
  function walk(proc) {
    try {
      for (const win of proc.windows()) {
        const direct = tryDismissIn(win)
        if (direct) return direct
        try {
          for (const sheet of win.sheets()) {
            const nested = tryDismissIn(sheet)
            if (nested) return nested
          }
        } catch (e) {}
        try {
          for (const group of win.groups()) {
            const nested = tryDismissIn(group)
            if (nested) return nested
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null
  }

  const processes = se.applicationProcesses()
  for (const proc of processes) {
    let name = ""
    try { name = String(proc.name() || "") } catch (e) { continue }
    const lower = name.toLowerCase()
    const matched = processNames.some((item) => lower === item.toLowerCase() || lower.indexOf("ego lite") >= 0)
    if (!matched) continue
    const hit = walk(proc)
    if (hit) return JSON.stringify(hit)
  }
  return JSON.stringify({ dismissed: false, message: "", method: "ax", error: "no_alert_found" })
})()`

/** Embedded into generated OpenCode workspace tools (single source with JS_ALERT_AX_JXA). */
export function dismissJsAlertViaAxRuntimeSource() {
  return `async function dismissJsAlertViaAx(timeoutMs = 8000) {
  if (process.platform !== "darwin") {
    return { dismissed: false, message: "", method: "ego_exit_fallback", error: "js_alert_ax_requires_macos" }
  }
  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", JS_ALERT_AX_JXA], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    })
    const raw = String(stdout || "").trim() || String(stderr || "").trim()
    if (!raw) return { dismissed: false, message: "", method: "ego_exit_fallback", error: "empty_ax_output" }
    const parsed = JSON.parse(raw)
    if (parsed && parsed.dismissed) {
      return {
        dismissed: true,
        message: String(parsed.message || "").trim(),
        method: "ax",
        buttonTitle: parsed.buttonTitle,
      }
    }
    return {
      dismissed: false,
      message: String(parsed?.message || "").trim(),
      method: "ego_exit_fallback",
      error: String(parsed?.error || "no_alert_found"),
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const needsPermission = /not allowed|1002|-1719|assistive|accessibility/i.test(detail)
    return {
      dismissed: false,
      message: "",
      method: "ego_exit_fallback",
      error: needsPermission ? "accessibility_permission_required: " + detail : detail,
    }
  }
}`
}

export async function dismissJsAlertViaAx(timeoutMs = 8_000): Promise<JsAlertAxResult> {
  if (process.platform !== "darwin") {
    return {
      dismissed: false,
      message: "",
      method: "ego_exit_fallback",
      error: "js_alert_ax_requires_macos",
    }
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", JS_ALERT_AX_JXA],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
    )
    const raw = String(stdout || "").trim() || String(stderr || "").trim()
    if (!raw) {
      return { dismissed: false, message: "", method: "ego_exit_fallback", error: "empty_ax_output" }
    }
    const parsed = JSON.parse(raw) as JsAlertAxResult
    if (parsed.dismissed) {
      return {
        dismissed: true,
        message: String(parsed.message || "").trim(),
        method: "ax",
        buttonTitle: parsed.buttonTitle,
      }
    }
    return {
      dismissed: false,
      message: String(parsed.message || "").trim(),
      method: "ego_exit_fallback",
      error: String(parsed.error || "no_alert_found"),
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const needsPermission = /not allowed|1002|-1719|assistive|accessibility/i.test(detail)
    return {
      dismissed: false,
      message: "",
      method: "ego_exit_fallback",
      error: needsPermission ? "accessibility_permission_required: " + detail : detail,
    }
  }
}
