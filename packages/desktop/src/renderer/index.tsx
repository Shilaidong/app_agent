// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FILE_TYPES,
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@opencode-ai/app"
import * as Sentry from "@sentry/solid"
import type { AsyncStorage } from "@solid-primitives/storage"
import { MemoryRouter, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import type {
  ApplicationAgentChatItem,
  ApplicationAgentSession,
  ApplicationSelectionListPreview,
  ApplicationTask,
  ApplicationTaskInput,
  TerraAuthStatus,
} from "../preload/types"
import applicationAgentAvatar from "./assets/application-agent-avatar.png"
import {
  activeApplicationSessionKey,
  applicationTypes,
  base64Encode,
  defaultTaskInput,
  groupedTasks,
  isSameApplicationTaskInput,
  mergeAgentMessages,
  quickCommands,
  taskGeneratedFiles,
  taskGoals,
  taskCounts,
  taskProgress,
} from "./application-agent-view-model"
import { initI18n, t } from "./i18n"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { useTheme } from "@opencode-ai/ui/theme"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.OPENCODE_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      )
    },
  })
}

void initI18n()

const deepLinkEvent = "opencode:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  void window.api.consumeInitialDeepLinks().then((urls) => emitDeepLinks(urls))
  return window.api.onDeepLink((urls) => emitDeepLinks(urls))
}

