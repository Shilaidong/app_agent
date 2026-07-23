import { contextBridge, ipcRenderer } from "electron"
import type { ElectronAPI, InitStep, SqliteMigrationProgress } from "./types"

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: (onStep) => {
    const handler = (_: unknown, step: InitStep) => onStep(step)
    ipcRenderer.on("init-step", handler)
    return ipcRenderer.invoke("await-initialization").finally(() => {
      ipcRenderer.removeListener("init-step", handler)
    })
  },
  getWindowConfig: () => ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_: unknown, progress: SqliteMigrationProgress) => cb(progress)
    ipcRenderer.on("sqlite-migration-progress", handler)
    return () => ipcRenderer.removeListener("sqlite-migration-progress", handler)
  },
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  showUrgentNotification: (title, body) => ipcRenderer.send("show-urgent-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  createApplicationTask: (input) => ipcRenderer.invoke("application-agent:create-task", input),
  previewApplicationSelectionList: (sourcePath) => ipcRenderer.invoke("application-agent:preview-selection-list", sourcePath),
  createApplicationTasksFromSelectionList: (input) =>
    ipcRenderer.invoke("application-agent:create-selection-list-tasks", input),
  downloadApplicationSelectionListTemplate: () =>
    ipcRenderer.invoke("application-agent:download-selection-list-template"),
  startApplicationAgentSession: (task, modelId) => ipcRenderer.invoke("application-agent:start-session", task, modelId),
  openApplicationAgentSession: (task, modelId) => ipcRenderer.invoke("application-agent:open-session", task, modelId),
  getApplicationAgentModels: () => ipcRenderer.invoke("application-agent:list-models"),
  startApplicationAgentRefillSession: (input) =>
    ipcRenderer.invoke("application-agent:start-refill-session", input),
  resendApplicationAgentStartPrompt: (session, task) =>
    ipcRenderer.invoke("application-agent:resend-start-prompt", session, task),
  sendApplicationAgentPrompt: (session, prompt) => ipcRenderer.invoke("application-agent:send-prompt", session, prompt),
  getApplicationAgentMessages: (session) => ipcRenderer.invoke("application-agent:get-messages", session),
  getApplicationTask: (workspacePath) => ipcRenderer.invoke("application-agent:get-task", workspacePath),
  listApplicationTasks: (limit) => ipcRenderer.invoke("application-agent:list-tasks", limit),
  findApplicationAgentSession: (workspacePath, preferredModelId) =>
    ipcRenderer.invoke("application-agent:find-session", workspacePath, preferredModelId),
  continueApplicationTask: (workspacePath) => ipcRenderer.invoke("application-agent:continue-task", workspacePath),
  pauseApplicationTask: (workspacePath) => ipcRenderer.invoke("application-agent:pause-task", workspacePath),
  resumeApplicationTask: (workspacePath) => ipcRenderer.invoke("application-agent:resume-task", workspacePath),
  authorizeBrowserSafetyContinue: (workspacePath, input) =>
    ipcRenderer.invoke("application-agent:authorize-browser-safety-continue", workspacePath, input),
  submitApplicationMaterialReview: (workspacePath, input) =>
    ipcRenderer.invoke("application-agent:submit-material-review", workspacePath, input),
  repairApplicationSharedDossier: (workspacePath) =>
    ipcRenderer.invoke("application-agent:repair-shared-dossier", workspacePath),
  blockHighRiskAction: (workspacePath, action) =>
    ipcRenderer.invoke("application-agent:block-high-risk-action", workspacePath, action),
  getApplicationPlatformAccount: (applicationUrl) => ipcRenderer.invoke("application-agent:get-platform-account", applicationUrl),
  saveApplicationPlatformAccount: (input) => ipcRenderer.invoke("application-agent:save-platform-account", input),
  clearApplicationPlatformAccount: (applicationUrl) => ipcRenderer.invoke("application-agent:clear-platform-account", applicationUrl),
  hasOpenCodeGoApiKey: () => ipcRenderer.invoke("application-agent:has-go-api-key"),
  getTerraAuthStatus: () => ipcRenderer.invoke("terra-auth:status"),
  loginTerraAdvisor: (email, password) => ipcRenderer.invoke("terra-auth:login", email, password),
  logoutTerraAdvisor: () => ipcRenderer.invoke("terra-auth:logout"),
}

contextBridge.exposeInMainWorld("api", api)
