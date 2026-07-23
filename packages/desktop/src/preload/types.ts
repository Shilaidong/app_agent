export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress =
  | { type: "Stage"; stage: "copying_legacy_data" | "migrating_data" | "starting_server" }
  | { type: "InProgress"; value: number }
  | { type: "Done" }

export type WslConfig = { enabled: boolean }

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type WindowConfig = {
  updaterEnabled: boolean
}

export type ApplicationTaskInput = {
  studentName: string
  sourceFolder: string
  school: string
  program: string
  applicationType: string
  applicationUrl?: string
  deadline?: string
  notes?: string
  loginMethod?: string
  platformUsername?: string
  batchId?: string
  batchWorkspacePath?: string
  sharedWorkspacePath?: string
  batchOrder?: number
  selectionListPath?: string
  selectionListRow?: number
  outputLanguage?: "zh" | "en"
  allowUpload?: boolean
  taskGoal?: string
}

export type ApplicationPlatformAccount = {
  key: string
  username: string
  platformHost: string
  updatedAt: string
}

export type ApplicationSelectionListRow = {
  rowNumber: number
  school: string
  program: string
  programUrl?: string
  deadline?: string
  applicationUrl?: string
  platformUsername?: string
  notes?: string
  status: "ready" | "needs_research" | "invalid" | "duplicate"
  warnings: string[]
}

export type ApplicationSelectionListPreview = {
  sourcePath: string
  sourceName: string
  rows: ApplicationSelectionListRow[]
  warnings: string[]
}

export type ApplicationSelectionListInput = {
  studentName: string
  sourceFolder: string
  applicationType: string
  selectionListPath: string
  selectedRows: number[]
  outputLanguage?: "zh" | "en"
  allowUpload?: boolean
  taskGoal?: string
}

export type ApplicationSelectionListBatch = {
  id: string
  workspacePath: string
  sourceFolder: string
  selectionListPath: string
  createdAt: string
  tasks: ApplicationTask[]
}

export type ApplicationTaskStatus =
  | "已创建"
  | "已暂停"
  | "正在复制原始材料"
  | "正在创建申请工作区"
  | "正在读取文件"
  | "正在整理材料"
  | "正在生成学生资料"
  | "正在检查缺失内容"
  | "等待顾问登录"
  | "等待顾问接管浏览器"
  | "正在填写申请平台"
  | "正在保存申请进度"
  | "正在上传材料"
  | "等待补充材料"
  | "等待顾问确认材料"
  | "可继续申请"
  | "阶段性完成"
  | "异常中断"

export type BrowserSafetyStopSummary = {
  kind: "cleanup_failed" | "alert_evidence_lost"
  taskSpaceId: string
  active: boolean
  decisionId: string
  recordedAt: string
  observationRequired?: boolean
  resolution?: string
  resumeAuthorizedAt?: string
}

export type ApplicationOcrProgress = {
  phase: "running" | "done"
  current: number
  total: number
  startedAt: string
  avgSeconds: number
  etaAt: string
  finishedAt?: string
}

export type ApplicationTask = {
  id: string
  slug: string
  workspacePath: string
  sessionDirectory: string
  createdAt: string
  updatedAt: string
  status: ApplicationTaskStatus
  input: ApplicationTaskInput
  counts: {
    totalFiles: number
    missingInformation: number
    missingMaterials: number
    uncertainItems: number
  }
  generatedFiles: Array<{
    label: string
    path: string
    kind: "markdown" | "docx" | "json" | "log" | "folder"
  }>
  progress: Array<{
    at: string
    status: ApplicationTaskStatus
    message: string
  }>
  reusedExisting?: boolean
  sharedDossierStatus?: "preparing" | "prepared" | "ready"
  browserSafetyStop?: BrowserSafetyStopSummary
  ocr?: ApplicationOcrProgress
  materialReviewTampered?: boolean
  materialReviewTamperMessage?: string
  browserHandoffPending?: boolean
  browserHandoffType?: string
  materialReview?: {
    status?: string
    mode?: string
    note?: string
    summary?: string
    submittedAt?: string
    preparationCompleteAt?: string
    reviewId?: string
  }
  materialReviewNeedsConsultant?: boolean
}

export type ApplicationMaterialReviewInput = {
  mode: "supplement_folder" | "skip" | "note"
  sourceFolder?: string
  note?: string
  scope?: "school" | "student"
}

export type ApplicationAgentSession = {
  sessionID: string
  directory: string
  workspacePath: string
  modelID: string
  providerID?: string
}

