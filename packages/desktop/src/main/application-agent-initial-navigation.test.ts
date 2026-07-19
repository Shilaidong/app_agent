import { describe, expect, test } from "bun:test"
import { createContext, runInContext } from "node:vm"
import { EGO_INITIAL_NAVIGATION_SOURCE } from "./application-agent-opencode"

type CdpCall = { method: string; params?: Record<string, any> }

type HelperOverrides = {
  cdp?: (method: string, params?: Record<string, any>) => Promise<any>
  drainEvents?: () => Promise<any[]>
  gotoAndWait?: () => Promise<any>
  js?: (source: string) => Promise<any>
  pageInfo?: () => Promise<any>
}

// Instantiate the exact production source with fake Ego helpers so the tests
// exercise the shipped implementation instead of a copy of its logic.
function instantiate(overrides: HelperOverrides, calls: CdpCall[]) {
  const cdp =
    overrides.cdp ??
    (async (method: string, params?: Record<string, any>) => {
      calls.push({ method, params })
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "TOP" } } }
      return {}
    })
  const factory = new Function(
    "cdp",
    "drainEvents",
    "gotoAndWait",
    "js",
    "pageInfo",
    `return (${EGO_INITIAL_NAVIGATION_SOURCE})`,
  )
  return factory(
    (method: string, params?: Record<string, any>) => {
      if (overrides.cdp) calls.push({ method, params })
      return cdp(method, params)
    },
    overrides.drainEvents ?? (async () => []),
    overrides.gotoAndWait ?? (async () => ({ ok: true })),
    overrides.js ?? (async () => []),
    overrides.pageInfo ?? (async () => ({ url: "https://portal.example/", title: "portal" })),
  ) as (url: string, options?: { timeout?: number; settle?: number }) => Promise<any>
}

function bindingEvent(name: string, executionContextId: number, item: Record<string, unknown>) {
  return { method: "Runtime.bindingCalled", params: { name, executionContextId, payload: JSON.stringify(item) } }
}

function contextEvent(id: number, frameId: string) {
  return { method: "Runtime.executionContextCreated", params: { context: { id, auxData: { frameId } } } }
}

