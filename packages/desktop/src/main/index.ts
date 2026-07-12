import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow } from "electron"

import contextMenu from "electron-context-menu"

import type {
  ApplicationAgentChatItem,
  ApplicationAgentSession,
  ApplicationTask,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  WslConfig,
} from "../preload/types"
import { APPLICATION_AGENT_MODEL_ID, buildApplicationAgentStartPrompt, prepareApplicationAgentConfig } from "./application-agent"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand, sendSqliteMigrationProgress } from "./ipc"
import { initLogging, logFilePath } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import {
  getDefaultServerUrl,
  getWslConfig,
  preferAppEnv,
  setDefaultServerUrl,
  setWslConfig,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { ensureApplicationAgentQuota, syncApplicationAgentTokenUsage } from "./terra-auth"
import {
  createLoadingWindow,
  createMainWindow,
  registerRendererProtocol,
  setBackgroundColor,
  setDockIcon,
} from "./windows"
import { migrate } from "./migrate"
import { checkUpdate, checkForUpdates, installUpdate, setupAutoUpdater } from "./updater"
import { Deferred, Effect, Fiber } from "effect"

const APP_NAMES: Record<string, string> = {
  dev: "Terra-Edu Application Agent Dev",
  beta: "Terra-Edu Application Agent Beta",
  prod: "Terra-Edu Application Agent",
}
const APP_IDS: Record<string, string> = {
  dev: "edu.terra.application-agent.dev",
  beta: "edu.terra.application-agent.beta",
  prod: "edu.terra.application-agent",
}
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"

let logger: ReturnType<typeof initLogging>
let mainWindow: BrowserWindow | null = null
let server: SidecarListener | null = null

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "edu.terra.application-agent.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "Terra-Edu Application Agent Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  logger = initLogging()

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("terra-application-agent://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    if (mainWindow) {
      mainWindow.showInactive()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    void killSidecar()
  })

  app.on("will-quit", () => {
    void killSidecar()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void killSidecar().finally(() => app.exit(0))
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData>()
  const loadingComplete = Deferred.makeUnsafe<void>()

  const postSidecarJson = async <T,>(path: string, directory: string, payload: unknown, expectJson = true) => {
    const ready = await Effect.runPromise(Deferred.await(serverReady))
    const separator = path.includes("?") ? "&" : "?"
    const response = await fetch(`${ready.url}${path}${separator}directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${ready.username ?? "opencode"}:${ready.password ?? ""}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`OpenCode 请求失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`)
    }
    if (!expectJson || response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  const getSidecarJson = async <T,>(path: string, directory: string) => {
    const ready = await Effect.runPromise(Deferred.await(serverReady))
    const separator = path.includes("?") ? "&" : "?"
    const response = await fetch(`${ready.url}${path}${separator}directory=${encodeURIComponent(directory)}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${ready.username ?? "opencode"}:${ready.password ?? ""}`).toString("base64")}`,
      },
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`OpenCode 读取消息失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`)
    }
    return (await response.json()) as T
  }

  const truncateChatBody = (value: string, max = 20000) => {
    const text = value.trim()
    if (text.length <= max) return text
    return `${text.slice(0, max).trimEnd()}\n...`
  }

  const applicationAgentLogHelp = (session: ApplicationAgentSession) =>
    [
      `OpenCode / 桌面日志：${logFilePath()}`,
      `Agent 工作区日志：${join(session.workspacePath, "04_logs/agent_log.md")}`,
      `工具审计：${join(session.workspacePath, "03_state/agent_execution_audit.json")}`,
    ].join("\n")

  const summarizeOpenCodeReadError = (error: unknown) => {
    if (!error) return "OpenCode 消息接口读取失败。"
    const message = error instanceof Error ? error.message : String(error)
    const redacted = message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [redacted]")
    if (redacted.includes("Unexpected server error")) return "OpenCode 原生会话接口返回 Unexpected server error。"
    return redacted || "OpenCode 消息接口读取失败。"
  }

  type PendingQuestionRequest = {
    id: string
    sessionID: string
    questions: {
      question: string
      header: string
      multiple?: boolean
      options?: { label: string; description?: string }[]
    }[]
  }

  const formatQuestionRequest = (request: PendingQuestionRequest) =>
    request.questions
      .map((item, index) => {
        const options = item.options?.length
          ? `\n可选项${item.multiple ? "（可多选）" : ""}：${item.options.map((option) => option.label).join(" / ")}`
          : ""
        return `${index + 1}. ${item.header ? `${item.header}：` : ""}${item.question}${options}`
      })
      .join("\n\n")

  const inferQuestionAnswers = (request: PendingQuestionRequest, prompt: string) => {
    const source = prompt.toLowerCase()
    const pick = (question: PendingQuestionRequest["questions"][number]) => {
      const options = question.options ?? []
      const header = `${question.header} ${question.question}`.toLowerCase()
      const matched = options.filter((option) => {
        const label = option.label.toLowerCase()
        const description = option.description?.toLowerCase() ?? ""
        return source.includes(label) || (description.length > 0 && source.includes(description))
      })
      if (matched.length > 0) return question.multiple ? matched.map((option) => option.label) : [matched[0].label]

      if (header.includes("地址")) {
        if (prompt.includes("北京") || prompt.includes("户籍")) return [options[0]?.label ?? prompt]
        if (prompt.includes("深圳") || prompt.includes("现居")) return [options[1]?.label ?? prompt]
      }
      if (header.includes("出生")) {
        if (/2002|8月21|08\/?21|确认|是的|正确/.test(prompt)) return [options[0]?.label ?? prompt]
      }
      if (header.includes("语言") || header.includes("toefl") || header.includes("ielts")) {
        if (/豁免|无需|不需要|美国本科/.test(prompt)) return [options[0]?.label ?? prompt]
        if (/需要|toefl|ielts|语言成绩/.test(prompt)) return [options[1]?.label ?? prompt]
        if (/不确定|跳过|先不填/.test(prompt)) return [options[2]?.label ?? prompt]
      }

      return [prompt]
    }

    return request.questions.map((question) => pick(question).map((answer) => answer.trim()).filter(Boolean))
  }

  const summarizePrompt = (text: string) => {
    if (text.includes("你现在是 Terra-Edu 申请 Agent")) {
      return "任务启动指令已发送给 OpenCode Agent。Agent 将从创建隔离工作区开始自动执行申请流程。"
    }
    return truncateChatBody(text, 900)
  }

  const getApplicationAgentMessages = async (
    session: ApplicationAgentSession,
  ): Promise<ApplicationAgentChatItem[]> => {
    const sessionInfo = await getApplicationAgentSessionInfo(session).catch(() => null)
    if (sessionInfo?.tokens) {
      await syncApplicationAgentTokenUsage(session.sessionID, session.workspacePath, sessionInfo.tokens).catch((error) => {
        logger.warn("failed to sync application-agent quota usage", error)
      })
    }

    type SidecarPart = {
      id?: string
      type?: string
      text?: string
      tool?: string
      state?: {
        status?: "pending" | "running" | "completed" | "error"
        title?: string
        output?: string
        error?: string
        input?: unknown
      }
      time?: { start?: number; end?: number }
      reason?: string
    }
    type SidecarMessage = {
      info: {
        id: string
        role: "user" | "assistant"
        time?: { created?: number; completed?: number }
        error?: { name?: string; message?: string }
      }
      parts: SidecarPart[]
    }

    let readError: unknown
    const messages = await getSidecarJson<SidecarMessage[]>(
      `/session/${session.sessionID}/message?limit=80`,
      session.directory,
    ).catch((error) => {
      readError = error
      logger.warn("failed to read application-agent messages", error)
      return null
    })
    if (!messages) {
      return [
        {
          id: `${session.sessionID}:message-read-error`,
          role: "system",
          title: "OpenCode 消息读取失败",
          body: `${summarizeOpenCodeReadError(readError)}\n\n${applicationAgentLogHelp(session)}\n\n可以先点“重新发送启动指令”；如果仍失败，再点“重建 OpenCode 会话”。`,
          status: "error",
          time: Date.now(),
        },
      ]
    }
    const items: ApplicationAgentChatItem[] = []
    let latestAssistantActivity = 0

    for (const message of messages) {
      if (message.info.role === "assistant") {
        latestAssistantActivity = Math.max(
          latestAssistantActivity,
          message.info.time?.created ?? 0,
          message.info.time?.completed ?? 0,
          ...message.parts.flatMap((part) => [part.time?.start ?? 0, part.time?.end ?? 0]),
        )
      }
      const text = message.parts
        .filter((part) => part.type === "text" && part.text?.trim())
        .map((part) => part.text!.trim())
        .join("\n\n")

      if (message.info.role === "user") {
        if (text) {
          items.push({
            id: `${message.info.id}:user`,
            role: "user",
            title: "顾问 / 启动指令",
          body: summarizePrompt(text),
            time: message.info.time?.created,
          })
        }
        continue
      }

      if (text) {
        items.push({
          id: `${message.info.id}:assistant`,
          role: "assistant",
          title: "OpenCode Agent",
          body: truncateChatBody(text, 20000),
          time: message.info.time?.created,
        })
      }

      for (const part of message.parts) {
        if (part.type === "tool") {
          const state = part.state
          const status = state?.status ?? "running"
          if (part.tool === "question" && state?.input && typeof state.input === "object") {
            const input = state.input as { questions?: PendingQuestionRequest["questions"] }
            if (Array.isArray(input.questions)) {
              items.push({
                id: part.id ?? `${message.info.id}:question:${items.length}`,
                role: "assistant",
                title: status === "running" ? "需要顾问确认" : "顾问确认问题",
                body: truncateChatBody(formatQuestionRequest({ id: "", sessionID: session.sessionID, questions: input.questions }), 6000),
                status,
                time: part.time?.start ?? message.info.time?.created,
                question: { questions: input.questions },
              })
              continue
            }
          }
          const input = state?.input ? JSON.stringify(state.input, null, 2) : ""
          const output = state?.output ?? state?.error ?? ""
          items.push({
            id: part.id ?? `${message.info.id}:${part.tool}:${items.length}`,
            role: "tool",
            title: `${status === "running" ? "正在执行" : status === "completed" ? "已完成" : status === "error" ? "执行失败" : "等待执行"}：${part.tool ?? "工具"}`,
            body: truncateChatBody([state?.title, output, input && !output ? input : ""].filter(Boolean).join("\n\n"), 5000),
            status,
            time: part.time?.start ?? message.info.time?.created,
          })
        }
      }

      if (message.info.error) {
        items.push({
          id: `${message.info.id}:error`,
          role: "system",
          title: "OpenCode 异常",
          body: message.info.error.message ?? message.info.error.name ?? "OpenCode 本轮执行出现异常。",
          status: "error",
          time: message.info.time?.completed ?? message.info.time?.created,
        })
      }
    }

    const last = messages.at(-1)
    if (last?.info.role === "assistant" && !last.info.time?.completed) {
      const stalled = latestAssistantActivity > 0 && Date.now() - latestAssistantActivity > 3 * 60 * 1000
      items.push({
        id: `${last.info.id}:thinking`,
        role: "system",
        title: stalled ? "Agent 可能卡住" : "OpenCode Agent 正在运行",
        body: stalled
          ? `Assistant 已超过 3 分钟没有新的回复、part 或工具结果。\n\n${applicationAgentLogHelp(session)}\n\n可以先点“重新发送启动指令”；如果仍失败，再点“重建 OpenCode 会话”。`
          : "Agent 正在处理当前申请任务。这里会自动刷新新的回复、工具调用和结果。",
        status: stalled ? "error" : "running",
        time: last.info.time?.created,
      })
    }

    return items
  }

  const getApplicationAgentSessionInfo = async (session: ApplicationAgentSession) => {
    type SidecarSessionInfo = {
      id: string
      tokens?: {
        input: number
        output: number
        reasoning: number
        cache: {
          read: number
          write: number
        }
      }
      cost?: number
    }
    const sessions = await getSidecarJson<SidecarSessionInfo[]>("/session?limit=80", session.directory)
    return sessions.find((item) => item.id === session.sessionID) ?? null
  }

  const findApplicationAgentSession = async (workspacePath: string): Promise<ApplicationAgentSession | null> => {
    await prepareApplicationAgentConfig(workspacePath)
    type SidecarSession = {
      id: string
      directory?: string
      agent?: string
      time?: { updated?: number }
      title?: string
    }
    const sessions = await getSidecarJson<SidecarSession[]>("/session?limit=80", workspacePath).catch(() => [])
    const found = sessions
      .filter((item) => item.directory === workspacePath)
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      .find((item) => item.agent === "application-agent" || item.title?.includes("申请任务"))
    if (!found) {
      const created = await postSidecarJson<{ id: string }>(
        "/session",
        workspacePath,
        {
          title: "申请任务（恢复会话）",
          agent: "application-agent",
          model: {
            providerID: "opencode-go",
            id: APPLICATION_AGENT_MODEL_ID,
          },
        },
      )
      return {
        sessionID: created.id,
        directory: workspacePath,
        workspacePath,
      }
    }
    return {
      sessionID: found.id,
      directory: workspacePath,
      workspacePath,
    }
  }

  const startApplicationAgentSession = async (task: ApplicationTask): Promise<ApplicationAgentSession> => {
    await prepareApplicationAgentConfig(task.sessionDirectory)
    await ensureApplicationAgentQuota("start_application_task", task.workspacePath)
    const created = await postSidecarJson<{ id: string }>(
      "/session",
      task.sessionDirectory,
      {
        title: `申请任务：${task.input.studentName} / ${task.input.school} / ${task.input.program}`,
        agent: "application-agent",
        model: {
          providerID: "opencode-go",
          id: APPLICATION_AGENT_MODEL_ID,
        },
      },
    )
    const session: ApplicationAgentSession = {
      sessionID: created.id,
      directory: task.sessionDirectory,
      workspacePath: task.workspacePath,
    }
    await ensureApplicationAgentQuota("send_start_prompt", task.workspacePath, created.id)
    await postSidecarJson<void>(
      `/session/${created.id}/prompt_async`,
      task.sessionDirectory,
      {
        agent: "application-agent",
        model: {
          providerID: "opencode-go",
          modelID: APPLICATION_AGENT_MODEL_ID,
        },
        parts: [{ type: "text", text: buildApplicationAgentStartPrompt(task) }],
      },
      false,
    )
    return session
  }

  const resendApplicationAgentStartPrompt = async (session: ApplicationAgentSession, task: ApplicationTask) => {
    await prepareApplicationAgentConfig(task.sessionDirectory)
    await ensureApplicationAgentQuota("resend_start_prompt", task.workspacePath, session.sessionID)
    await postSidecarJson<void>(
      `/session/${session.sessionID}/prompt_async`,
      session.directory,
      {
        agent: "application-agent",
        model: {
          providerID: "opencode-go",
          modelID: APPLICATION_AGENT_MODEL_ID,
        },
        parts: [{ type: "text", text: buildApplicationAgentStartPrompt(task) }],
      },
      false,
    )
  }

  const sendApplicationAgentPrompt = async (session: ApplicationAgentSession, prompt: string) => {
    await ensureApplicationAgentQuota("send_agent_prompt", session.workspacePath, session.sessionID)
    const questions = await getSidecarJson<PendingQuestionRequest[]>("/question", session.directory).catch(() => [])
    const pendingQuestion = questions.find((item) => item.sessionID === session.sessionID)
    if (pendingQuestion) {
      await postSidecarJson<void>(
        `/question/${pendingQuestion.id}/reply`,
        session.directory,
        { answers: inferQuestionAnswers(pendingQuestion, prompt) },
        false,
      )
    }
    const text = `请在目标申请工作区继续执行快捷操作：${prompt}

目标申请工作区：${session.workspacePath}

要求仍然不变：所有资料读取、工作区创建/更新、档案生成、缺失项记录、Word 清单、CUA 填表和总结都由 OpenCode Agent 在会话中完成；不要让桌面壳代做业务逻辑。

重要：如遇到必须由顾问确认的信息，优先使用 OpenCode question 工具提出清晰选项；收到顾问回复后继续执行，并把确认结果同步到 task_state.json、missing_items.json 或 application_progress.json。`
    await postSidecarJson<void>(
      `/session/${session.sessionID}/prompt_async`,
      session.directory,
      {
        agent: "application-agent",
        model: {
          providerID: "opencode-go",
          modelID: APPLICATION_AGENT_MODEL_ID,
        },
        parts: [{ type: "text", text }],
      },
      false,
    )
  }

  const ensureMainWindow = () => {
    if (mainWindow) return

    mainWindow = createMainWindow()
    if (mainWindow) {
      createMenu({
        trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
        checkForUpdates: () => {
          void checkForUpdates(true, killSidecar)
        },
        reload: () => mainWindow?.reload(),
        relaunch: () => {
          void killSidecar().finally(() => {
            app.relaunch()
            app.exit(0)
          })
        },
      })
    }
  }

  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    awaitInitialization: Effect.fnUntraced(
      function* (sendStep) {
        sendStep(initStep)
        const listener = (step: InitStep) => sendStep(step)
        initEmitter.on("step", listener)
        try {
          logger.log("awaiting server ready")
          const res = yield* Deferred.await(serverReady)
          logger.log("server ready", { url: res.url })
          return res
        } finally {
          initEmitter.off("step", listener)
        }
      },
      (e) => Effect.runPromise(e),
    ),
    getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    getWslConfig: () => Promise.resolve(getWslConfig()),
    setWslConfig: (config: WslConfig) => setWslConfig(config),
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    wslPath: async (path, mode) => wslPath(path, mode),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    loadingWindowComplete: () => Deferred.doneUnsafe(loadingComplete, Effect.void),
    runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail, killSidecar),
    checkUpdate: async () => checkUpdate(),
    installUpdate: async () => installUpdate(killSidecar),
    setBackgroundColor: (color) => setBackgroundColor(color),
    startApplicationAgentSession,
    resendApplicationAgentStartPrompt,
    sendApplicationAgentPrompt,
    getApplicationAgentMessages,
    findApplicationAgentSession,
  })

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  app.setAsDefaultProtocolClient("terra-application-agent")
  registerRendererProtocol()
  setDockIcon()
  setupAutoUpdater()

  const needsMigration = ((): boolean => {
    if (process.env.OPENCODE_DB === ":memory:") return false

    const xdg = process.env.XDG_DATA_HOME
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
    return !existsSync(join(base, "opencode", "opencode.db"))
  })()
  let overlay: BrowserWindow | null = null

  const port = yield* Effect.gen(function* () {
    const fromEnv = process.env.OPENCODE_PORT
    if (fromEnv) {
      const parsed = Number.parseInt(fromEnv, 10)
      if (!Number.isNaN(parsed)) return parsed
    }

    const res = yield* Deferred.make<number, unknown>()
    const server = createServer()
    server.on("error", (e) => Deferred.failSync(res, () => e))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        Deferred.failSync(res, () => new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => Effect.runSync(Deferred.succeed(res, port)))
    })

    return yield* Deferred.await(res)
  })
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  ensureMainWindow()

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { url })

    initEmitter.on("sqlite", (progress: SqliteMigrationProgress) => {
      setInitStep({ phase: "sqlite_waiting" })
      if (overlay) sendSqliteMigrationProgress(overlay, progress)
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
    })

    ensureLoopbackNoProxy()
    useEnvProxy()

    logger.log("spawning sidecar", { url })
    const { listener, health } = yield* Effect.promise(() =>
      spawnLocalServer(hostname, port, password, {
        needsMigration,
        userDataPath: app.getPath("userData"),
        onSqliteProgress: (progress) => initEmitter.emit("sqlite", progress),
        onStdout: (message) => logger.log("sidecar stdout", { message }),
        onStderr: (message) => logger.warn("sidecar stderr", { message }),
        onExit: (code) => logger.warn("sidecar exited", { code }),
      }),
    )
    server = listener
    yield* Deferred.succeed(serverReady, {
      url,
      username: "opencode",
      password,
    })

    yield* Effect.promise(() => health.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
        }),
      ),
    )

    logger.log("loading task finished")
  }).pipe(Effect.forkChild)

  if (needsMigration) {
    const show = yield* loadingTask.pipe(
      Fiber.await,
      Effect.timeout("1 second"),
      Effect.as(false),
      Effect.catch(() => Effect.succeed(true)),
    )
    if (show) {
      overlay = createLoadingWindow()
      yield* Effect.sleep("1 second")
    }
  }

  yield* Fiber.await(loadingTask)
  setInitStep({ phase: "done" })

  if (overlay) yield* Deferred.await(loadingComplete)

  ensureMainWindow()

  overlay?.close()
})

Effect.runFork(main)