const createPlatform = (): Platform => {
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  const isWslEnabled = async () => {
    if (os !== "windows") return false
    return window.api
      .getWslConfig()
      .then((config) => config.enabled)
      .catch(() => false)
  }

  const wslHome = async () => {
    if (!(await isWslEnabled())) return undefined
    return window.api.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !(await isWslEnabled())) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => window.api.wslPath(path, "linux").catch(() => path))) as any
    }
    return window.api.wslPath(result, "linux").catch(() => result) as any
  }

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string) => {
      const api: AsyncStorage = {
        getItem: (key: string) => window.api.storeGet(name, key),
        setItem: (key: string, value: string) => window.api.storeSet(name, key, value),
        removeItem: (key: string) => window.api.storeDelete(name, key),
        clear: () => window.api.storeClear(name),
        key: async (index: number) => (await window.api.storeKeys(name))[index],
        getLength: () => window.api.storeLength(name),
        get length() {
          return api.getLength()
        },
      }
      return api
    }

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  return {
    platform: "desktop",
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await window.api.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await window.api.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        accept: opts?.accept ?? ACCEPTED_FILE_TYPES,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await window.api.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      window.api.openLink(url)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await window.api.resolveAppPath(app).catch(() => null) : null
        const resolvedPath = await (async () => {
          if (await isWslEnabled()) {
            const converted = await window.api.wslPath(path, "windows").catch(() => null)
            if (converted) return converted
          }
          return path
        })()
        return window.api.openPath(resolvedPath, resolvedApp ?? undefined)
      }
      return window.api.openPath(path, app)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    checkUpdate: async () => {
      const config = await window.api.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return { updateAvailable: false }
      return window.api.checkUpdate()
    },

    updateAndRestart: async () => {
      const config = await window.api.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return
      await window.api.installUpdate()
    },

    restart: async () => {
      await window.api.killSidecar().catch(() => undefined)
      window.api.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await window.api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://opencode.ai/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void window.api.showWindow()
        void window.api.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getWslEnabled: () => isWslEnabled(),

    setWslEnabled: async (enabled) => {
      await window.api.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await window.api.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await window.api.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      return window.api.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await window.api.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => window.api.parseMarkdownCommand(markdown),

    webviewZoom,

    checkAppExists: async (appName: string) => {
      return window.api.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await window.api.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

function OpenCodeSessionNavigator(props: { session: ApplicationAgentSession | null }) {
  const navigate = useNavigate()
  createEffect(() => {
    const session = props.session
    if (!session) return
    navigate(`/${base64Encode(session.directory)}/session/${session.sessionID}`, { replace: true })
  })
  return null
}

function MarkdownBody(props: { markdown: string }) {
  const [html] = createResource(
    () => props.markdown,
    async (markdown) => window.api.parseMarkdownCommand(markdown || ""),
  )
  return (
    <div
      class="agent-message-body markdown-body"
      innerHTML={html() ?? props.markdown.replace(/[&<>"']/g, (char) => {
        const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
        return map[char] ?? char
      })}
    />
  )
}

function messageTime(time?: number) {
  if (!time) return ""
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function isTechnicalAgentMessage(message: ApplicationAgentChatItem) {
  if (message.question) return false
  if (message.title.includes("需要顾问确认") || message.title.includes("顾问确认问题")) return false
  if (message.role === "tool") return true
  const title = message.title.trim()
  if (/^(已完成|正在执行|执行中|失败|错误|Completed|Running|Failed|Error)\s*[:：]/i.test(title)) return true
  if (/^(bash|edit|read|write|glob|grep|ls|cat|node|python|application-agent_|cua)/i.test(title)) return true
  return false
}

function technicalAgentCommand(message: ApplicationAgentChatItem) {
  return message.title
    .replace(/^(已完成|正在执行|执行中|失败|错误|Completed|Running|Failed|Error)\s*[:：]\s*/i, "")
    .trim()
}

function agentMessageTitle(message: ApplicationAgentChatItem) {
  if (!isTechnicalAgentMessage(message)) return message.title
  if (message.status === "running" || message.status === "pending") return "工具正在执行"
  if (message.status === "error") return "工具执行遇到问题"
  return "工具执行记录"
}

function agentMessageTime(message: ApplicationAgentChatItem) {
  if (message.status === "pending") return "等待中"
  if (message.status === "running") return "进行中"
  if (message.status === "completed") return "已完成"
  if (message.status === "error") return "需查看"
  return messageTime(message.time)
}

function AgentQuestionCard(props: { message: ApplicationAgentChatItem; onReply: (text: string) => void }) {
  const [customAnswer, setCustomAnswer] = createSignal("")
  const [selectedOptions, setSelectedOptions] = createSignal<Record<number, string[]>>({})
  const questions = () => props.message.question?.questions ?? []
  const selected = (index: number) => selectedOptions()[index] ?? []
  const chooseOption = (index: number, question: NonNullable<ApplicationAgentChatItem["question"]>["questions"][number], label: string) => {
    setSelectedOptions((current) => {
      const previous = current[index] ?? []
      const next = question.multiple
        ? previous.includes(label)
          ? previous.filter((item) => item !== label)
          : [...previous, label]
        : [label]
      return { ...current, [index]: next }
    })
  }
  const canSubmitOptions = () =>
    questions().some((question) => question.options?.length) &&
    questions().every((question, index) => !question.options?.length || selected(index).length > 0)
  const submitOptions = () => {
    if (!canSubmitOptions()) return
    props.onReply(
      questions()
        .map((question, index) => {
          const labels = selected(index)
          if (labels.length === 0) return ""
          return `关于「${question.header || "顾问确认"}」：${labels.join("、")}`
        })
        .filter(Boolean)
        .join("\n"),
    )
  }
  const sendCustom = () => {
    const text = customAnswer().trim()
    if (!text) return
    setCustomAnswer("")
    props.onReply(text)
  }
  return (
    <article class="agent-message assistant question-card">
      <div class="agent-message-header">
        <strong>需要顾问确认</strong>
        <time>{agentMessageTime(props.message)}</time>
      </div>
      <div class="question-card-body">
        <For each={questions()}>
          {(question, index) => (
            <section>
              <h3>{question.header || "确认问题"}</h3>
              <p>{question.question}</p>
              <Show when={question.options?.length}>
                <small class="question-selection-hint">{question.multiple ? "可多选，选完后统一提交。" : "请选择一项，选完后统一提交。"}</small>
                <div class="question-options">
                  <For each={question.options}>
                    {(option) => (
                      <button
                        type="button"
                        classList={{ selected: selected(index()).includes(option.label) }}
                        aria-pressed={selected(index()).includes(option.label)}
                        onClick={(event) => {
                          event.currentTarget.blur()
                          chooseOption(index(), question, option.label)
                        }}
                      >
                        <strong>{option.label}</strong>
                        <Show when={option.description}><small>{option.description}</small></Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </For>
        <Show when={questions().some((question) => question.options?.length)}>
          <button type="button" class="question-submit" disabled={!canSubmitOptions()} onClick={submitOptions}>
            确认并提交所选项
          </button>
        </Show>
        <div class="question-custom-reply">
          <input
            value={customAnswer()}
            onInput={(event) => setCustomAnswer(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                sendCustom()
              }
            }}
            placeholder="也可以输入自定义确认内容..."
          />
          <button
            type="button"
            disabled={!customAnswer().trim()}
            onClick={(event) => {
              event.currentTarget.blur()
              sendCustom()
            }}
          >
            回复
          </button>
        </div>
      </div>
    </article>
  )
}

function AgentMessageCard(props: { message: ApplicationAgentChatItem; onReply: (text: string) => void }) {
  if (props.message.question) return <AgentQuestionCard message={props.message} onReply={props.onReply} />
  const technical = () => isTechnicalAgentMessage(props.message)
  const command = () => technicalAgentCommand(props.message)
  return (
    <article class={`agent-message ${props.message.role} ${props.message.status ?? ""} ${technical() ? "technical" : ""}`}>
      <div class="agent-message-header">
        <strong>{agentMessageTitle(props.message)}</strong>
        <time>{agentMessageTime(props.message)}</time>
      </div>
      <Show
        when={technical()}
        fallback={<MarkdownBody markdown={props.message.body || "正在更新..."} />}
      >
        <details class="agent-technical-details">
          <summary>
            <span>查看技术细节</span>
            <small>{command() || "工具输出"}</small>
          </summary>
          <MarkdownBody markdown={props.message.body || "正在更新..."} />
        </details>
      </Show>
    </article>
  )
}

type AgentDisplayItem =
  | { kind: "message"; id: string; message: ApplicationAgentChatItem }
  | { kind: "technical-group"; id: string; messages: ApplicationAgentChatItem[] }

function groupAgentMessages(messages: ApplicationAgentChatItem[]): AgentDisplayItem[] {
  const items: AgentDisplayItem[] = []
  let technical: ApplicationAgentChatItem[] = []

  const flushTechnical = () => {
    if (technical.length === 0) return
    const first = technical[0]
    const last = technical[technical.length - 1]
    items.push({
      kind: "technical-group",
      id: `technical:${first.id}:${last.id}:${technical.length}`,
      messages: technical,
    })
    technical = []
  }

  for (const message of messages) {
    if (isTechnicalAgentMessage(message)) {
      technical.push(message)
      continue
    }
    flushTechnical()
    items.push({ kind: "message", id: message.id, message })
  }

  flushTechnical()
  return items
}

function technicalGroupStatus(messages: ApplicationAgentChatItem[]) {
  if (messages.some((message) => message.status === "error")) return "需查看"
  if (messages.some((message) => message.status === "running" || message.status === "pending")) return "执行中"
  return "已折叠"
}

function technicalGroupSummary(messages: ApplicationAgentChatItem[]) {
  const commands = Array.from(new Set(messages.map(technicalAgentCommand).filter(Boolean)))
  if (commands.length === 0) return "工具输出"
  return commands.slice(0, 4).join(" / ") + (commands.length > 4 ? ` 等 ${commands.length} 类` : "")
}

function AgentTechnicalGroup(props: { messages: ApplicationAgentChatItem[] }) {
  return (
    <article class="agent-message technical technical-group">
      <div class="agent-message-header">
        <strong>技术执行记录</strong>
        <time>{technicalGroupStatus(props.messages)}</time>
      </div>
      <details class="agent-technical-details">
        <summary>
          <span>查看 {props.messages.length} 条技术细节</span>
          <small>{technicalGroupSummary(props.messages)}</small>
        </summary>
        <div class="agent-technical-list">
          <For each={props.messages}>
            {(message) => (
              <details class="agent-technical-item">
                <summary>
                  <strong>{technicalAgentCommand(message) || message.title}</strong>
                  <time>{agentMessageTime(message)}</time>
                </summary>
                <MarkdownBody markdown={message.body || "正在更新..."} />
              </details>
            )}
          </For>
        </div>
      </details>
    </article>
  )
}

function ApplicationAgentShell(props: {
  opencodeWorkspace: (session: ApplicationAgentSession | null) => JSX.Element
  providerReady: boolean
}) {
  const [input, setInput] = createSignal<ApplicationTaskInput>(defaultTaskInput())
  const [task, setTask] = createSignal<ApplicationTask | null>(null)
  const [opencodeSession, setOpenCodeSession] = createSignal<ApplicationAgentSession | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [showOpenCode, setShowOpenCode] = createSignal(false)
  const [goKey, setGoKey] = createSignal("")
  const [goConfigured, setGoConfigured] = createSignal(false)
  const [agentMessages, setAgentMessages] = createSignal<ApplicationAgentChatItem[]>([])
  const [agentInput, setAgentInput] = createSignal("")
  const [restoreNotice, setRestoreNotice] = createSignal<string | null>(null)
  const [applicationTasks, setApplicationTasks] = createSignal<ApplicationTask[]>([])
  const [homeMode, setHomeMode] = createSignal<"new" | "read">("new")
  const [selectedTaskStudent, setSelectedTaskStudent] = createSignal("")
  const [authStatus, setAuthStatus] = createSignal<TerraAuthStatus | null>(null)
  const [loginEmail, setLoginEmail] = createSignal("")
  const [loginPassword, setLoginPassword] = createSignal("")
  const [creationMode, setCreationMode] = createSignal<"manual" | "selection-list">("manual")
  const [selectionListPath, setSelectionListPath] = createSignal("")
  const [selectionListPreview, setSelectionListPreview] = createSignal<ApplicationSelectionListPreview | null>(null)
  const [selectedSelectionRows, setSelectedSelectionRows] = createSignal<number[]>([])
  const [savedPlatformAccount, setSavedPlatformAccount] = createSignal<{ username: string; updatedAt: string } | null>(null)
  let agentChatListRef: HTMLDivElement | undefined
  let pendingScrollRestore: { top: number; height: number } | null = null
  let lastAgentMessageSignature = ""
  let lastAutomationNotificationKey = ""
  let lastProgressNotificationKey = ""
  let lastQuestionNotificationKey = ""
  const taskGroups = createMemo(() => groupedTasks(applicationTasks()))
  const selectedTaskGroup = createMemo(() => {
    const groups = taskGroups()
    return groups.find((group) => group.student === selectedTaskStudent()) ?? groups[0]
  })
  const needsLogin = createMemo(() => Boolean(authStatus()?.configured && !authStatus()?.authenticated))
  const quotaText = createMemo(() => {
    const quota = authStatus()?.quota
    if (!quota) return authStatus()?.localDevelopment ? "本地开发模式" : "等待登录"
    return `${quota.creditsRemaining} / ${quota.creditsTotal} credits`
  })

  const persistActiveSession = (session: ApplicationAgentSession) => {
    localStorage.setItem(activeApplicationSessionKey, JSON.stringify({ ...session, savedAt: Date.now() }))
  }

  const clearActiveSession = () => {
    localStorage.removeItem(activeApplicationSessionKey)
  }

  const update = <K extends keyof ApplicationTaskInput>(key: K, value: ApplicationTaskInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }))
  }

  const captureAgentScroll = () => {
    const list = agentChatListRef
    if (!list) return
    pendingScrollRestore = { top: list.scrollTop, height: list.scrollHeight }
  }

  const agentListNearBottom = () => {
    const list = agentChatListRef
    if (!list) return true
    return list.scrollHeight - list.scrollTop - list.clientHeight < 140
  }

  const scheduleAgentScroll = (mode: "restore" | "bottom", smooth = true) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const list = agentChatListRef
        if (!list) return
        if (mode === "restore") {
          if (!pendingScrollRestore) return
          const delta = list.scrollHeight - pendingScrollRestore.height
          list.scrollTop = Math.max(0, pendingScrollRestore.top + Math.min(delta, 0))
          pendingScrollRestore = null
          return
        }
        list.scrollTo({
          top: list.scrollHeight,
          behavior: smooth ? "smooth" : "auto",
        })
      })
    })
  }

  const agentMessageSignature = (messages: ApplicationAgentChatItem[]) => {
    const last = messages.at(-1)
    return `${messages.length}:${last?.id ?? ""}:${last?.status ?? ""}:${last?.body?.length ?? 0}`
  }

  const isRecentNotification = (value?: number | string) => {
    const time = typeof value === "number" ? value : Date.parse(String(value || ""))
    if (!Number.isFinite(time) || time <= 0) return true
    return Date.now() - time < 5 * 60 * 1000
  }

  const notifyPendingQuestion = (messages: ApplicationAgentChatItem[]) => {
    const question = messages.findLast((item) => item.question && item.status !== "completed")
    if (!question) return
    const key = `${question.id}:${question.status ?? "running"}`
    if (key === lastQuestionNotificationKey) return
    if (!isRecentNotification(question.time)) return
    lastQuestionNotificationKey = key
    const first = question.question?.questions?.[0]
    window.api.showNotification(
      "申请 Agent 需要你确认",
      first?.question || "OpenCode Agent 正在等待顾问回答问题，回复后会继续执行。",
    )
  }

  const notifyTaskProgress = (latestTask: ApplicationTask) => {
    const latestProgress = latestTask.progress.at(-1)
    if (!latestProgress) return
    const key = `${latestTask.workspacePath}:${latestProgress.at}:${latestProgress.status}:${latestProgress.message}`
    if (key === lastProgressNotificationKey) return
    if (!isRecentNotification(latestProgress.at)) return
    lastProgressNotificationKey = key

    const completed = /完成|可继续|等待|异常|已/.test(latestProgress.status) || /完成|已|等待|停止|熔断/.test(latestProgress.message)
    window.api.showNotification(
      completed ? "申请 Agent 步骤已更新" : "申请 Agent 正在推进",
      latestProgress.message || `当前状态：${latestProgress.status}`,
    )
  }

  const pickFolder = async () => {
    const folder = await window.api.openDirectoryPicker({ title: "选择学生资料文件夹" })
    if (typeof folder === "string") update("sourceFolder", folder)
  }

  const pickSelectionList = async () => {
    const file = await window.api.openFilePicker({
      title: "选择选校清单（Excel）",
      extensions: ["xlsx"],
    })
    if (typeof file !== "string") return
    setBusy(true)
    setError(null)
    try {
      const preview = await window.api.previewApplicationSelectionList(file)
      setSelectionListPath(file)
      setSelectionListPreview(preview)
      setSelectedSelectionRows(preview.rows.filter((row) => row.status === "ready" || row.status === "needs_research").map((row) => row.rowNumber))
    } catch (err) {
      setSelectionListPath("")
      setSelectionListPreview(null)
      setSelectedSelectionRows([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const downloadSelectionListTemplate = async () => {
    setBusy(true)
    setError(null)
    try {
      const destination = await window.api.downloadApplicationSelectionListTemplate()
      if (destination) setRestoreNotice(`已下载无密码选校清单模板：${destination}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleSelectionRow = (rowNumber: number, checked: boolean) => {
    setSelectedSelectionRows((current) => (checked ? [...new Set([...current, rowNumber])] : current.filter((row) => row !== rowNumber)))
  }

  const loadPlatformAccount = async (applicationUrl = input().applicationUrl || "") => {
    if (!applicationUrl.trim()) {
      setSavedPlatformAccount(null)
      return
    }
    const saved = await window.api.getApplicationPlatformAccount(applicationUrl).catch(() => null)
    setSavedPlatformAccount(saved ? { username: saved.username, updatedAt: saved.updatedAt } : null)
    if (saved?.username && !input().platformUsername?.trim()) update("platformUsername", saved.username)
  }

  const loadApplicationTasks = async () => {
    const tasks = await window.api.listApplicationTasks(80).catch(() => [])
    setApplicationTasks(tasks)
  }

  const refreshAuthStatus = async () => {
    const status = await window.api.getTerraAuthStatus()
    setAuthStatus(status)
    if (status.user?.email && !loginEmail()) setLoginEmail(status.user.email)
    return status
  }

  const loginAdvisor = async () => {
    setBusy(true)
    setError(null)
    try {
      const status = await window.api.loginTerraAdvisor(loginEmail().trim(), loginPassword())
      setAuthStatus(status)
      setLoginPassword("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const logoutAdvisor = async () => {
    setBusy(true)
    setError(null)
    try {
      const status = await window.api.logoutTerraAdvisor()
      setAuthStatus(status)
      setTask(null)
      setOpenCodeSession(null)
      clearActiveSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const clearPlatformAccount = async () => {
    if (!(input().applicationUrl || "").trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.api.clearApplicationPlatformAccount(input().applicationUrl || "")
      setSavedPlatformAccount(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const createTask = async () => {
    setBusy(true)
    setError(null)
    try {
      const latestTasks = await window.api.listApplicationTasks(120).catch(() => applicationTasks())
      const existingTask = latestTasks.find((item) => isSameApplicationTaskInput(item.input, input()))
      if (existingTask) {
        setApplicationTasks(latestTasks)
        await switchTask(existingTask, "已找到已有申请，已切换到原工作区；不会再创建重复任务。", true)
        return
      }
      if ((input().applicationUrl || "").trim() && input().platformUsername?.trim()) {
        const saved = await window.api.saveApplicationPlatformAccount({
          applicationUrl: input().applicationUrl || "",
          username: input().platformUsername || "",
        })
        setSavedPlatformAccount(saved ? { username: saved.username, updatedAt: saved.updatedAt } : null)
      }
      const created = await window.api.createApplicationTask(input())
      if (created.reusedExisting) {
        await switchTask(created, "已找到已有申请，已切换到原工作区；不会再创建重复任务。", true)
        return
      }
      setTask(created)
      const session = await window.api.startApplicationAgentSession(created)
      setOpenCodeSession(session)
      persistActiveSession(session)
      setShowOpenCode(false)
      await refreshAgentMessages(session)
      await refreshAuthStatus()
      await loadApplicationTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const createTasksFromSelectionList = async () => {
    if (!selectionListPath() || !selectionListPreview()) {
      setError("请先选择并解析选校清单。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const batch = await window.api.createApplicationTasksFromSelectionList({
        studentName: input().studentName,
        sourceFolder: input().sourceFolder,
        applicationType: input().applicationType,
        selectionListPath: selectionListPath(),
        selectedRows: selectedSelectionRows(),
        outputLanguage: input().outputLanguage,
        allowUpload: input().allowUpload,
        taskGoal: input().taskGoal,
      })
      const firstTask = batch.tasks[0]
      if (!firstTask) throw new Error("没有创建可启动的申请任务。")
      setApplicationTasks((current) => [...batch.tasks, ...current.filter((item) => !batch.tasks.some((task) => task.workspacePath === item.workspacePath))])
      setTask(firstTask)
      const session = await window.api.startApplicationAgentSession(firstTask)
      setOpenCodeSession(session)
      persistActiveSession(session)
      setShowOpenCode(false)
      setRestoreNotice(`已创建 ${batch.tasks.length} 个学校任务；学生材料已在批次工作区统一暂存，将从第 1 个任务开始依次处理。`)
      await refreshAgentMessages(session)
      await refreshAuthStatus()
      await loadApplicationTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runCommand = async (command: string) => {
    const current = task()
    const session = opencodeSession()
    if (!current || !session) return
    setBusy(true)
    setError(null)
    try {
      await window.api.sendApplicationAgentPrompt(session, command)
      await refreshAgentMessages(session)
      await refreshAuthStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resendStartPrompt = async () => {
    const current = task()
    const session = opencodeSession()
    if (!current || !session) return
    setBusy(true)
    setError(null)
    try {
      await window.api.resendApplicationAgentStartPrompt(session, current)
      setRestoreNotice("已重新发送精简启动指令：只要求建立 todowrite、初始化工作区并同步状态。")
      await refreshAgentMessages(session)
      await refreshAuthStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const rebuildOpenCodeSession = async () => {
    const current = task()
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const session = await window.api.startApplicationAgentSession(current)
      setOpenCodeSession(session)
      setAgentMessages([])
      persistActiveSession(session)
      setRestoreNotice("已重建 OpenCode 会话，并发送精简启动指令。旧会话不会被隐藏，可通过 OpenCode 原生页查看。")
      await refreshAgentMessages(session)
      await refreshAuthStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const blockSubmit = async () => {
    const current = task()
    const session = opencodeSession()
    if (!current || !session) return
    await window.api.sendApplicationAgentPrompt(session, "记录并演示高风险动作拦截：最终提交/付款/推荐信邀请必须交给顾问人工处理")
    await refreshAgentMessages(session)
    await refreshAuthStatus()
  }

  const stopAutomation = async () => {
    setError(null)
    try {
      await window.api.stopApplicationAutomation(task()?.workspacePath)
      setRestoreNotice("已停止浏览器自动化，并把窗口焦点释放回申请 Agent。")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const sendAgentMessage = async () => {
    const text = agentInput().trim()
    const session = opencodeSession()
    if (!session || !text) return
    const wasNearBottom = agentListNearBottom()
    setBusy(true)
    setError(null)
    try {
      setAgentInput("")
      await window.api.sendApplicationAgentPrompt(session, text)
      await refreshAgentMessages(session)
      if (wasNearBottom) scheduleAgentScroll("bottom", true)
      await refreshAuthStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const replyToAgentQuestion = async (text: string) => {
    const session = opencodeSession()
    if (!session || !text.trim()) return
    captureAgentScroll()
    setBusy(true)
    setError(null)
    try {
      await window.api.sendApplicationAgentPrompt(session, text.trim())
      await refreshAgentMessages(session)
      scheduleAgentScroll("restore", false)
      await refreshAuthStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resetToHome = () => {
    clearActiveSession()
    setInput(defaultTaskInput())
    setCreationMode("manual")
    setSelectionListPath("")
    setSelectionListPreview(null)
    setSelectedSelectionRows([])
    setSavedPlatformAccount(null)
    setTask(null)
    setOpenCodeSession(null)
    setShowOpenCode(false)
    setError(null)
  }

  const switchTask = async (next: ApplicationTask, notice?: string, force = false) => {
    const current = task()
    if ((!force && busy()) || current?.workspacePath === next.workspacePath) return
    setBusy(true)
    setError(null)
    setRestoreNotice(null)
    try {
      const latestTask = await window.api.getApplicationTask(next.workspacePath)
      const session = await window.api.findApplicationAgentSession(latestTask.workspacePath)
      if (!session) throw new Error("未找到或无法创建该申请的 OpenCode 会话")
      setTask(latestTask)
      setInput(latestTask.input)
      setOpenCodeSession(session)
      setShowOpenCode(false)
      setAgentMessages([])
      persistActiveSession(session)
      setRestoreNotice(notice || `已切换到：${latestTask.input.studentName || "未命名学生"} / ${latestTask.input.school || "未填写学校"}`)
      await refreshAgentMessages(session)
      await loadApplicationTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const switchToNextBatchTask = async () => {
    const current = task()
    if (!current?.input.batchId) return
    const next = applicationTasks()
      .filter((item) => item.input.batchId === current.input.batchId && (item.input.batchOrder ?? 0) > (current.input.batchOrder ?? 0))
      .sort((a, b) => (a.input.batchOrder ?? Number.MAX_SAFE_INTEGER) - (b.input.batchOrder ?? Number.MAX_SAFE_INTEGER))[0]
    if (!next) {
      setRestoreNotice("这是本批次最后一个学校任务。")
      return
    }
    await switchTask(next, `已切换到批次第 ${next.input.batchOrder} 所学校，继续复用同一份材料来源。`)
  }

  const renderTaskList = () => (
    <Show
      when={taskGroups().length > 0}
      fallback={<p class="empty-task-list">还没有历史申请。创建任务后会出现在这里。</p>}
    >
      <div class="task-list-shell">
        <div class="task-student-list">
          <For each={taskGroups()}>
            {(group) => (
              <button
                type="button"
                classList={{ active: group.student === selectedTaskGroup()?.student }}
                onClick={() => setSelectedTaskStudent(group.student)}
              >
                <strong>{group.student}</strong>
                <small>{group.items.length} 个申请</small>
              </button>
            )}
          </For>
        </div>
        <div class="task-list-scroll">
          <Show when={selectedTaskGroup()}>
            {(group) => (
              <div class="task-group">
                <For each={group().items}>
                  {(item) => (
                    <button
                      type="button"
                      classList={{ active: item.workspacePath === task()?.workspacePath }}
                      disabled={busy()}
                      onClick={() => switchTask(item)}
                    >
                      <strong>{item.input.batchOrder ? `第 ${item.input.batchOrder} 所 · ` : ""}{item.input.school || "未填写学校"}</strong>
                      <span>{item.input.program || "未填写项目"}</span>
                      <small>{item.status} · {new Date(item.updatedAt).toLocaleString()}</small>
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  )

  const saveGoKey = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.setOpenCodeGoApiKey(goKey())
      setGoConfigured(Boolean(goKey().trim()))
      setGoKey("")
      window.api.showNotification(
        "OpenCode Go 已配置",
        "API key 已保存到本机安全存储。重启应用后 OpenCode sidecar 会自动读取。",
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const refreshAgentMessages = async (session = opencodeSession()) => {
    if (!session) return
    const wasNearBottom = agentListNearBottom()
    const [messages, latestTask] = await Promise.all([
      window.api.getApplicationAgentMessages(session),
      window.api.getApplicationTask(session.workspacePath).catch(() => null),
    ])
    const nextSignature = agentMessageSignature(messages)
    const changed = nextSignature !== lastAgentMessageSignature
    setAgentMessages((current) => mergeAgentMessages(current, messages))
    if (changed) {
      lastAgentMessageSignature = nextSignature
      notifyPendingQuestion(messages)
      if (pendingScrollRestore) scheduleAgentScroll("restore", false)
      else if (wasNearBottom) scheduleAgentScroll("bottom", true)
    }
    if (latestTask) {
      notifyTaskProgress(latestTask)
      const stopKey = `${latestTask.workspacePath}:${latestTask.status}:${latestTask.updatedAt}`
      const latestProgressMessage = latestTask.progress.at(-1)?.message || ""
      if (
        latestTask.status === "异常中断" &&
        stopKey !== lastAutomationNotificationKey &&
        /CUA|Chrome|自动化|熔断|停止|前台|鼠标/.test(latestProgressMessage)
      ) {
        lastAutomationNotificationKey = stopKey
        window.api.showNotification(
          "申请 Agent 自动化已停止",
          latestProgressMessage || "浏览器自动化已停止。请回到申请 Agent 查看下一步。",
        )
      }
      setTask(latestTask)
      setInput(latestTask.input)
    }
    void refreshAuthStatus()
    persistActiveSession(session)
  }

  onMount(() => {
    void window.api.hasOpenCodeGoApiKey().then(setGoConfigured)
    void refreshAuthStatus()
    void loadApplicationTasks()
  })

  createEffect(() => {
    const groups = taskGroups()
    if (groups.length === 0) {
      setSelectedTaskStudent("")
      return
    }
    const activeStudent = task()?.input.studentName.trim()
    if (activeStudent && groups.some((group) => group.student === activeStudent)) {
      setSelectedTaskStudent(activeStudent)
      return
    }
    if (!groups.some((group) => group.student === selectedTaskStudent())) {
      setSelectedTaskStudent(groups[0].student)
    }
  })

  createEffect(() => {
    const applicationUrl = input().applicationUrl || ""
    if (!applicationUrl.trim() || !URL.canParse(applicationUrl)) return
    const timer = window.setTimeout(() => {
      void loadPlatformAccount(applicationUrl)
    }, 350)
    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(() => {
    const session = opencodeSession()
    if (!session) return
    void refreshAgentMessages(session)
    const timer = window.setInterval(() => {
      void refreshAgentMessages(session)
    }, 2500)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <div class="application-agent-shell">
      <Show when={needsLogin()}>
        <main class="terra-auth-gate">
          <section class="terra-auth-panel">
            <p class="application-agent-kicker">Terra-Edu 顾问登录</p>
            <h1>申请 Agent</h1>
            <p>
              使用 Terra-Edu 顾问账号登录后即可调用 AI。每个顾问默认有 200 AI credits，额度用完请联系微信 shilaidong。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void loginAdvisor()
              }}
            >
              <label>
                顾问邮箱
                <input
                  type="email"
                  value={loginEmail()}
                  onInput={(event) => setLoginEmail(event.currentTarget.value)}
                  placeholder="consultant@terra.edu"
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  value={loginPassword()}
                  onInput={(event) => setLoginPassword(event.currentTarget.value)}
                  placeholder="请输入密码"
                />
              </label>
              <button type="submit" disabled={busy() || !loginEmail().trim() || !loginPassword()}>
                {busy() ? "登录中..." : "登录并使用 AI"}
              </button>
            </form>
            <Show when={error()}>{(message) => <p class="application-agent-error">{message()}</p>}</Show>
            <small>客户无需配置 Supabase 或 API key；账号和额度由 Terra-Edu 统一管理。</small>
          </section>
        </main>
      </Show>
      <Show when={showOpenCode()}>
        <main class="application-agent-opencode-view">
          <header class="application-agent-topbar">
            <div>
              <p>Terra-Edu 申请 Agent</p>
              <strong>OpenCode 对话工作区</strong>
            </div>
            <div class="topbar-actions">
              <Show when={task()}>
                {(currentTask) => (
                  <button type="button" onClick={() => window.api.openPath(currentTask().workspacePath)}>
                    打开申请工作区
                  </button>
                )}
              </Show>
              <button type="button" onClick={() => setShowOpenCode(false)}>
                返回任务工作台
              </button>
            </div>
          </header>
          <section class="application-agent-opencode-full">{props.opencodeWorkspace(opencodeSession())}</section>
        </main>
      </Show>
      <Show
        when={!showOpenCode() && task()}
        fallback={
          <Show
            when={!showOpenCode()}
            fallback={null}
          >
            <main class="application-agent-start">
            <section class="application-agent-hero">
              <div>
                <p class="application-agent-kicker">Terra-Edu 子程序</p>
                <h1>申请 Agent</h1>
                <p>
                  顾问只填写基础申请信息。之后 OpenCode Agent 会接管：创建隔离工作区、整理材料、生成学生档案、识别缺失项，并准备进入申请平台填写。
                </p>
              </div>
              <div class="home-mode-actions">
                <button
                  type="button"
                  classList={{ active: homeMode() === "new" }}
                  onClick={() => setHomeMode("new")}
                >
                  新建申请
                </button>
                <button
                  type="button"
                  classList={{ active: homeMode() === "read" }}
                  onClick={() => {
                    setHomeMode("read")
                    void loadApplicationTasks()
                  }}
                >
                  读取已有申请
                </button>
              </div>
              <div class="application-agent-status-card">
                <span>OpenCode Go / DeepSeek V4 Flash</span>
                <strong>{goConfigured() ? "GO 订阅 API 已内置" : "需要配置 GO API"}</strong>
                <small>{props.providerReady ? "本地 OpenCode 服务已就绪。" : "首页可用，OpenCode 服务正在后台启动。"}</small>
                <div class="quota-card-line">
                  <span>AI 额度</span>
                  <strong>{quotaText()}</strong>
                </div>
                <Show when={authStatus()?.user}>
                  {(user) => (
                    <div class="quota-user-line">
                      <small>{user().email}</small>
                      <button type="button" disabled={busy()} onClick={logoutAdvisor}>退出登录</button>
                    </div>
                  )}
                </Show>
                <Show
                  when={!goConfigured()}
                  fallback={<small>模型凭据已随本机程序配置，顾问可直接创建申请任务。</small>}
                >
                  <div class="go-key-row">
                    <input
                      type="password"
                      value={goKey()}
                      onInput={(event) => setGoKey(event.currentTarget.value)}
                      placeholder="粘贴 OpenCode Go API key"
                    />
                    <button type="button" disabled={busy() || !goKey().trim()} onClick={saveGoKey}>保存</button>
                  </div>
                  <small>备用配置会保存到本机安全存储；保存后请重启应用让 sidecar 读取。</small>
                </Show>
              </div>
            </section>

            <Show
              when={homeMode() === "new"}
              fallback={
                <section class="application-agent-form application-agent-history">
                  <header>
                    <div>
                      <h2>读取已有申请</h2>
                      <p>选择一个历史申请后，会回到对应工作台和 OpenCode 会话，继续使用已有工作区与进度文件。</p>
                    </div>
                    <button type="button" disabled={busy()} onClick={loadApplicationTasks}>刷新</button>
                  </header>
                  {renderTaskList()}
                  <Show when={error()}>{(message) => <p class="application-agent-error">{message()}</p>}</Show>
                </section>
              }
            >
            <section class="application-agent-form">
              <div class="creation-mode-picker" role="group" aria-label="创建申请任务方式">
                <button
                  type="button"
                  classList={{ active: creationMode() === "manual" }}
                  onClick={() => setCreationMode("manual")}
                >
                  <strong>单个学校</strong>
                  <span>手动填写一所学校和项目</span>
                </button>
                <button
                  type="button"
                  classList={{ active: creationMode() === "selection-list" }}
                  onClick={() => setCreationMode("selection-list")}
                >
                  <strong>导入选校清单</strong>
                  <span>从 Excel 批量创建学校任务</span>
                </button>
              </div>
              <div class="field-grid">
                <label>
                  学生姓名
                  <input value={input().studentName} onInput={(event) => update("studentName", event.currentTarget.value)} />
                </label>
                <label>
                  学生资料文件夹
                  <div class="folder-picker-row">
                    <input value={input().sourceFolder} readonly placeholder="选择本地学生资料文件夹" />
                    <button type="button" onClick={pickFolder}>选择</button>
                  </div>
                </label>
                <label>
                  申请类型
                  <select
                    value={input().applicationType}
                    onChange={(event) => update("applicationType", event.currentTarget.value)}
                  >
                    <For each={applicationTypes}>{(item) => <option value={item}>{item}</option>}</For>
                  </select>
                </label>
                <label>
                  本次任务目标
                  <select value={input().taskGoal} onChange={(event) => update("taskGoal", event.currentTarget.value)}>
                    <For each={taskGoals}>{(item) => <option value={item}>{item}</option>}</For>
                  </select>
                </label>
                <label>
                  输出语言
                  <select
                    value={input().outputLanguage}
                    onChange={(event) => update("outputLanguage", event.currentTarget.value as "zh" | "en")}
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
              <Show
                when={creationMode() === "manual"}
                fallback={
                  <section class="selection-list-import">
                    <header>
                      <div>
                        <h2>选校清单导入</h2>
                        <p>一个学校/项目创建一个申请任务。学生原始材料会先统一暂存一次，再按学校依次处理。</p>
                      </div>
                      <button type="button" disabled={busy()} onClick={downloadSelectionListTemplate}>下载无密码模板</button>
                    </header>
                    <div class="folder-picker-row">
                      <input value={selectionListPath()} readonly placeholder="选择已填写的 .xlsx 选校清单" />
                      <button type="button" disabled={busy()} onClick={pickSelectionList}>选择 Excel</button>
                    </div>
                    <Show when={selectionListPreview()}>
                      {(preview) => (
                        <div class="selection-list-preview">
                          <p>已读取 {preview().sourceName}：勾选要创建的学校项目；没有申请链接的行会先由 Agent 核验。</p>
                          <For each={preview().rows}>
                            {(row) => {
                              const selectable = row.status === "ready" || row.status === "needs_research"
                              return (
                                <label classList={{ "selection-list-row": true, invalid: !selectable }}>
                                  <input
                                    type="checkbox"
                                    disabled={!selectable}
                                    checked={selectedSelectionRows().includes(row.rowNumber)}
                                    onChange={(event) => toggleSelectionRow(row.rowNumber, event.currentTarget.checked)}
                                  />
                                  <span>第 {row.rowNumber} 行</span>
                                  <strong>{row.school || "未填学校"} · {row.program || "未填项目"}</strong>
                                  <small>{row.warnings.join("；") || (row.status === "ready" ? "信息齐全" : "待核验链接")}</small>
                                </label>
                              )
                            }}
                          </For>
                          <For each={preview().warnings}>{(warning) => <p class="application-agent-error">{warning}</p>}</For>
                        </div>
                      )}
                    </Show>
                  </section>
                }
              >
                <div class="field-grid">
                  <label>
                    申请学校
                    <input value={input().school} onInput={(event) => update("school", event.currentTarget.value)} />
                  </label>
                  <label>
                    申请项目 / 专业
                    <input value={input().program} onInput={(event) => update("program", event.currentTarget.value)} />
                  </label>
                  <label>
                    申请平台链接
                    <input
                      value={input().applicationUrl || ""}
                      onInput={(event) => update("applicationUrl", event.currentTarget.value)}
                      onBlur={() => void loadPlatformAccount()}
                      placeholder="https://..."
                    />
                  </label>
                  <label>
                    申请平台账号
                    <input
                      value={input().platformUsername || ""}
                      onInput={(event) => update("platformUsername", event.currentTarget.value)}
                      placeholder="申请系统登录邮箱/账号"
                    />
                  </label>
                  <div class="credential-card wide">
                    <Show
                      when={savedPlatformAccount()}
                      fallback={<small>只保存申请平台账号；密码不收集、不保存，登录时由顾问在平台页面手动输入。</small>}
                    >
                      {(saved) => (
                        <div class="credential-status">
                          <span>{saved().username}</span>
                          <strong>已保存账号</strong>
                          <button type="button" disabled={busy()} onClick={clearPlatformAccount}>清除</button>
                        </div>
                      )}
                    </Show>
                  </div>
                  <label>
                    申请截止日期
                    <input type="date" value={input().deadline || ""} onInput={(event) => update("deadline", event.currentTarget.value)} />
                  </label>
                  <label class="wide">
                    顾问备注
                    <textarea value={input().notes || ""} onInput={(event) => update("notes", event.currentTarget.value)} />
                  </label>
                </div>
              </Show>
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={input().allowUpload}
                  onChange={(event) => update("allowUpload", event.currentTarget.checked)}
                />
                允许 Agent 尝试上传可确认匹配的材料
              </label>
              <Show when={error()}>{(message) => <p class="application-agent-error">{message()}</p>}</Show>
              <button
                class="primary-action"
                type="button"
                disabled={busy() || (creationMode() === "selection-list" && selectedSelectionRows().length === 0)}
                onClick={creationMode() === "manual" ? createTask : createTasksFromSelectionList}
              >
                {busy() ? "正在交给 OpenCode Agent..." : creationMode() === "manual" ? "开始申请任务" : `创建 ${selectedSelectionRows().length} 个申请任务`}
              </button>
            </section>
            </Show>
            </main>
          </Show>
        }
      >
        {(currentTask) => (
            <main class="application-agent-workspace">
            <aside class="application-agent-sidebar">
              <div class="brand-block">
                <p>Terra-Edu</p>
                <h1>申请 Agent</h1>
                <button type="button" class="new-task-button" onClick={resetToHome}>新建申请任务</button>
              </div>
              <section class="side-section">
                <h2>当前任务</h2>
                <dl>
                  <dt>学生</dt>
                  <dd>{currentTask().input.studentName}</dd>
                  <dt>学校</dt>
                  <dd>{currentTask().input.school}</dd>
                  <dt>项目</dt>
                  <dd>{currentTask().input.program}</dd>
                  <dt>状态</dt>
                  <dd><span class="status-pill">{currentTask().status}</span></dd>
                </dl>
	              </section>
              <section class="side-section task-switcher">
	                <h2>申请列表</h2>
                    {renderTaskList()}
	              </section>
              <Show when={currentTask().input.batchId}>
                <section class="side-section">
                  <h2>批次处理</h2>
                  <p>当前为第 {currentTask().input.batchOrder || "?"} 所学校。完成本校后再进入下一所，OCR 会复用批次结果。</p>
                  <button type="button" disabled={busy()} onClick={switchToNextBatchTask}>进入下一所学校</button>
                </section>
              </Show>
              <section class="side-section">
                <h2>缺失统计</h2>
                <div class="stat-grid">
                  <span><strong>{taskCounts(currentTask()).totalFiles}</strong>材料</span>
                  <span><strong>{taskCounts(currentTask()).missingMaterials}</strong>缺材料</span>
                  <span><strong>{taskCounts(currentTask()).missingInformation}</strong>缺信息</span>
                  <span><strong>{taskCounts(currentTask()).uncertainItems}</strong>待确认</span>
                </div>
              </section>
              <section class="side-section">
                <h2>AI 额度</h2>
                <div class="quota-side">
                  <strong>{quotaText()}</strong>
                  <small>按 token 折算为 credits。额度用完请联系微信 shilaidong。</small>
                </div>
              </section>
              <section class="side-section">
                <h2>快捷操作</h2>
                <div class="quick-actions">
                  <For each={quickCommands}>{(command) => <button type="button" disabled={busy()} onClick={() => runCommand(command)}>{command}</button>}</For>
                  <button type="button" class="danger-outline" onClick={stopAutomation}>停止自动化 / 释放控制</button>
                  <button type="button" class="danger-outline" onClick={blockSubmit}>测试高风险拦截</button>
                </div>
              </section>
            </aside>

              <section class="application-agent-main">
              <Show when={restoreNotice()}>
                {(notice) => <div class="restore-notice">{notice()}</div>}
              </Show>
              <div class="progress-strip">
                <For each={taskProgress(currentTask()).slice(-12)}>
                  {(entry) => (
                    <article>
                      <span>{new Date(entry.at).toLocaleTimeString()}</span>
                      <strong>{entry.status}</strong>
                      <p>{entry.message}</p>
                    </article>
                  )}
                </For>
              </div>

              <div class="opencode-frame">
                <header>
                  <div class="agent-title-lockup">
                    <img src={applicationAgentAvatar} alt="" aria-hidden="true" />
                    <div>
                      <p>AI 对话工作区</p>
                      <h2>OpenCode Agent</h2>
                    </div>
                  </div>
                  <div class="workspace-actions">
                    <button type="button" class="danger-outline" onClick={stopAutomation}>停止自动化</button>
                    <button type="button" disabled={busy() || !opencodeSession()} onClick={resendStartPrompt}>重新发送启动指令</button>
                    <button type="button" disabled={busy()} onClick={rebuildOpenCodeSession}>重建 OpenCode 会话</button>
                    <button type="button" onClick={() => setShowOpenCode(true)}>进入 OpenCode 对话</button>
                    <button type="button" onClick={() => window.api.openPath(currentTask().workspacePath)}>打开申请工作区</button>
                  </div>
                </header>
                <div class="opencode-placeholder">
                  <div class="agent-chat">
                    <div class="agent-chat-list" ref={agentChatListRef}>
                      <Show
                        when={agentMessages().length > 0}
                        fallback={
                          <article class="agent-message system">
                            <div class="agent-message-header">
                              <strong>OpenCode Agent 正在启动</strong>
                              <time>实时刷新</time>
                            </div>
                            <p>任务已经交给 OpenCode。这里会显示 Agent 回复、工具调用、生成文件和需要顾问处理的问题。</p>
                          </article>
                        }
                      >
                        <For each={groupAgentMessages(agentMessages())}>
                          {(item) =>
                            item.kind === "technical-group" ? (
                              <AgentTechnicalGroup messages={item.messages} />
                            ) : (
                              <AgentMessageCard message={item.message} onReply={replyToAgentQuestion} />
                            )
                          }
                        </For>
                      </Show>
                    </div>
                    <div class="agent-chat-input">
                      <textarea
                        value={agentInput()}
                        onInput={(event) => setAgentInput(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault()
                            void sendAgentMessage()
                          }
                        }}
                        placeholder="直接给 OpenCode Agent 发送申请指令，例如：继续整理材料、生成总结、重新检查缺失项..."
                      />
                      <button type="button" disabled={busy() || !agentInput().trim()} onClick={sendAgentMessage}>
                        发送给 Agent
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <aside class="application-agent-results">
              <section>
                <h2>生成结果</h2>
                <For each={taskGeneratedFiles(currentTask())}>
                  {(file) => (
                    <button type="button" onClick={() => window.api.openPath(file.path)}>
                      <span>{file.label}</span>
                      <small>{file.kind}</small>
                    </button>
                  )}
                </For>
              </section>
              <Show when={error()}>{(message) => <p class="application-agent-error">{message()}</p>}</Show>
              <section>
                <h2>安全边界</h2>
                <ul>
                  <li>可以填写、上传、保存</li>
                  <li>不能最终提交申请</li>
                  <li>不能付款</li>
                  <li>不能自动发送不可逆推荐信邀请</li>
                  <li>不能保存账号密码</li>
                </ul>
              </section>
            </aside>
          </main>
        )}
      </Show>
    </div>
  )
}

let menuTrigger = null as null | ((id: string) => void)
window.api.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()

render(() => {
  const platform = createPlatform()
  const [windowConfig] = createResource(() => window.api.getWindowConfig().catch(() => ({ updaterEnabled: false })))
  const loadLocale = async () => {
    const current = await platform.storage?.("opencode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [windowCount] = createResource(() => window.api.getWindowCount())

  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(() => window.api.awaitInitialization(() => undefined))

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)

  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "Local Server",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void window.api.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show
          when={
            !windowConfig.loading &&
            !windowCount.loading
          }
        >
          {(_) => {
            const opencodeWorkspace = (session: ApplicationAgentSession | null) => (
              <Show
                when={sidecar()}
                fallback={
                  <div class="application-agent-opencode-pending">
                    <h2>OpenCode 服务正在启动</h2>
                    <p>申请任务首页和工作台可以正常使用。服务就绪后，这里会自动切换为完整对话工作区。</p>
                  </div>
                }
              >
                <AppInterface
                  defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                  servers={servers()}
                  router={MemoryRouter}
                >
                  <OpenCodeSessionNavigator session={session} />
                  <Inner />
                </AppInterface>
              </Show>
            )
            return (
              <ApplicationAgentShell opencodeWorkspace={opencodeWorkspace} providerReady={Boolean(sidecar.latest)} />
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