describe("navigateInitialPageCapturingAlerts", () => {
  test("checks pageInfo for an open dialog before any js() evaluation and preserves captured alert text", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    let bindingName = ""
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Runtime.addBinding") bindingName = String(params?.name)
          if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" }
          return {}
        },
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          return [contextEvent(7, "IFRAME-9"), bindingEvent(bindingName, 7, { type: "alert", message: "missing: Title of degree", url: "https://portal.example/frame", observedAt: "2026-07-19T00:00:00.000Z" })]
        },
        // A load-time confirm keeps the renderer blocked, so navigation times out
        // and any Runtime.evaluate would hang until the round is torn down.
        gotoAndWait: async () => {
          throw new Error("navigation blocked by dialog")
        },
        js: async () => {
          throw new Error("js() must never run while a native dialog may be open")
        },
        pageInfo: async () => ({ dialog: { type: "confirm", message: "Proceed?", url: "https://portal.example/" } }),
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("dialog")
    expect(result.info.dialog.type).toBe("confirm")
    expect(result.actionError).toContain("navigation blocked by dialog")
    expect(result.capturedAlerts).toEqual([
      { type: "alert", message: "missing: Title of degree", url: "https://portal.example/frame", observedAt: "2026-07-19T00:00:00.000Z", frameId: "IFRAME-9" },
    ])
    expect(calls.map((call) => call.method)).toContain("Page.removeScriptToEvaluateOnNewDocument")
    expect(calls.map((call) => call.method)).toContain("Runtime.removeBinding")
  })

  test("a removeScript failure is a hard contaminated stop that still attempts binding removal and keeps captured evidence", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    let bindingName = ""
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Runtime.addBinding") bindingName = String(params?.name)
          if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" }
          if (method === "Page.removeScriptToEvaluateOnNewDocument") throw new Error("target crashed mid-cleanup")
          if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "TOP" } } }
          return {}
        },
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          return [contextEvent(3, "TOP"), bindingEvent(bindingName, 3, { type: "alert", message: "saved with warnings", url: "https://portal.example/", observedAt: "2026-07-19T00:00:01.000Z" })]
        },
        js: async () => {
          throw new Error("a contaminated round must not keep evaluating page JavaScript")
        },
        pageInfo: async () => ({ url: "https://portal.example/", title: "portal" }),
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("cleanup_failed")
    expect(result.contaminated).toBe(true)
    expect(result.capturedAlerts.map((item: any) => item.message)).toEqual(["saved with warnings"])
    expect(result.info).toEqual({ url: "https://portal.example/", title: "portal" })
    expect(result.cleanupError).toContain("removeScript")
    expect(result.cleanupError).toContain("target crashed mid-cleanup")
    expect(calls.map((call) => call.method)).toContain("Runtime.removeBinding")
  })

  test("a removeBinding failure is also a hard contaminated stop, never an alerts/action success", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    let bindingName = ""
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Runtime.addBinding") bindingName = String(params?.name)
          if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" }
          if (method === "Runtime.removeBinding") throw new Error("binding survived")
          if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "TOP" } } }
          return {}
        },
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          return [contextEvent(4, "TOP"), bindingEvent(bindingName, 4, { type: "alert", message: "please review", url: "https://portal.example/", observedAt: "2026-07-19T00:00:04.000Z" })]
        },
        js: async () => {
          throw new Error("a contaminated round must not keep evaluating page JavaScript")
        },
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("cleanup_failed")
    expect(result.contaminated).toBe(true)
    expect(result.capturedAlerts.map((item: any) => item.message)).toEqual(["please review"])
    expect(result.cleanupError).toContain("removeBinding")
    expect(result.cleanupError).toContain("binding survived")
  })

  test("a drainEvents failure is an alert_evidence_lost hard stop that keeps the top-level fallback evidence", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    const topLevelAlert = { type: "alert", message: "top-level notice", url: "https://portal.example/", observedAt: "2026-07-19T00:00:05.000Z" }
    const navigate = instantiate(
      {
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          throw new Error("event queue unavailable")
        },
        js: async () => [topLevelAlert],
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("alert_evidence_lost")
    expect(result.contaminated).toBeUndefined()
    expect(result.topLevelAlerts).toEqual([topLevelAlert])
    expect(result.capturedAlerts).toEqual([])
    expect(result.info).toEqual({ url: "https://portal.example/", title: "portal" })
    expect(result.cleanupError).toContain("drainEvents")
    expect(result.cleanupError).toContain("event queue unavailable")
    expect(calls.map((call) => call.method)).toContain("Page.removeScriptToEvaluateOnNewDocument")
    expect(calls.map((call) => call.method)).toContain("Runtime.removeBinding")
  })

  test("a drainEvents failure with an open dialog hard-stops without evaluating page JavaScript", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    const navigate = instantiate(
      {
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          throw new Error("event queue unavailable")
        },
        js: async () => {
          throw new Error("js() must never run while a native dialog may be open")
        },
        pageInfo: async () => ({ dialog: { type: "alert", message: "still open", url: "https://portal.example/" } }),
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("alert_evidence_lost")
    expect(result.topLevelAlerts).toEqual([])
    expect(result.info.dialog.message).toBe("still open")
  })

  test("a removeScript failure combined with a broken pageInfo still hard-stops as contaminated", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    let bindingName = ""
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Runtime.addBinding") bindingName = String(params?.name)
          if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" }
          if (method === "Page.removeScriptToEvaluateOnNewDocument") throw new Error("target crashed mid-cleanup")
          return {}
        },
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          return [contextEvent(6, "TOP"), bindingEvent(bindingName, 6, { type: "alert", message: "evidence kept", url: "https://portal.example/", observedAt: "2026-07-19T00:00:06.000Z" })]
        },
        js: async () => {
          throw new Error("a contaminated round must not keep evaluating page JavaScript")
        },
        pageInfo: async () => {
          throw new Error("observation channel broken")
        },
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("cleanup_failed")
    expect(result.contaminated).toBe(true)
    expect(result.info).toBeUndefined()
    expect(result.infoError).toContain("observation channel broken")
    expect(result.capturedAlerts.map((item: any) => item.message)).toEqual(["evidence kept"])
    expect(result.cleanupError).toContain("removeScript")
  })

  test("a failed script installation removes the already-registered binding before rethrowing", async () => {
    const calls: CdpCall[] = []
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Page.addScriptToEvaluateOnNewDocument") throw new Error("injection rejected")
          return {}
        },
        gotoAndWait: async () => {
          throw new Error("navigation must never start after a failed installation")
        },
      },
      calls,
    )
    await expect(navigate("https://portal.example/")).rejects.toThrow("injection rejected")
    const bindingCalls = calls.filter((call) => call.method === "Runtime.removeBinding")
    expect(bindingCalls).toHaveLength(1)
    expect(String(bindingCalls[0].params?.name)).toStartWith("__terraInitialAlert_")
  })

  test("keeps genuinely repeated identical alerts while merging the binding/top-level copies of one alert", async () => {
    const calls: CdpCall[] = []
    let drains = 0
    let bindingName = ""
    const first = { type: "alert", message: "required field missing", url: "https://portal.example/", observedAt: "2026-07-19T00:00:02.000Z" }
    const repeat = { ...first, observedAt: "2026-07-19T00:00:03.000Z" }
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Runtime.addBinding") bindingName = String(params?.name)
          if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" }
          if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "TOP" } } }
          return {}
        },
        drainEvents: async () => {
          drains += 1
          if (drains === 1) return []
          return [contextEvent(5, "TOP"), bindingEvent(bindingName, 5, first), bindingEvent(bindingName, 5, repeat)]
        },
        // The top-level fallback re-reads the same state, so it returns copies of
        // both alerts; they must merge with the binding events, not double up.
        js: async () => [first, repeat],
      },
      calls,
    )
    const result = await navigate("https://portal.example/")
    expect(result.kind).toBe("alerts")
    expect(result.alerts).toHaveLength(2)
    expect(result.alerts.map((item: any) => item.observedAt).sort()).toEqual([first.observedAt, repeat.observedAt])
  })

  test("injected script records load-time alerts, restores on load, and routes later aliased calls to the native alert", async () => {
    const calls: CdpCall[] = []
    let bindingName = ""
    let injectedSource = ""
    const navigate = instantiate(
      {
        cdp: async (method, params) => {
          if (method === "Runtime.addBinding") bindingName = String(params?.name)
          if (method === "Page.addScriptToEvaluateOnNewDocument") {
            injectedSource = String(params?.source)
            return { identifier: "script-1" }
          }
          if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "TOP" } } }
          return {}
        },
      },
      calls,
    )
    await navigate("https://portal.example/")
    expect(bindingName).toStartWith("__terraInitialAlert_")
    expect(injectedSource).toContain(bindingName)

    const nativeCalls: unknown[] = []
    const bindingPayloads: string[] = []
    const loadListeners: (() => void)[] = []
    const sandbox: Record<string, any> = {
      JSON,
      Date,
      Object,
      String,
      location: { href: "https://portal.example/" },
      alert: (message: unknown) => nativeCalls.push(message),
      addEventListener: (type: string, listener: () => void) => {
        if (type === "load") loadListeners.push(listener)
      },
      setTimeout: (callback: () => void) => callback(),
    }
    sandbox[bindingName] = (payload: string) => bindingPayloads.push(payload)
    sandbox.globalThis = sandbox
    createContext(sandbox)
    runInContext(injectedSource, sandbox)

    const wrappedAlias = sandbox.alert
    wrappedAlias("Please complete: Title of degree")
    expect(nativeCalls).toHaveLength(0)
    expect(bindingPayloads).toHaveLength(1)
    expect(JSON.parse(bindingPayloads[0])).toMatchObject({
      type: "alert",
      message: "Please complete: Title of degree",
      url: "https://portal.example/",
    })

    for (const listener of loadListeners) listener()
    expect(sandbox.alert).not.toBe(wrappedAlias)
    wrappedAlias("post-restore alert through a captured alias")
    expect(nativeCalls).toEqual(["post-restore alert through a captured alias"])
    expect(bindingPayloads).toHaveLength(1)
  })

  test("stays clear of every managed-wrapper stdin rejection pattern", () => {
    expect(EGO_INITIAL_NAVIGATION_SOURCE).not.toMatch(/closetab/i)
    expect(EGO_INITIAL_NAVIGATION_SOURCE).not.toMatch(/reload/i)
    expect(EGO_INITIAL_NAVIGATION_SOURCE).not.toMatch(/complete([^a-z0-9]|\s)*taskspace/i)
  })
})