export type ApplicationAgentRefillRequest = {
  task: ApplicationTask
  requestID: string
  sourceSessionID?: string
  modelId?: string
}

export type ApplicationRefillAttempt = {
  id: string
  requestID: string
  workspacePath: string
  ordinal: number
  createdAt: string
  status: "prepared" | "session_created"
  sourceSessionID?: string
  sessionID?: string
  promptSentAt?: string
  taskSpaceName: string
  progressArchivePath: string
  reusedArtifacts: string[]
  batchId?: string
  batchOrder?: number
}

export type ApplicationAgentRefillSession = {
  session: ApplicationAgentSession
  attempt: ApplicationRefillAttempt
}

export type ApplicationAgentChatItem = {
  id: string
  role: "user" | "assistant" | "tool" | "system"
  title: string
  body: string
  status?: "pending" | "running" | "completed" | "error"
  time?: number
  question?: {
    questions: {
      header: string
      question: string
      multiple?: boolean
      options?: { label: string; description?: string }[]
    }[]
  }
}

export type TerraAuthStatus = {
  configured: boolean
  authenticated: boolean
  localDevelopment: boolean
  user: {
    id: string
    email: string
  } | null
  quota: {
    creditsTotal: number
    creditsUsed: number
    creditsRemaining: number
    weightedTokensUsed: number
    status: string
    contactWechat: string
  } | null
  contactWechat: string
  message?: string
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig>
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    accept?: string[]
    extensions?: string[]
  }) => Promise<string | string[] | null>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  showUrgentNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  createApplicationTask: (input: ApplicationTaskInput) => Promise<ApplicationTask>
  previewApplicationSelectionList: (sourcePath: string) => Promise<ApplicationSelectionListPreview>
  createApplicationTasksFromSelectionList: (input: ApplicationSelectionListInput) => Promise<ApplicationSelectionListBatch>
  downloadApplicationSelectionListTemplate: () => Promise<string | null>
  startApplicationAgentSession: (task: ApplicationTask, modelId?: string) => Promise<ApplicationAgentSession>
  openApplicationAgentSession: (task: ApplicationTask, modelId?: string) => Promise<ApplicationAgentSession>
  getApplicationAgentModels: () => Promise<
    readonly { id: string; modelID?: string; providerID?: string; subscription?: string; label: string; description: string }[]
  >
  startApplicationAgentRefillSession: (
    input: ApplicationAgentRefillRequest,
  ) => Promise<ApplicationAgentRefillSession>
  resendApplicationAgentStartPrompt: (session: ApplicationAgentSession, task: ApplicationTask) => Promise<void>
  sendApplicationAgentPrompt: (session: ApplicationAgentSession, prompt: string) => Promise<void>
  getApplicationAgentMessages: (session: ApplicationAgentSession) => Promise<ApplicationAgentChatItem[]>
  getApplicationTask: (workspacePath: string) => Promise<ApplicationTask>
  listApplicationTasks: (limit?: number) => Promise<ApplicationTask[]>
  findApplicationAgentSession: (workspacePath: string, preferredModelId?: string) => Promise<ApplicationAgentSession | null>
  continueApplicationTask: (workspacePath: string) => Promise<ApplicationTask>
  pauseApplicationTask: (workspacePath: string) => Promise<ApplicationTask>
  resumeApplicationTask: (workspacePath: string) => Promise<ApplicationTask>
  authorizeBrowserSafetyContinue: (
    workspacePath: string,
    input: { decisionId: string; taskSpaceId: string },
  ) => Promise<ApplicationTask>
  submitApplicationMaterialReview: (workspacePath: string, input: ApplicationMaterialReviewInput) => Promise<ApplicationTask>
  repairApplicationSharedDossier: (workspacePath: string) => Promise<{
    status: "prepared" | "ready"
    sharedWorkspacePath: string
    version: number
  }>
  blockHighRiskAction: (workspacePath: string, action: string) => Promise<ApplicationTask>
  getApplicationPlatformAccount: (applicationUrl: string) => Promise<ApplicationPlatformAccount | null>
  saveApplicationPlatformAccount: (input: {
    applicationUrl: string
    username: string
  }) => Promise<ApplicationPlatformAccount | null>
  clearApplicationPlatformAccount: (applicationUrl: string) => Promise<void>
  hasOpenCodeGoApiKey: () => Promise<boolean>
  getTerraAuthStatus: () => Promise<TerraAuthStatus>
  loginTerraAdvisor: (email: string, password: string) => Promise<TerraAuthStatus>
  logoutTerraAdvisor: () => Promise<TerraAuthStatus>
}
