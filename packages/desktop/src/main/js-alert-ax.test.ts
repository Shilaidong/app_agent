import { describe, expect, test } from "bun:test"
import { JS_ALERT_AX_JXA, dismissJsAlertViaAxRuntimeSource } from "./js-alert-ax"

describe("js-alert-ax", () => {
  test("JXA script only targets Ego Lite single-button OK alerts", () => {
    expect(JS_ALERT_AX_JXA).toContain("确定")
    expect(JS_ALERT_AX_JXA).toContain("OK")
    expect(JS_ALERT_AX_JXA).toContain("Cancel")
    expect(JS_ALERT_AX_JXA).toContain("ok.length !== 1 || cancel.length > 0")
    expect(JS_ALERT_AX_JXA).toContain("ego lite")
    expect(JS_ALERT_AX_JXA).toContain("Only Terra-managed Ego Lite")
    expect(JS_ALERT_AX_JXA).not.toContain("Fallback: any process")
    expect(JS_ALERT_AX_JXA).not.toContain("terra-dialog-guard")
    // Must not fall back to scanning unrelated apps.
    expect(JS_ALERT_AX_JXA).not.toMatch(/for \(const proc of processes\) \{\s*const hit = walk\(proc\)/)
  })

  test("runtime embed matches the shared JXA source", () => {
    const runtime = dismissJsAlertViaAxRuntimeSource()
    expect(runtime).toContain("dismissJsAlertViaAx")
    expect(runtime).toContain("JS_ALERT_AX_JXA")
    expect(runtime).toContain("ego_exit_fallback")
  })
})
