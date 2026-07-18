import { execFile } from "node:child_process"
import { copyFile } from "node:fs/promises"
import { join } from "node:path"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"

import type {
  ApplicationAgentChatItem,
  ApplicationAgentRefillRequest,
  ApplicationAgentRefillSession,
  ApplicationAgentSession,
  ApplicationMaterialReviewInput,
  ApplicationSelectionListInput,
  ApplicationTask,
  ApplicationTaskInput,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "../preload/types"
import {
  blockHighRiskAction,
  continueApplicationTask,
  createApplicationTask,
  createApplicationTasksFromSelectionList,
  getApplicationTask,
  listApplicationTasks,
  pauseApplicationTask,
  resumeApplicationTask,
  submitApplicationMaterialReview,
} from "./application-agent"
import { previewSelectionList } from "./application-selection-list"
import {
  clearApplicationPlatformAccount,
  getApplicationPlatformAccount,
  saveApplicationPlatformAccount,
} from "./application-accounts"
import { hasOpenCodeGoApiKey } from "./opencode-go"
import { getStore } from "./store"
import { getTerraAuthStatus, loginTerraAdvisor, logoutTerraAdvisor } from "./terra-auth"
import { setTitlebar, updateTitlebar } from "./windows"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

function selectionListTemplatePath() {
  return join(app.getAppPath(), "resources", "templates", "terra-edu-selection-list-template.xlsx")
}

type Deps = {
  killSidecar: () => Promise<void> | void
  awaitInitialization: (sendStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig> | WindowConfig
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void> | void
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  startApplicationAgentSession: (task: ApplicationTask) => Promise<ApplicationAgentSession>
  startApplicationAgentRefillSession: (
    input: ApplicationAgentRefillRequest,
  ) => Promise<ApplicationAgentRefillSession>
  resendApplicationAgentStartPrompt: (session: ApplicationAgentSession, task: ApplicationTask) => Promise<void>
  sendApplicationAgentPrompt: (session: ApplicationAgentSession, prompt: string) => Promise<void>
  getApplicationAgentMessages: (session: ApplicationAgentSession) => Promise<ApplicationAgentChatItem[]>
  findApplicationAgentSession: (workspacePath: string) => Promise<ApplicationAgentSession | null>
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", (event: IpcMainInvokeEvent) => {
    const send = (step: InitStep) => event.sender.send("init-step", step)
    return deps.awaitInitialization(send)
  })
  ipcMain.handle("get-window-config", () => deps.getWindowConfig())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("get-wsl-config", () => deps.getWslConfig())
  ipcMain.handle("set-wsl-config", (_event: IpcMainInvokeEvent, config: WslConfig) => deps.setWslConfig(config))
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("parse-markdown", (_event: IpcMainInvokeEvent, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("wsl-path", (_event: IpcMainInvokeEvent, path: string, mode: "windows" | "linux" | null) =>
    deps.wslPath(path, mode),
  )
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.on("loading-window-complete", () => deps.loadingWindowComplete())
  ipcMain.handle("run-updater", (_event: IpcMainInvokeEvent, alertOnFail: boolean) => deps.runUpdater(alertOnFail))
  ipcMain.handle("check-update", () => deps.checkUpdate())
  ipcMain.handle("install-update", () => deps.installUpdate())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      _event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; accept?: string[]; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? "Choose a file",
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  ipcMain.on("open-link", (_event: IpcMainEvent, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  const showNotification = (title: string, body?: string, urgent = false) => {
    if (urgent && process.platform === "darwin") app.dock?.bounce("critical")
    if (!Notification.isSupported()) return
    new Notification({ title, body }).show()
  }

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    showNotification(title, body)
  })

  ipcMain.on("show-urgent-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    showNotification(title, body, true)
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  ipcMain.handle("application-agent:create-task", (_event: IpcMainInvokeEvent, input: ApplicationTaskInput) =>
    createApplicationTask(input),
  )
  ipcMain.handle("application-agent:preview-selection-list", (_event: IpcMainInvokeEvent, sourcePath: string) =>
    previewSelectionList(sourcePath),
  )
  ipcMain.handle(
    "application-agent:create-selection-list-tasks",
    (_event: IpcMainInvokeEvent, input: ApplicationSelectionListInput) => createApplicationTasksFromSelectionList(input),
  )
  ipcMain.handle("application-agent:download-selection-list-template", async () => {
    const destination = await dialog.showSaveDialog({
      title: "下载选校清单模板",
      defaultPath: join(app.getPath("downloads"), "Terra-Edu-选校清单模板.xlsx"),
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    })
    if (destination.canceled || !destination.filePath) return null
    await copyFile(selectionListTemplatePath(), destination.filePath)
    return destination.filePath
  })
  ipcMain.handle("application-agent:start-session", (_event: IpcMainInvokeEvent, task: ApplicationTask) =>
    deps.startApplicationAgentSession(task),
  )
  ipcMain.handle(
    "application-agent:start-refill-session",
    (_event: IpcMainInvokeEvent, input: ApplicationAgentRefillRequest) =>
      deps.startApplicationAgentRefillSession(input),
  )
  ipcMain.handle(
    "application-agent:resend-start-prompt",
    (_event: IpcMainInvokeEvent, session: ApplicationAgentSession, task: ApplicationTask) =>
      deps.resendApplicationAgentStartPrompt(session, task),
  )
  ipcMain.handle(
    "application-agent:send-prompt",
    (_event: IpcMainInvokeEvent, session: ApplicationAgentSession, prompt: string) =>
      deps.sendApplicationAgentPrompt(session, prompt),
  )
  ipcMain.handle("application-agent:get-messages", (_event: IpcMainInvokeEvent, session: ApplicationAgentSession) =>
    deps.getApplicationAgentMessages(session),
  )
  ipcMain.handle("application-agent:get-task", (_event: IpcMainInvokeEvent, workspacePath: string) =>
    getApplicationTask(workspacePath),
  )
  ipcMain.handle("application-agent:list-tasks", (_event: IpcMainInvokeEvent, limit?: number) =>
    listApplicationTasks(limit),
  )
  ipcMain.handle("application-agent:find-session", (_event: IpcMainInvokeEvent, workspacePath: string) =>
    deps.findApplicationAgentSession(workspacePath),
  )
  ipcMain.handle("application-agent:continue-task", (_event: IpcMainInvokeEvent, workspacePath: string) =>
    continueApplicationTask(workspacePath),
  )
  ipcMain.handle("application-agent:pause-task", (_event: IpcMainInvokeEvent, workspacePath: string) =>
    pauseApplicationTask(workspacePath),
  )
  ipcMain.handle("application-agent:resume-task", (_event: IpcMainInvokeEvent, workspacePath: string) =>
    resumeApplicationTask(workspacePath),
  )
  ipcMain.handle(
    "application-agent:submit-material-review",
    (_event: IpcMainInvokeEvent, workspacePath: string, input: ApplicationMaterialReviewInput) =>
      submitApplicationMaterialReview(workspacePath, input),
  )
  ipcMain.handle(
    "application-agent:block-high-risk-action",
    (_event: IpcMainInvokeEvent, workspacePath: string, action: string) => blockHighRiskAction(workspacePath, action),
  )
  ipcMain.handle("application-agent:get-platform-account", (_event: IpcMainInvokeEvent, applicationUrl: string) =>
    getApplicationPlatformAccount(applicationUrl),
  )
  ipcMain.handle(
    "application-agent:save-platform-account",
    (_event: IpcMainInvokeEvent, input: { applicationUrl: string; username: string }) => saveApplicationPlatformAccount(input),
  )
  ipcMain.handle("application-agent:clear-platform-account", (_event: IpcMainInvokeEvent, applicationUrl: string) =>
    clearApplicationPlatformAccount(applicationUrl),
  )
  ipcMain.handle("application-agent:has-go-api-key", () => hasOpenCodeGoApiKey())
  ipcMain.handle("terra-auth:status", () => getTerraAuthStatus())
  ipcMain.handle("terra-auth:login", (_event: IpcMainInvokeEvent, email: string, password: string) =>
    loginTerraAdvisor(email, password),
  )
  ipcMain.handle("terra-auth:logout", async () => {
    logoutTerraAdvisor()
    return getTerraAuthStatus()
  })
}

export function sendSqliteMigrationProgress(win: BrowserWindow, progress: SqliteMigrationProgress) {
  win.webContents.send("sqlite-migration-progress", progress)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
