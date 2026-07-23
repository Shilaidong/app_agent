import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow } from "electron"

import contextMenu from "electron-context-menu"

import type {
  ApplicationAgentChatItem,
  ApplicationAgentRefillRequest,
  ApplicationAgentRefillSession,
  ApplicationAgentSession,
  ApplicationTask,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  WslConfig,
} from "../preload/types"
import {
  APPLICATION_AGENT_MODELS,
  applicationRefillSessionTitle,
  buildApplicationAgentRefillPrompt,
  buildApplicationAgentStartPrompt,
  completeApplicationRefillAttempt,
  getApplicationTask,
  inspectApplicationRefillAttempt,
  markApplicationRefillPromptSent,
  prepareApplicationAgentConfig,
  prepareApplicationRefillAttempt,
  resolveApplicationAgentModel,
  validateApplicationRefillReadiness,
} from "./application-agent"
import { writeOpenCodeConfig } from "./application-agent-opencode"
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
const PACKAGE_SMOKE_CONFIG_FLAG = "--terra-package-smoke-write-opencode"
const PACKAGE_SMOKE_CONFIG_ENV = "TERRA_EDU_PACKAGE_SMOKE_WRITE_OPENCODE"

let logger: ReturnType<typeof initLogging>
let mainWindow: BrowserWindow | null = null
let server: SidecarListener | null = null

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

const pendingDeepLinks: string[] = []

