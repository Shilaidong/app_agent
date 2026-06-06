export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

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
  applicationUrl: string
  deadline?: string
  notes?: string
  loginMethod?: string
  platformUsername?: string
  rememberPlatformPassword?: boolean
  outputLanguage?: "zh" | "en"
  allowUpload?: boolean
  taskGoal?: string
}

export type ApplicationPlatformCredentialSummary = {
  key: string
  username: string
  hasPassword: boolean
  updatedAt: string
}

export type ApplicationTaskStatus =
  | "已创建"
  | "正在复制原始材料"
  | "正在创建申请工作区"
  | "正在读取文件"
  | "正在整理材料"
  | "正在生成学生资料"
  | "正在检查缺失内容"
  | "等待顾问登录"
  | "正在填写申请平台"
  | "正在保存申请进度"
  | "正在上传材料"
  | "等待补充材料"
  | "可继续申请"
  | "阶段性完成"
  | "异常中断"

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
}

export type ApplicationAgentSession = {
  sessionID: string
  directory: string
  workspacePath: string
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
  startApplicationAgentSession: (task: ApplicationTask) => Promise<ApplicationAgentSession>
  sendApplicationAgentPrompt: (session: ApplicationAgentSession, prompt: string) => Promise<void>
  getApplicationAgentMessages: (session: ApplicationAgentSession) => Promise<ApplicationAgentChatItem[]>
  getApplicationTask: (workspacePath: string) => Promise<ApplicationTask>
  listApplicationTasks: (limit?: number) => Promise<ApplicationTask[]>
  findApplicationAgentSession: (workspacePath: string) => Promise<ApplicationAgentSession | null>
  continueApplicationTask: (workspacePath: string) => Promise<ApplicationTask>
  runApplicationCommand: (workspacePath: string, command: string) => Promise<ApplicationTask>
  openApplicationPlatform: (workspacePath: string) => Promise<ApplicationTask>
  blockHighRiskAction: (workspacePath: string, action: string) => Promise<ApplicationTask>
  stopApplicationAutomation: (workspacePath?: string) => Promise<{ stopped: string[] }>
  getApplicationPlatformCredential: (applicationUrl: string) => Promise<ApplicationPlatformCredentialSummary | null>
  saveApplicationPlatformCredential: (input: {
    applicationUrl: string
    username: string
    password?: string
    rememberPassword?: boolean
  }) => Promise<ApplicationPlatformCredentialSummary | null>
  clearApplicationPlatformCredential: (applicationUrl: string) => Promise<void>
  setOpenCodeGoApiKey: (key: string | null) => Promise<void>
  hasOpenCodeGoApiKey: () => Promise<boolean>
  getTerraAuthStatus: () => Promise<TerraAuthStatus>
  loginTerraAdvisor: (email: string, password: string) => Promise<TerraAuthStatus>
  logoutTerraAdvisor: () => Promise<TerraAuthStatus>
}