async function runPackageSmokeConfigProbe() {
  if (!app.isPackaged) throw new Error("The package smoke config probe is available only in a packaged app.")

  const workspace = realpathSync(resolve(process.env.TERRA_EDU_PACKAGE_SMOKE_WORKSPACE || ""))
  const runtimeRoot = realpathSync(resolve(process.env.TERRA_EDU_PACKAGE_SMOKE_RUNTIME_ROOT || ""))
  const temporaryRoot = realpathSync(tmpdir())
  if (
    !runtimeRoot.startsWith(join(temporaryRoot, "terra-edu-direct-dialog-runtime-")) ||
    dirname(workspace) !== runtimeRoot ||
    basename(workspace) !== "workspace"
  ) {
    throw new Error("The package smoke config probe accepts only its isolated temporary workspace.")
  }

  await writeOpenCodeConfig(workspace, {
    egoRuntimeRoot: runtimeRoot,
    egoBrowserSingleLaunchSentinel: join(runtimeRoot, "single-launch.claim"),
  })
  // Packaged macOS GUI binaries often do not attach stdout to the parent spawn.
  // Persist a workspace sentinel so package smoke can confirm without relying on pipes.
  await writeFile(join(workspace, "03_state/package_smoke_config_written"), "TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN\n")
  process.stdout.write("TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN\n")
}

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
    if (text.includes("你现在是 Terra-Edu 重新填写 Agent")) {
      return "重新填写指令已发送。新 Agent 将复用已经整理好的材料和申请档案，只重新执行当前学校的浏览器填表。"
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
          body: `${summarizeOpenCodeReadError(readError)}\n\n${applicationAgentLogHelp(session)}\n\n材料整理尚未完成时，可以先点“重新发送启动指令”；如果材料整理已经完成，请回到任务页使用“根据现有内容重新填写”。`,
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
          ? `Assistant 已超过 3 分钟没有新的回复、part 或工具结果。\n\n${applicationAgentLogHelp(session)}\n\n材料整理尚未完成时，可以先点“重新发送启动指令”；如果材料整理已经完成，请回到任务页使用“根据现有内容重新填写”。`
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
    type SidecarSession = {
      id: string
      directory?: string
      agent?: string
      time?: { updated?: number }
      title?: string
      model?: { id?: string; providerID?: string }
    }
    // Prefer the session's own model when rewriting workspace config. Preparing
    // with the product default first would clobber a mimo session's opencode.json.
    let sessions = await getSidecarJson<SidecarSession[]>("/session?limit=80", workspacePath).catch(() => [] as SidecarSession[])
    if (sessions.length === 0) {
      await prepareApplicationAgentConfig(workspacePath)
      sessions = await getSidecarJson<SidecarSession[]>("/session?limit=80", workspacePath).catch(() => [] as SidecarSession[])
    }
    const found = sessions
      .filter((item) => item.directory === workspacePath)
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      .find(
        (item) =>
          item.agent === "application-agent" ||
          item.agent === "application-refill-agent" ||
          item.title?.includes("申请任务") ||
          item.title?.includes("重新填写"),
      )
    if (!found) return null
    // Reuse the session's original model so restarted prompts keep using it
    // instead of silently falling back to the default. Fall back to the
    // default only if the sidecar entry is old enough to lack a model field.
    const resolved = resolveApplicationAgentModel(found.model?.id, found.model?.providerID)
    await prepareApplicationAgentConfig(workspacePath, { modelId: resolved.optionID })
    return {
      sessionID: found.id,
      directory: workspacePath,
      workspacePath,
      modelID: resolved.modelID,
      providerID: resolved.providerID,
    }
  }

  const startApplicationAgentSession = async (task: ApplicationTask, modelId?: string): Promise<ApplicationAgentSession> => {
    const resolved = resolveApplicationAgentModel(modelId)
    await prepareApplicationAgentConfig(task.sessionDirectory, { modelId: resolved.optionID })
    await ensureApplicationAgentQuota("start_application_task", task.workspacePath)
    const created = await postSidecarJson<{ id: string }>(
      "/session",
      task.sessionDirectory,
      {
        title: `申请任务：${task.input.studentName} / ${task.input.school} / ${task.input.program}`,
        agent: "application-agent",
        model: {
          providerID: resolved.providerID,
          id: resolved.modelID,
        },
      },
    )
    const session: ApplicationAgentSession = {
      sessionID: created.id,
      directory: task.sessionDirectory,
      workspacePath: task.workspacePath,
      modelID: resolved.modelID,
      providerID: resolved.providerID,
    }
    await ensureApplicationAgentQuota("send_start_prompt", task.workspacePath, created.id)
    await postSidecarJson<void>(
      `/session/${created.id}/prompt_async`,
      task.sessionDirectory,
      {
        agent: "application-agent",
        model: {
          providerID: resolved.providerID,
          modelID: resolved.modelID,
        },
        parts: [{ type: "text", text: buildApplicationAgentStartPrompt(task) }],
      },
      false,
    )
    return session
  }

  const applicationAgentRefillSessions = new Map<
    string,
    { requestID: string; pending: Promise<ApplicationAgentRefillSession> }
  >()

  const startApplicationAgentRefillSession = (
    input: ApplicationAgentRefillRequest,
  ): Promise<ApplicationAgentRefillSession> => {
    const requestID = input.requestID.trim()
    if (!requestID) return Promise.reject(new Error("重新填写请求缺少 requestID。"))

    const key = resolve(input.task.workspacePath)
    const running = applicationAgentRefillSessions.get(key)
    if (running?.requestID === requestID) return running.pending
    if (running) return Promise.reject(new Error("正在创建重新填写会话，请稍候。"))

    const pending = (async () => {
      const resolved = resolveApplicationAgentModel(input.modelId)
      const task = await getApplicationTask(input.task.workspacePath)
      const inspected = await inspectApplicationRefillAttempt(task.workspacePath, requestID)
      await validateApplicationRefillReadiness(task.workspacePath)
      await prepareApplicationAgentConfig(task.sessionDirectory, { modelId: resolved.optionID })
      await ensureApplicationAgentQuota("start_application_refill", task.workspacePath)
      const sourceSessionID = inspected?.sourceSessionID || input.sourceSessionID?.trim()
      if (!inspected?.sessionID && sourceSessionID) {
        type SidecarSourceSession = { id: string; directory?: string; agent?: string }
        const source = await getSidecarJson<SidecarSourceSession>(
          `/session/${encodeURIComponent(sourceSessionID)}`,
          task.sessionDirectory,
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (/\b404\b|not found|does not exist/i.test(message)) return undefined
          throw error
        })
        if (source && (
          resolve(source.directory || "") !== resolve(task.sessionDirectory) ||
          (source.agent !== "application-agent" && source.agent !== "application-refill-agent")
        )) {
          throw new Error("旧填写会话不属于当前学校工作区，已拒绝中止；没有启动新的填写任务。")
        }
        if (source) {
        await postSidecarJson<boolean>(
          `/session/${encodeURIComponent(sourceSessionID)}/abort`,
          task.sessionDirectory,
          undefined,
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (/\b404\b|not found|does not exist/i.test(message)) return false
          throw new Error(`无法停止旧填写会话，未启动新的填写任务：${message}`)
        })
        }
      }
      const prepared = await prepareApplicationRefillAttempt(
        task.workspacePath,
        requestID,
        sourceSessionID,
      )
      type SidecarRefillSession = {
        id: string
        directory?: string
        agent?: string
        title?: string
        time?: { created?: number }
      }
      const title = applicationRefillSessionTitle(task, prepared)
      const findCreatedSession = async () => (await getSidecarJson<SidecarRefillSession[]>(
        `/session?search=${encodeURIComponent(prepared.id)}&limit=20`,
        task.sessionDirectory,
      ))
        .filter((session) =>
          resolve(session.directory || "") === resolve(task.sessionDirectory) &&
          session.agent === "application-refill-agent" &&
          session.title === title
        )
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
        .at(0)
      const recovered = prepared.sessionID ? undefined : await findCreatedSession()
      const created = prepared.sessionID
        ? { id: prepared.sessionID }
        : recovered || await postSidecarJson<SidecarRefillSession>(
            "/session",
            task.sessionDirectory,
            {
              title,
              agent: "application-refill-agent",
              model: {
                providerID: resolved.providerID,
                id: resolved.modelID,
              },
            },
          ).catch(async (error) => {
            const recoveredAfterUncertainCreate = await findCreatedSession()
            if (recoveredAfterUncertainCreate) return recoveredAfterUncertainCreate
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`新填表对话的创建结果尚未确认：${message}。请保留当前确认面板并再次点击，系统会先查找同一次对话，不会直接重复创建。`)
          })
      const attempt = prepared.sessionID
        ? prepared
        : await completeApplicationRefillAttempt(task.workspacePath, prepared.id, created.id)
      const session: ApplicationAgentSession = {
        sessionID: created.id,
        directory: task.sessionDirectory,
        workspacePath: task.workspacePath,
        modelID: resolved.modelID,
        providerID: resolved.providerID,
      }
      type SidecarRefillMessage = { info?: { role?: string } }
      const messages = await getSidecarJson<SidecarRefillMessage[]>(
        `/session/${session.sessionID}/message?limit=80`,
        session.directory,
      )
      if (!messages.some((message) => message.info?.role === "user")) {
        await ensureApplicationAgentQuota("send_refill_prompt", task.workspacePath, session.sessionID)
        await postSidecarJson<void>(
          `/session/${session.sessionID}/prompt_async`,
          session.directory,
          {
            agent: "application-refill-agent",
            model: {
              providerID: resolved.providerID,
              modelID: resolved.modelID,
            },
            parts: [{ type: "text", text: buildApplicationAgentRefillPrompt(task, attempt) }],
          },
          false,
        ).catch(async (error) => {
          const recoveredMessages = await getSidecarJson<SidecarRefillMessage[]>(
            `/session/${session.sessionID}/message?limit=80`,
            session.directory,
          ).catch(() => [])
          if (recoveredMessages.some((message) => message.info?.role === "user")) return
          throw error
        })
      }
      return {
        session,
        attempt: await markApplicationRefillPromptSent(task.workspacePath, attempt.id, session.sessionID),
      }
    })()
    applicationAgentRefillSessions.set(key, { requestID, pending })
    void pending.then(
      () => {
        if (applicationAgentRefillSessions.get(key)?.pending === pending) applicationAgentRefillSessions.delete(key)
      },
      () => {
        if (applicationAgentRefillSessions.get(key)?.pending === pending) applicationAgentRefillSessions.delete(key)
      },
    )
    return pending
  }

  const resendApplicationAgentStartPrompt = async (session: ApplicationAgentSession, task: ApplicationTask) => {
    if (await applicationAgentForSession(session) !== "application-agent") {
      throw new Error("重新填写会话不能重新发送材料整理启动指令；请直接在当前对话中补充填表信息。")
    }
    const resolved = resolveApplicationAgentModel(session.modelID, session.providerID)
    await prepareApplicationAgentConfig(task.sessionDirectory, { modelId: resolved.optionID })
    await ensureApplicationAgentQuota("resend_start_prompt", task.workspacePath, session.sessionID)
    await postSidecarJson<void>(
      `/session/${session.sessionID}/prompt_async`,
      task.sessionDirectory,
      {
        agent: "application-agent",
        model: {
          providerID: resolved.providerID,
          modelID: resolved.modelID,
        },
        parts: [{ type: "text", text: buildApplicationAgentStartPrompt(task) }],
      },
      false,
    )
  }

  const applicationAgentForSession = async (session: ApplicationAgentSession) => {
    const info = await getSidecarJson<{ id: string; directory?: string; agent?: string }>(
      `/session/${encodeURIComponent(session.sessionID)}`,
      session.directory,
    )
    if (resolve(info.directory || "") !== resolve(session.directory)) {
      throw new Error("OpenCode 对话不属于当前申请工作区，已拒绝发送消息。")
    }
    if (info.agent === "application-agent" || info.agent === "application-refill-agent") return info.agent
    throw new Error("当前 OpenCode 对话不是申请 Agent 会话，已拒绝发送消息。")
  }

  const sendApplicationAgentPrompt = async (session: ApplicationAgentSession, prompt: string) => {
    const agent = await applicationAgentForSession(session)
    const resolved = resolveApplicationAgentModel(session.modelID, session.providerID)
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
    const text = agent === "application-refill-agent"
      ? `顾问在当前“根据现有内容重新填写”对话中发来补充或操作指令：${prompt}

目标申请工作区：${session.workspacePath}

本会话边界保持不变：只复用已经确认的材料、student_profile.md、application_requirements.json、missing_items.json 和当前 application_progress.json；不得重新初始化工作区、OCR、分类、研究要求、生成档案或读取旧对话/归档进度。只继续当前学校的 Ego 填表；不要新建另一个 task space，也不要切换到批次内其他学校。不确定信息继续使用 question 询问顾问，最终提交、付款、不可逆推荐信邀请和密码保存仍然禁止。`
      : `请在目标申请工作区继续执行快捷操作：${prompt}

目标申请工作区：${session.workspacePath}

要求仍然不变：所有资料读取、工作区创建/更新、档案生成、缺失项记录、Word 清单、CUA 填表和总结都由 OpenCode Agent 在会话中完成；不要让桌面壳代做业务逻辑。

重要：如遇到必须由顾问确认的信息，优先使用 OpenCode question 工具提出清晰选项；收到顾问回复后继续执行，并把确认结果同步到 task_state.json、missing_items.json 或 application_progress.json。`
    await postSidecarJson<void>(
      `/session/${session.sessionID}/prompt_async`,
      session.directory,
      {
        agent,
        model: {
          providerID: resolved.providerID,
          modelID: resolved.modelID,
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
    startApplicationAgentRefillSession,
    resendApplicationAgentStartPrompt,
    sendApplicationAgentPrompt,
    getApplicationAgentMessages,
    findApplicationAgentSession,
    getApplicationAgentModels: () => Promise.resolve(APPLICATION_AGENT_MODELS),
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

// Electron 41+ rejects unknown Chromium CLI switches before JS runs ("bad option").
// Packaged smoke therefore triggers via env; argv remains supported for older probes.
if (
  process.env[PACKAGE_SMOKE_CONFIG_ENV] === "1" ||
  process.argv.includes(PACKAGE_SMOKE_CONFIG_FLAG)
) {
  void app.whenReady()
    .then(runPackageSmokeConfigProbe)
    .then(async () => {
      // Give stdout/sentinel writes a tick before quitting; macOS GUI apps often drop pipes.
      await new Promise((resolve) => setTimeout(resolve, 50))
      app.exit(0)
    })
    .catch((error) => {
      process.stderr.write(`TERRA_EDU_PACKAGE_SMOKE_CONFIG_FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
      app.exit(1)
    })
} else {
  Effect.runFork(main)
}
