import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative } from "node:path"
import { app, shell } from "electron"
import { writeOpenCodeConfig } from "./application-agent-opencode"
import { previewSelectionList, type SelectionListRow } from "./application-selection-list"

export { buildApplicationAgentStartPrompt } from "./application-agent-opencode"
export { APPLICATION_AGENT_MODEL, APPLICATION_AGENT_MODEL_ID } from "./application-agent-model"

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
  batchOrder?: number
  selectionListPath?: string
  selectionListRow?: number
  outputLanguage?: "zh" | "en"
  allowUpload?: boolean
  taskGoal?: string
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
  generatedFiles: GeneratedFile[]
  progress: ProgressEntry[]
  reusedExisting?: boolean
}

export type ApplicationMaterialReviewInput = {
  mode: "supplement_folder" | "skip" | "note"
  sourceFolder?: string
  note?: string
}

export type ApplicationAgentSession = {
  sessionID: string
  directory: string
  workspacePath: string
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

type GeneratedFile = {
  label: string
  path: string
  kind: "markdown" | "docx" | "json" | "log" | "folder"
}

type ProgressEntry = {
  at: string
  status: ApplicationTaskStatus
  message: string
}

type MaterialRecord = {
  originalPath: string
  backupPath: string
  classifiedPath: string
  fileName: string
  extension: string
  category: MaterialCategory
  confidence: "high" | "medium" | "needs_review"
  reason: string
}

type MissingItem = {
  id: string
  name: string
  type: "information" | "material" | "uncertain"
  status: "missing" | "needs_confirmation" | "resolved"
  source: "material_scan" | "application_target" | "cua" | "manual"
  page?: string
  whyNeeded: string
  prepareFrom: string
  formatRequirement: string
  blocksProgress: boolean
  addedToWordList: boolean
  priority?: string
  rawStatus?: string
  resolvedAt?: string
  resolvedReason?: string
}

type ApplicationProgress = {
  currentPage: string
  completedPages: string[]
  savedPages: Array<string | { at?: string; page?: string; url?: string; backend?: string; evidence?: string }>
  uploadedMaterials: string[]
  failedActions: Array<{ at: string; action: string; reason: string; page?: string }>
  highRiskBlocks: Array<{ at: string; action: string; reason: string }>
  todoPlan?: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>
  requirementsLastUpdatedAt?: string
  platformLastOpenedAt?: string
  platformLastOpenedUrl?: string
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
  | "正在填写申请平台"
  | "正在保存申请进度"
  | "正在上传材料"
  | "等待补充材料"
  | "等待顾问确认材料"
  | "可继续申请"
  | "阶段性完成"
  | "异常中断"

type MaterialCategory =
  | "identity"
  | "academic"
  | "language"
  | "essays"
  | "recommendation"
  | "financial"
  | "platform_related"
  | "other"
  | "needs_review"

const CATEGORY_DIRS: Record<MaterialCategory, string> = {
  identity: "identity",
  academic: "academic",
  language: "language",
  essays: "essays",
  recommendation: "recommendation",
  financial: "financial",
  platform_related: "platform_related",
  other: "other",
  needs_review: "needs_review",
}

const GENERATED: Array<[string, string, GeneratedFile["kind"]]> = [
  ["学生申请档案", "02_generated/student_profile.md", "markdown"],
  ["信息收集表", "02_generated/info_collection_form.md", "markdown"],
  ["材料收集表", "02_generated/material_collection_form.md", "markdown"],
  ["Word 缺失材料清单", "02_generated/missing_materials.docx", "docx"],
  ["任务总结", "02_generated/task_summary.md", "markdown"],
  ["任务状态", "03_state/task_state.json", "json"],
  ["缺失项记录", "03_state/missing_items.json", "json"],
  ["申请进度记录", "03_state/application_progress.json", "json"],
  ["申请要求记录", "03_state/application_requirements.json", "json"],
  ["申请要求摘要", "02_generated/application_requirements.md", "markdown"],
  ["材料确认记录", "03_state/material_review.json", "json"],
  ["任务暂停状态", "03_state/task_control.json", "json"],
  ["浏览器自动化控制状态", "03_state/cua_control.json", "json"],
  ["工具执行审计", "03_state/agent_execution_audit.json", "json"],
  ["Agent 日志", "04_logs/agent_log.md", "log"],
  ["浏览器自动化日志", "04_logs/cua_log.md", "log"],
]

const STATUS_MESSAGES: Record<ApplicationTaskStatus, string> = {
  已创建: "我已收到申请任务，接下来会把完整任务 Prompt 交给 OpenCode Agent 接管。",
  已暂停: "任务已由顾问暂停。当前文件处理完成后不会启动下一项操作；点击“继续任务”后才会恢复。",
  正在复制原始材料: "我正在复制学生原始材料，后续操作都会在副本中完成。",
  正在创建申请工作区: "我正在建立隔离申请工作区和标准目录。",
  正在读取文件: "我正在读取学生文件夹，并识别里面的申请材料。",
  正在整理材料: "我正在按用途整理材料，无法判断的文件会进入待确认分类。",
  正在生成学生资料: "我正在生成结构化学生申请档案。",
  正在检查缺失内容: "我正在检查缺失信息、缺失材料和需要确认的内容。",
  等待顾问登录: "我已打开申请平台。如果需要登录，请顾问先完成登录。",
  正在填写申请平台: "我正在通过 ego-browser 操作申请平台的普通字段。",
  正在保存申请进度: "我正在保存当前可以保存的申请页面。",
  正在上传材料: "我正在尝试上传可确认匹配的材料。",
  等待补充材料: "当前可处理内容已完成，剩余内容需要补充材料后继续。",
  等待顾问确认材料: "材料整理和总结已完成。请顾问确认是否补充材料或信息，再启动申请平台。",
  可继续申请: "我发现补充材料已准备好，可以继续申请。",
  阶段性完成: "本次申请任务已完成阶段性处理。",
  异常中断: "任务遇到无法自动处理的问题，需要顾问介入。",
}

export async function createApplicationTask(input: ApplicationTaskInput): Promise<ApplicationTask> {
  validateTaskInput(input)
  const sanitizedInput = sanitizeTaskInput(input)
  const existing = await findExistingApplicationTask(sanitizedInput)
  if (existing) return { ...existing, reusedExisting: true }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const slug = makeTaskSlug(sanitizedInput)
  const workspacePath = await uniqueWorkspacePath(slug)
  const sessionDirectory = workspacePath
  await createWorkspace(workspacePath)

  const task = buildTask({
    id,
    slug,
    workspacePath,
    sessionDirectory,
    createdAt,
    status: "已创建",
    input: sanitizedInput,
    materialCount: 0,
  })
  await writeJson(join(workspacePath, "03_state/task_input.json"), sanitizedInput)
  await writeJson(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  if (sanitizedInput.batchWorkspacePath) {
    await writeJson(join(workspacePath, "03_state/batch_context.json"), {
      batchId: sanitizedInput.batchId,
      batchWorkspacePath: sanitizedInput.batchWorkspacePath,
      batchOrder: sanitizedInput.batchOrder,
      selectionListPath: sanitizedInput.selectionListPath,
      selectionListRow: sanitizedInput.selectionListRow,
      sharedMaterialsPath: sanitizedInput.sourceFolder,
      note: "原始材料已在批次工作区统一暂存。该任务会按批次顺序复用同一份材料来源。",
    })
  }
  await persistTask(task)
  return task
}

export async function createApplicationTasksFromSelectionList(
  input: ApplicationSelectionListInput,
): Promise<ApplicationSelectionListBatch> {
  if (!input.studentName.trim()) throw new Error("学生姓名不能为空")
  if (!input.applicationType.trim()) throw new Error("申请类型不能为空")
  if (!existsSync(input.sourceFolder)) throw new Error("学生资料文件夹不存在")
  if (!existsSync(input.selectionListPath)) throw new Error("选校清单文件不存在")

  const preview = await previewSelectionList(input.selectionListPath)
  const selectedRows = new Set(input.selectedRows)
  const selections = preview.rows.filter((row) => selectedRows.has(row.rowNumber) && isSelectableSelectionRow(row))
  if (selections.length === 0) throw new Error("请至少选择一条可创建的学校/专业记录")

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const workspacePath = await uniqueWorkspacePath(`${slugPart(input.studentName)}-申请批次`)
  const sharedMaterialsPath = join(workspacePath, "00_shared_materials")
  await mkdir(join(workspacePath, "00_selection_list"), { recursive: true })
  await mkdir(join(workspacePath, "03_state"), { recursive: true })
  await cp(input.sourceFolder, sharedMaterialsPath, { recursive: true, force: false, errorOnExist: false })
  const copiedSelectionListPath = join(workspacePath, "00_selection_list", basename(input.selectionListPath))
  await cp(input.selectionListPath, copiedSelectionListPath, { force: false, errorOnExist: false })
  await writeJson(join(workspacePath, "03_state/selection_list_preview.json"), preview)
  await writeJson(join(workspacePath, "03_state/batch_state.json"), {
    id,
    createdAt,
    studentName: input.studentName.trim(),
    sourceFolder: input.sourceFolder,
    sharedMaterialsPath,
    selectionListPath: copiedSelectionListPath,
    selectedRows: selections.map((row) => row.rowNumber),
    status: "待依次处理",
    materialHandling: "学生原始资料已统一复制到本批次工作区；各学校任务按同一份材料来源处理。",
  })

  const tasks = await Promise.all(
    selections.map((selection, index) =>
      createApplicationTask({
        studentName: input.studentName,
        sourceFolder: sharedMaterialsPath,
        school: selection.school,
        program: selection.program,
        applicationType: input.applicationType,
        applicationUrl: selection.applicationUrl || selection.programUrl,
        deadline: selection.deadline,
        notes: selection.notes,
        loginMethod: "顾问手动登录",
        platformUsername: selection.platformUsername,
        outputLanguage: input.outputLanguage,
        allowUpload: input.allowUpload,
        taskGoal: input.taskGoal,
        batchId: id,
        batchWorkspacePath: workspacePath,
        batchOrder: index + 1,
        selectionListPath: copiedSelectionListPath,
        selectionListRow: selection.rowNumber,
      }),
    ),
  )
  await writeJson(join(workspacePath, "03_state/batch_state.json"), {
    id,
    createdAt,
    studentName: input.studentName.trim(),
    sourceFolder: input.sourceFolder,
    sharedMaterialsPath,
    selectionListPath: copiedSelectionListPath,
    selectedRows: selections.map((row) => row.rowNumber),
    status: "待依次处理",
    materialHandling: "学生原始资料已统一复制到本批次工作区；各学校任务按同一份材料来源处理。",
    tasks: tasks.map((task) => ({ id: task.id, workspacePath: task.workspacePath, school: task.input.school, program: task.input.program, order: task.input.batchOrder })),
  })
  return { id, workspacePath, sourceFolder: sharedMaterialsPath, selectionListPath: copiedSelectionListPath, createdAt, tasks }
}

export async function getApplicationWorkspaceRoot() {
  const root = join(app.getPath("documents"), "Terra-Edu Application Agent", "application_workspaces")
  await mkdir(root, { recursive: true })
  return root
}

async function resetCuaControl(workspacePath: string) {
  await writeJson(join(workspacePath, "03_state/cua_control.json"), {
    stopped: false,
    stoppedAt: "",
    reason: "",
    domAutomationUnavailable: false,
    domAutomationUnavailableAt: "",
    domAutomationUnavailableReason: "",
    recentActions: [],
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
  })
}

async function setTaskPaused(workspacePath: string, paused: boolean) {
  await writeJson(join(workspacePath, "03_state/task_control.json"), {
    paused,
    updatedAt: new Date().toISOString(),
    reason: paused ? "顾问在任务工作台点击了暂停任务。" : "顾问在任务工作台点击了继续任务。",
  })
}

async function requireActiveTask(workspacePath: string) {
  const control = await readJson<{ paused?: boolean }>(join(workspacePath, "03_state/task_control.json"), {})
  if (control.paused) throw new Error("任务已暂停。请先在申请 Agent 工作台点击“继续任务”。")
}

export async function listApplicationTasks(limit = 8): Promise<ApplicationTask[]> {
  const root = await getApplicationWorkspaceRoot()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const tasks: ApplicationTask[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    const workspacePath = join(root, entry.name)
    if (!existsSync(join(workspacePath, "03_state/task_state.json"))) continue
    try {
      const task = await getApplicationTask(workspacePath)
      if (isListableApplicationTask(task)) tasks.push(task)
    } catch {}
  }
  return tasks
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, Math.max(1, limit))
}

export async function prepareApplicationAgentConfig(directory: string) {
  await mkdir(directory, { recursive: true })
  await mkdir(join(directory, "02_generated"), { recursive: true })
  await mkdir(join(directory, "03_state"), { recursive: true })
  if (!existsSync(join(directory, "03_state/agent_execution_audit.json"))) {
    await writeJson(join(directory, "03_state/agent_execution_audit.json"), [])
  }
  if (!existsSync(join(directory, "03_state/cua_control.json"))) {
    await resetCuaControl(directory)
  }
  if (!existsSync(join(directory, "03_state/task_control.json"))) {
    await setTaskPaused(directory, false)
  }
  if (!existsSync(join(directory, "03_state/application_requirements.json"))) {
    await writeJson(join(directory, "03_state/application_requirements.json"), {
      sources: [],
      fieldRequirements: [],
      materialRequirements: [],
      uncertainRequirements: [],
      notes: "",
    })
  }
  if (!existsSync(join(directory, "02_generated/application_requirements.md"))) {
    await writeFile(join(directory, "02_generated/application_requirements.md"), "# 申请要求摘要\n\n等待 OpenCode Agent 使用 webfetch/websearch 获取官方申请要求。\n", "utf8")
  }
  await writeOpenCodeConfig(directory)
}

export async function getApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const task = await readJson<Record<string, unknown>>(join(workspacePath, "03_state/task_state.json"), {})
  const savedInput = await readJson<ApplicationTaskInput | null>(join(workspacePath, "03_state/task_input.json"), null)
  const missing = await readJson<unknown>(join(workspacePath, "03_state/missing_items.json"), null)
  const progress = await readJson<unknown>(join(workspacePath, "03_state/application_progress.json"), null)
  const totalFiles = (await scanTaskMaterials(workspacePath)).length
  return normalizeTask(task, workspacePath, savedInput ?? undefined, summarizeMissingRaw(missing, totalFiles, progress))
}

export async function continueApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  await setTaskPaused(workspacePath, false)
  await appendProgress(task, "可继续申请")
  const allFiles = await scanTaskMaterials(workspacePath)
  const materials = await classifyMaterials(workspacePath, allFiles)
  const missingItems = inferMissingItems(task.input, materials)
  const progress = await readJson<ApplicationProgress>(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  await writeGeneratedDocuments(workspacePath, task.input, materials, missingItems, progress)

  task.counts = summarizeCounts(allFiles.length, missingItems)
  task.status = missingItems.length > 0 ? "等待补充材料" : "阶段性完成"
  task.updatedAt = new Date().toISOString()
  task.generatedFiles = generatedFiles(workspacePath)
  task.progress.push({
    at: task.updatedAt,
    status: task.status,
    message:
      missingItems.length > 0
        ? "我已重新读取补充材料并更新学生档案，仍有部分缺失项需要处理。"
        : "我已重新读取补充材料并更新学生档案，当前缺失项已清空。",
  })
  await persistTask(task)
  await appendLog(workspacePath, "agent", "补充材料复查完成，学生档案、缺失项和 Word 清单已更新。")
  return task
}

export async function submitApplicationMaterialReview(workspacePath: string, input: ApplicationMaterialReviewInput): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  if (task.status !== "等待顾问确认材料") {
    throw new Error("当前不在材料确认阶段，不能提交补充内容。")
  }

  const note = input.note?.trim() || ""
  if (input.mode === "note" && !note) {
    throw new Error("请填写要补充给 Agent 的文字信息，或选择暂不补充。")
  }

  const sourceFolder = input.sourceFolder?.trim() || ""
  let supplementalFolder = ""
  if (input.mode === "supplement_folder") {
    if (!sourceFolder || !existsSync(sourceFolder)) throw new Error("补充材料文件夹不存在，请重新选择。")
    if (!(await stat(sourceFolder)).isDirectory()) throw new Error("请选择包含补充材料的文件夹。")
    supplementalFolder = join(workspacePath, "06_new_materials", `supplement-${Date.now()}`)
    await cp(sourceFolder, supplementalFolder, { recursive: true, force: false, errorOnExist: false })
  }

  await writeJson(join(workspacePath, "03_state/material_review.json"), {
    status: "approved",
    mode: input.mode,
    note,
    supplementalFolder: supplementalFolder || undefined,
    submittedAt: new Date().toISOString(),
  })
  task.status = "可继续申请"
  task.updatedAt = new Date().toISOString()
  task.generatedFiles = generatedFiles(workspacePath)
  task.progress.push({
    at: task.updatedAt,
    status: task.status,
    message:
      input.mode === "supplement_folder"
        ? "顾问已选择补充材料文件夹。Agent 将先读取新增材料和顾问说明，再进入申请平台。"
        : input.mode === "note"
          ? "顾问已提交文字补充。Agent 将先写入申请档案和缺失项，再进入申请平台。"
          : "顾问确认暂不补充材料或信息，Agent 可以进入申请平台填写阶段。",
  })
  await persistTask(task)
  await appendLog(workspacePath, "agent", task.progress.at(-1)?.message || "顾问已完成材料确认。")
  return task
}

export async function pauseApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  await setTaskPaused(workspacePath, true)
  await appendProgress(task, "已暂停")
  await appendLog(workspacePath, "agent", "顾问已暂停任务。正在执行的单个文件处理会完成后停止，后续操作需顾问点击继续任务。")
  return task
}

export async function resumeApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  await setTaskPaused(workspacePath, false)
  await appendProgress(task, "可继续申请")
  await appendLog(workspacePath, "agent", "顾问已继续任务。Agent 将从已保存的任务状态和审计记录恢复下一步。")
  return task
}

export async function refreshApplicationTaskDocuments(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  const materials = await readJson<MaterialRecord[]>(join(workspacePath, "03_state/materials_index.json"), [])
  const missingRaw = await readJson<unknown>(join(workspacePath, "03_state/missing_items.json"), [])
  const progress = await readJson<ApplicationProgress>(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  const syncedMissingItems = syncMissingItemsWithProgress(normalizeMissingItems(missingRaw), progress)
  await writeGeneratedDocuments(workspacePath, task.input, materials, syncedMissingItems, progress)

  const activeMissingItems = filterActiveMissingItems(syncedMissingItems)
  const totalFiles = (await scanTaskMaterials(workspacePath)).length
  task.counts = summarizeCounts(totalFiles, syncedMissingItems)
  task.status = activeMissingItems.some((item) => item.blocksProgress) ? "等待补充材料" : "阶段性完成"
  task.updatedAt = new Date().toISOString()
  task.generatedFiles = generatedFiles(workspacePath)
  task.progress.push({
    at: task.updatedAt,
    status: task.status,
    message: "已根据最新申请平台保存验证刷新缺失项和顾问文档。",
  })
  await persistTask(task)
  await appendLog(workspacePath, "agent", "已刷新缺失项结构和顾问文档，已解决的申请平台表单错误不会再出现在补充清单。")
  return task
}

export async function runApplicationCommand(workspacePath: string, command: string): Promise<ApplicationTask> {
  await requireActiveTask(workspacePath)
  const task = await getApplicationTask(workspacePath)
  const normalized = command.trim()
  if (
    normalized === "开始申请填表" ||
    normalized === "继续申请填表" ||
    /^(开始|继续|恢复).*(填表|CUA|自动化)/i.test(normalized)
  ) {
    await resetCuaControl(workspacePath)
    await openApplicationPlatform(workspacePath)
    return getApplicationTask(workspacePath)
  }
  if (normalized === "材料已经补好了，继续申请") {
    return continueApplicationTask(workspacePath)
  }
  await appendProgress(task, "阶段性完成")
  await appendLog(workspacePath, "agent", `快捷操作已记录：${normalized}`)
  await persistTask(task)
  return task
}

export async function openApplicationPlatform(workspacePath: string): Promise<ApplicationTask> {
  await requireActiveTask(workspacePath)
  const task = await getApplicationTask(workspacePath)
  const materialReview = await readJson<{ status?: string }>(join(workspacePath, "03_state/material_review.json"), {})
  if (materialReview.status === "pending") {
    throw new Error("材料整理已完成，但顾问尚未确认补充内容。请先在申请 Agent 的材料确认面板完成选择。")
  }
  await resetCuaControl(workspacePath)
  const url = task.input.applicationUrl || ""
  if (!task.input.applicationUrl) {
    await appendLog(workspacePath, "cua", "申请平台链接尚未确认。请先让 Agent 核验项目官网并补充正式申请链接，再打开平台。")
    return task
  }
  await appendProgress(task, "等待顾问登录")
  const progress = await readJson<ApplicationProgress>(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  const now = new Date()
  const recentlyOpened =
    normalizeApplicationUrl(progress.platformLastOpenedUrl) === normalizeApplicationUrl(url) &&
    Date.parse(progress.platformLastOpenedAt || "") > 0 &&
    now.getTime() - Date.parse(progress.platformLastOpenedAt || "") < 10 * 60 * 1000
  if (!recentlyOpened) {
    await shell.openExternal(url)
    progress.platformLastOpenedAt = now.toISOString()
    progress.platformLastOpenedUrl = url
  } else {
    await appendLog(workspacePath, "cua", "已跳过重复打开申请平台：" + url)
  }
  progress.currentPage = "申请平台登录/当前页面"
  progress.failedActions.push({
    at: now.toISOString(),
    action: "cua_open_application_platform",
    reason: recentlyOpened ? "申请平台近期已打开，本次复用现有页面继续。" : "申请平台填表将由 OpenCode Agent 通过 ego-browser / ego lite 在独立 Space 中继续执行。",
  })
  await writeJson(join(workspacePath, "03_state/application_progress.json"), progress)
  await appendLog(
    workspacePath,
    "cua",
    "已打开申请平台。若页面需要登录，请顾问手动登录；Agent 不保存账号密码，登录完成后可继续填表。",
  )
  await persistTask(task)
  return task
}

export async function blockHighRiskAction(workspacePath: string, action: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  const progress = await readJson<ApplicationProgress>(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  progress.highRiskBlocks.push({
    at: new Date().toISOString(),
    action,
    reason: "根据申请 Agent 安全规则，最终提交、付款、推荐信邀请和不可逆确认必须由顾问人工完成。",
  })
  await writeJson(join(workspacePath, "03_state/application_progress.json"), progress)
  await appendLog(workspacePath, "cua", `已拦截高风险动作：${action}`)
  await persistTask(task)
  return task
}

function validateTaskInput(input: ApplicationTaskInput) {
  const required: Array<[keyof ApplicationTaskInput, string]> = [
    ["studentName", "学生姓名"],
    ["sourceFolder", "学生资料文件夹"],
    ["school", "申请学校"],
    ["program", "申请项目 / 专业"],
    ["applicationType", "申请类型"],
  ]
  for (const [key, label] of required) {
    if (!String(input[key] ?? "").trim()) throw new Error(`${label}不能为空`)
  }
  if (!existsSync(input.sourceFolder)) throw new Error("学生资料文件夹不存在")
  if (input.applicationUrl && !URL.canParse(input.applicationUrl)) throw new Error("申请平台链接格式不正确")
}

function isSelectableSelectionRow(row: SelectionListRow) {
  return row.status === "ready" || row.status === "needs_research"
}

function sanitizeTaskInput(input: ApplicationTaskInput): ApplicationTaskInput {
  return {
    ...input,
    applicationUrl: input.applicationUrl?.trim() || undefined,
    platformUsername: input.platformUsername?.trim() || undefined,
  }
}

async function findExistingApplicationTask(input: ApplicationTaskInput) {
  const tasks = await listApplicationTasks(200).catch(() => [])
  return tasks.find((task) => isSameApplicationInput(task.input, input)) ?? null
}

function isSameApplicationInput(a: ApplicationTaskInput, b: ApplicationTaskInput) {
  return (
    normalizeComparable(a.studentName) === normalizeComparable(b.studentName) &&
    normalizeComparable(a.school) === normalizeComparable(b.school) &&
    normalizeComparable(a.program) === normalizeComparable(b.program) &&
    normalizeApplicationUrl(a.applicationUrl) === normalizeApplicationUrl(b.applicationUrl)
  )
}

function normalizeComparable(value?: string) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function normalizeApplicationUrl(value?: string) {
  const raw = String(value || "").trim()
  if (!URL.canParse(raw)) return normalizeComparable(raw).replace(/\/+$/, "")
  const url = new URL(raw)
  url.hash = ""
  const pathname = url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host}${pathname || "/"}${url.search}`.toLowerCase()
}

async function uniqueWorkspacePath(slug: string) {
  const root = await getApplicationWorkspaceRoot()
  let candidate = join(root, slug)
  let index = 2
  while (existsSync(candidate)) {
    candidate = join(root, `${slug}-${index}`)
    index += 1
  }
  return candidate
}

async function createWorkspace(workspacePath: string) {
  const dirs = [
    "00_original_backup",
    "01_classified_materials/identity",
    "01_classified_materials/academic",
    "01_classified_materials/language",
    "01_classified_materials/essays",
    "01_classified_materials/recommendation",
    "01_classified_materials/financial",
    "01_classified_materials/platform_related",
    "01_classified_materials/other",
    "01_classified_materials/needs_review",
    "02_generated",
    "03_state",
    "04_logs",
    "05_screenshots",
    "06_new_materials",
    ".opencode",
  ]
  for (const dir of dirs) await mkdir(join(workspacePath, dir), { recursive: true })
  await writeFile(join(workspacePath, "04_logs/agent_log.md"), "# Agent 日志\n\n", "utf8")
  await writeFile(join(workspacePath, "04_logs/cua_log.md"), "# 浏览器自动化日志\n\n", "utf8")
  await writeJson(join(workspacePath, "03_state/agent_execution_audit.json"), [])
  await writeJson(join(workspacePath, "03_state/cua_control.json"), {
    stopped: false,
    stoppedAt: "",
    reason: "",
    domAutomationUnavailable: false,
    domAutomationUnavailableAt: "",
    domAutomationUnavailableReason: "",
    recentActions: [],
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
  })
  await setTaskPaused(workspacePath, false)
  await writeJson(join(workspacePath, "03_state/application_requirements.json"), {
    sources: [],
    fieldRequirements: [],
    materialRequirements: [],
    uncertainRequirements: [],
    notes: "",
  })
  await writeFile(join(workspacePath, "02_generated/application_requirements.md"), "# 申请要求摘要\n\n等待 OpenCode Agent 使用 webfetch/websearch 获取官方申请要求。\n", "utf8")
  await writeOpenCodeConfig(workspacePath)
}

function buildTask(input: {
  id: string
  slug: string
  workspacePath: string
  sessionDirectory: string
  createdAt: string
  status: ApplicationTaskStatus
  input: ApplicationTaskInput
  materialCount: number
}): ApplicationTask {
  return {
    id: input.id,
    slug: input.slug,
    workspacePath: input.workspacePath,
    sessionDirectory: input.sessionDirectory,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: input.status,
    input: input.input,
    counts: {
      totalFiles: input.materialCount,
      missingInformation: 0,
      missingMaterials: 0,
      uncertainItems: 0,
    },
    generatedFiles: generatedFiles(input.workspacePath),
    progress: [{ at: input.createdAt, status: input.status, message: STATUS_MESSAGES[input.status] }],
  }
}

function normalizeTask(
  task: Partial<ApplicationTask> & Record<string, unknown>,
  workspacePath = String(task.workspacePath ?? ""),
  savedInput?: ApplicationTaskInput,
  derivedCounts?: ApplicationTask["counts"],
): ApplicationTask {
  const legacyUpdatedAt =
    stringValue(task.updatedAt) ??
    stringValue(task.updated_at) ??
    stringValue(task.lastUpdated) ??
    stringValue(task.last_updated)
  const createdAt =
    stringValue(task.createdAt) ??
    stringValue(task.created_at) ??
    legacyUpdatedAt ??
    new Date().toISOString()
  const legacyStudentName = stringValue(task.studentName) ?? stringValue(task.student_name) ?? ""
  const input = savedInput ?? task.input ?? {
    studentName: legacyStudentName,
    sourceFolder: stringValue(task.sourceFolder) ?? stringValue(task.source_folder) ?? "",
    school: stringValue(task.school) ?? "",
    program: stringValue(task.program) ?? "",
    applicationType: stringValue(task.applicationType) ?? stringValue(task.application_type) ?? "硕士",
    applicationUrl: stringValue(task.applicationUrl) ?? stringValue(task.application_url) ?? "",
    deadline: stringValue(task.deadline) ?? "",
    notes: stringValue(task.notes) ?? "",
    loginMethod: stringValue(task.loginMethod) ?? stringValue(task.login_method) ?? "顾问手动登录",
    outputLanguage: normalizeOutputLanguage(task.outputLanguage ?? task.output_language),
    allowUpload: typeof task.allowUpload === "boolean" ? task.allowUpload : true,
    taskGoal: stringValue(task.taskGoal) ?? stringValue(task.task_goal) ?? "全流程执行",
  }
  const status = normalizeStatus(task.status, task.current_step ?? task.currentStep ?? task.currentPhase)
  return {
    id: typeof task.id === "string" ? task.id : typeof task.task_id === "string" ? task.task_id : createStableId(workspacePath),
    slug: typeof task.slug === "string" ? task.slug : basename(workspacePath),
    workspacePath,
    sessionDirectory: task.sessionDirectory ?? workspacePath,
    createdAt,
    updatedAt: legacyUpdatedAt ?? createdAt,
    status,
    input,
    counts: {
      totalFiles: task.counts?.totalFiles ?? derivedCounts?.totalFiles ?? 0,
      missingInformation: task.counts?.missingInformation ?? derivedCounts?.missingInformation ?? 0,
      missingMaterials: task.counts?.missingMaterials ?? derivedCounts?.missingMaterials ?? 0,
      uncertainItems: task.counts?.uncertainItems ?? derivedCounts?.uncertainItems ?? 0,
    },
    generatedFiles: Array.isArray(task.generatedFiles) ? task.generatedFiles : generatedFiles(workspacePath),
    progress: Array.isArray(task.progress) ? task.progress : [{ at: createdAt, status, message: STATUS_MESSAGES[status] }],
  }
}

function isListableApplicationTask(task: ApplicationTask) {
  const studentName = task.input.studentName.trim()
  const school = task.input.school.trim()
  const program = task.input.program.trim()
  return Boolean(studentName && (school || program))
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function normalizeOutputLanguage(value: unknown): ApplicationTaskInput["outputLanguage"] {
  return value === "en" ? "en" : "zh"
}

function normalizeStatus(status: unknown, currentStep: unknown): ApplicationTaskStatus {
  if (typeof status === "string" && status in STATUS_MESSAGES) return status as ApplicationTaskStatus
  if (typeof currentStep === "string") {
    if (currentStep.includes("workspace")) return "正在创建申请工作区"
    if (currentStep.includes("backup") || currentStep.includes("copy")) return "正在复制原始材料"
    if (currentStep.includes("classification")) return "正在整理材料"
    if (currentStep.includes("profile")) return "正在生成学生资料"
    if (currentStep.includes("missing")) return "正在检查缺失内容"
    if (currentStep.includes("cua_login")) return "等待顾问登录"
    if (currentStep.includes("cua") || currentStep.includes("form")) return "正在填写申请平台"
    if (currentStep.includes("summary")) return "阶段性完成"
  }
  if (status === "in_progress") return "正在检查缺失内容"
  if (status === "completed") return "阶段性完成"
  if (status === "error") return "异常中断"
  return "已创建"
}

async function scanTaskMaterials(workspacePath: string) {
  const roots = [join(workspacePath, "00_original_backup"), join(workspacePath, "06_new_materials")].filter(existsSync)
  return (await Promise.all(roots.map((root) => scanFiles(root)))).flat()
}

async function appendProgress(task: ApplicationTask, status: ApplicationTaskStatus) {
  const at = new Date().toISOString()
  task.status = status
  task.updatedAt = at
  task.progress.push({ at, status, message: STATUS_MESSAGES[status] })
  await persistTask(task)
}

async function persistTask(task: ApplicationTask) {
  task.generatedFiles = generatedFiles(task.workspacePath)
  await writeJson(join(task.workspacePath, "03_state/task_state.json"), task)
}

async function scanFiles(root: string): Promise<string[]> {
  const output: string[] = []
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile()) output.push(full)
    }
  }
  await walk(root)
  return output
}

async function classifyMaterials(workspacePath: string, files: string[]): Promise<MaterialRecord[]> {
  const records: MaterialRecord[] = []
  const backupRoot = join(workspacePath, "00_original_backup")
  for (const file of files) {
    const fileName = basename(file)
    const match = classifyFile(fileName)
    const categoryDir = join(workspacePath, "01_classified_materials", CATEGORY_DIRS[match.category])
    await mkdir(categoryDir, { recursive: true })
    const target = await uniqueFilePath(join(categoryDir, fileName))
    await cp(file, target, { force: false, errorOnExist: false })
    records.push({
      originalPath: file,
      backupPath: relative(workspacePath, file),
      classifiedPath: relative(workspacePath, target),
      fileName,
      extension: extname(fileName).toLowerCase(),
      category: match.category,
      confidence: match.confidence,
      reason: match.reason,
    })
  }
  await writeJson(join(workspacePath, "03_state/materials_index.json"), records)
  await writeFile(join(workspacePath, "02_generated/materials_index.md"), renderMaterialsIndex(records, backupRoot), "utf8")
  return records
}

function classifyFile(name: string): Pick<MaterialRecord, "category" | "confidence" | "reason"> {
  const lower = name.toLowerCase()
  const tests: Array<[MaterialCategory, RegExp, string]> = [
    ["identity", /passport|护照|id card|身份证|identity/, "命中文件名中的身份材料关键词"],
    ["academic", /transcript|成绩|在读|毕业|degree|diploma|academic|school report|成绩单/, "命中文件名中的学术材料关键词"],
    ["language", /toefl|ielts|duolingo|sat|act|gre|gmat|托福|雅思|多邻国|语言/, "命中文件名中的语言/标化关键词"],
    ["essays", /essay|personal statement|statement|文书|ps|cv|resume|简历/, "命中文件名中的文书或简历关键词"],
    ["recommendation", /recommend|reference|推荐|rl|lor/, "命中文件名中的推荐材料关键词"],
    ["financial", /bank|finance|financial|资金|存款|资产|deposit/, "命中文件名中的财务材料关键词"],
    ["platform_related", /common app|coalition|ucas|apply|portal|申请平台|账号/, "命中文件名中的申请平台关键词"],
  ]
  for (const [category, pattern, reason] of tests) {
    if (pattern.test(lower)) return { category, confidence: "high", reason }
  }
  const ext = extname(lower)
  if ([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".heic"].includes(ext)) {
    return { category: "other", confidence: "medium", reason: "文件类型常见，但文件名无法判断具体用途" }
  }
  return { category: "needs_review", confidence: "needs_review", reason: "文件类型或文件名无法确认用途" }
}

async function uniqueFilePath(path: string) {
  if (!existsSync(path)) return path
  const dir = dirname(path)
  const ext = extname(path)
  const stem = basename(path, ext)
  let index = 2
  let candidate = join(dir, `${stem}-${index}${ext}`)
  while (existsSync(candidate)) {
    index += 1
    candidate = join(dir, `${stem}-${index}${ext}`)
  }
  return candidate
}

function inferMissingItems(input: ApplicationTaskInput, materials: MaterialRecord[]): MissingItem[] {
  const hasCategory = (category: MaterialCategory) => materials.some((item) => item.category === category)
  const hasName = (pattern: RegExp) => materials.some((item) => pattern.test(item.fileName.toLowerCase()))
  const items: MissingItem[] = []
  const add = (item: Omit<MissingItem, "id" | "status" | "addedToWordList">) => {
    items.push({
      ...item,
      id: createStableId(`${item.type}:${item.name}`),
      status: item.type === "uncertain" ? "needs_confirmation" : "missing",
      addedToWordList: true,
    })
  }

  if (!hasName(/passport|护照/)) {
    add({
      name: "护照首页",
      type: "material",
      source: "material_scan",
      whyNeeded: "用于申请平台身份信息填写和材料上传。",
      prepareFrom: "学生本人护照个人信息页。",
      formatRequirement: "清晰照片或 PDF，文字和护照号码必须可读。",
      blocksProgress: true,
    })
  }
  if (!hasCategory("academic")) {
    add({
      name: "英文成绩单或在读/毕业证明",
      type: "material",
      source: "material_scan",
      whyNeeded: "用于填写教育经历、成绩信息和学校材料上传。",
      prepareFrom: "学校教务处或官方系统。",
      formatRequirement: "PDF 优先，需包含学校名称、学生姓名、课程/成绩和盖章或官方认证。",
      blocksProgress: true,
    })
  }
  if (!hasCategory("language")) {
    add({
      name: "语言或标化成绩单",
      type: "material",
      source: "application_target",
      whyNeeded: `${input.school} ${input.program} 申请通常需要填写或上传语言/标化成绩。`,
      prepareFrom: "考试官网或学生已有成绩报告。",
      formatRequirement: "PDF 或清晰截图，需包含姓名、考试日期和分数。",
      blocksProgress: false,
    })
  }
  if (!hasName(/resume|cv|简历/)) {
    add({
      name: "英文简历",
      type: "material",
      source: "application_target",
      whyNeeded: "用于申请平台活动经历、工作经历和材料上传。",
      prepareFrom: "学生或顾问已有简历版本。",
      formatRequirement: "PDF 或 Word，建议英文版本。",
      blocksProgress: false,
    })
  }
  if (!hasCategory("recommendation")) {
    add({
      name: "推荐人姓名、职位、邮箱和联系方式",
      type: "information",
      source: "application_target",
      whyNeeded: "申请平台可能需要填写推荐人信息或发送推荐邀请。",
      prepareFrom: "学生确认后的推荐老师信息。",
      formatRequirement: "请提供推荐人姓名、职位、机构、学校邮箱和电话；推荐信邀请不可由 Agent 自动发送。",
      blocksProgress: true,
    })
  }
  if (materials.some((item) => item.category === "needs_review" || item.confidence === "needs_review")) {
    add({
      name: "待确认材料用途",
      type: "uncertain",
      source: "material_scan",
      whyNeeded: "部分文件用途无法从文件名或类型判断，不能随意归类或上传。",
      prepareFrom: "顾问确认这些文件对应的申请用途。",
      formatRequirement: "请在对话中说明每个待确认文件的用途。",
      blocksProgress: false,
    })
  }
  return items
}

function normalizeMissingItems(raw: unknown): MissingItem[] {
  return collectMissingRecords(raw).map((record, index) => normalizeMissingItem(record, index))
}

function collectMissingRecords(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter(isRecord)
  if (!isRecord(raw)) return []
  const directItems = Array.isArray(raw.items) ? raw.items.filter(isRecord) : []
  const groupedItems: Array<Record<string, unknown>> = []
  const groups: Array<[string, MissingItem["type"]]> = [
    ["missingInformation", "information"],
    ["missing_info", "information"],
    ["missingMaterials", "material"],
    ["missing_materials", "material"],
    ["uncertainItems", "uncertain"],
    ["uncertain_items", "uncertain"],
  ]
  for (const [key, type] of groups) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    groupedItems.push(...value.filter(isRecord).map((item) => ({ ...item, type: item.type ?? type })))
  }
  return [...directItems, ...groupedItems]
}

function normalizeMissingItem(item: Record<string, unknown>, index: number): MissingItem {
  const type = classifyMissingType(item)
  const status = normalizeMissingStatus(item, type)
  const name =
    firstText(item, ["name", "item", "field", "title", "label", "requirement", "id"]) ??
    `待确认事项 ${String(index + 1).padStart(2, "0")}`
  const whyNeeded =
    firstText(item, ["whyNeeded", "why_needed", "detail", "details", "reason", "description", "note"]) ??
    "申请平台或学校申请要求需要该内容。"
  const prepareFrom =
    firstText(item, ["prepareFrom", "prepare_from", "preparation_method", "sourceText", "source"]) ??
    (type === "material" ? "请学生或家长提供对应材料。" : "请顾问向学生确认后补充。")
  const formatRequirement =
    firstText(item, ["formatRequirement", "format_requirement", "format", "requirementFormat", "requirement"]) ??
    (type === "material" ? "清晰 PDF、Word 或图片文件，以申请平台要求为准。" : "文字说明即可；涉及日期、地址、姓名拼写时请按证件或官方材料填写。")
  const rawStatus = firstText(item, ["status", "state", "progress"])
  const explicitBlocksProgress = item.blocksProgress ?? item.blocks_progress ?? item.affects_continuation
  const priority = firstText(item, ["priority", "urgency"])
  return {
    id: firstText(item, ["id"]) ?? `missing-${String(index + 1).padStart(2, "0")}`,
    name,
    type,
    status,
    source: normalizeMissingSource(item.source),
    page: firstText(item, ["page", "section"]),
    whyNeeded,
    prepareFrom,
    formatRequirement,
    blocksProgress:
      status !== "resolved" &&
      (typeof explicitBlocksProgress === "boolean" ? explicitBlocksProgress : priority === "high" || status === "missing"),
    addedToWordList: item.addedToWordList !== false && item.include_in_word !== false,
    priority,
    rawStatus,
    resolvedAt: firstText(item, ["resolvedAt", "resolved_at"]),
    resolvedReason: firstText(item, ["resolvedReason", "resolved_reason"]),
  }
}

function syncMissingItemsWithProgress(missingItems: MissingItem[], progress: unknown): MissingItem[] {
  const reviewReady = hasVerifiedReviewReady(progress)
  if (!reviewReady) return missingItems
  const resolvedAt = new Date().toISOString()
  return missingItems.map((item) => {
    if (!isReviewResolvedPlatformItem(item)) return item
    return {
      ...item,
      status: "resolved",
      blocksProgress: false,
      addedToWordList: false,
      resolvedAt: item.resolvedAt ?? resolvedAt,
      resolvedReason: item.resolvedReason ?? "申请平台 Review 已由 ego-browser 验证为 0 错误 0 警告。",
    }
  })
}

function filterActiveMissingItems(missingItems: MissingItem[]) {
  return missingItems.filter((item) => item.status !== "resolved")
}

function isReviewResolvedPlatformItem(item: MissingItem) {
  const rawStatus = String(item.rawStatus ?? item.status).toLowerCase()
  const text = `${item.name} ${item.page ?? ""} ${item.whyNeeded} ${item.prepareFrom} ${item.formatRequirement}`.toLowerCase()
  if (rawStatus === "missing_form") return true
  if (item.source === "cua") return true
  if (/review|slate|申请平台|form|表单|required|必填|validation|error|错误|warning|警告/.test(text)) {
    if (/文书|statement of purpose|sop|推荐信|recommendation|银行|存款|资金|financial|护照号码|passport number|i-20/.test(text)) {
      return (
        rawStatus === "available_not_uploaded" ||
        (/resume|cv|简历|upload|上传/.test(text) && /review[^。；\n]*(错误|error|required|is required)|error|错误|required|必填/.test(text))
      )
    }
    return true
  }
  return false
}

function hasVerifiedReviewReady(progress: unknown) {
  if (!isRecord(progress)) return false
  const savedPages = Array.isArray(progress.savedPages) ? progress.savedPages : []
  return savedPages.some((entry) => {
    const text = collectProgressText(entry).toLowerCase()
    if (/application ready for submission|ready for submission|no errors? or warnings?/.test(text)) return true
    return /(0\s*(错误|error|errors))/.test(text) && /(0\s*(警告|warning|warnings))/.test(text)
  })
}

function collectProgressText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(collectProgressText).join(" ")
  if (!isRecord(value)) return ""
  return Object.values(value).map(collectProgressText).join(" ")
}

function normalizeMissingStatus(item: Record<string, unknown>, type: MissingItem["type"]): MissingItem["status"] {
  const status = String(item.status ?? item.state ?? item.progress ?? "").toLowerCase()
  if (/resolved|complete|completed|done|filled|uploaded|verified|saved|已解决|已完成|已填写|已上传/.test(status)) return "resolved"
  if (/pending_consultant|needs_confirmation|need_confirmation|uncertain|waiting|待确认|需确认/.test(status)) return "needs_confirmation"
  if (type === "uncertain") return "needs_confirmation"
  return "missing"
}

function normalizeMissingSource(value: unknown): MissingItem["source"] {
  if (value === "material_scan" || value === "application_target" || value === "cua" || value === "manual") return value
  return "application_target"
}

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

async function writeGeneratedDocuments(
  workspacePath: string,
  input: ApplicationTaskInput,
  materials: MaterialRecord[],
  missingItems: MissingItem[],
  applicationProgress: ApplicationProgress,
) {
  const syncedMissingItems = syncMissingItemsWithProgress(normalizeMissingItems(missingItems), applicationProgress)
  const activeMissingItems = filterActiveMissingItems(syncedMissingItems)
  await writeJson(join(workspacePath, "03_state/missing_items.json"), syncedMissingItems)
  await writeJson(join(workspacePath, "03_state/application_progress.json"), applicationProgress)
  await writeFile(join(workspacePath, "02_generated/student_profile.md"), renderStudentProfile(input, materials, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/info_collection_form.md"), renderInfoCollection(input, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/material_collection_form.md"), renderMaterialCollection(input, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/task_summary.md"), renderTaskSummary(input, materials, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/missing_materials.docx"), makeDocx(renderWordText(input, activeMissingItems)))
}

function renderStudentProfile(input: ApplicationTaskInput, materials: MaterialRecord[], missingItems: MissingItem[]) {
  return `# ${input.studentName} 申请档案

## 任务基本信息

- 学生姓名：${input.studentName}
- 申请学校：${input.school}
- 申请项目 / 专业：${input.program}
- 申请类型：${input.applicationType}
- 申请平台链接：${input.applicationUrl}
- 截止日期：${input.deadline || "未填写"}
- 输出语言：${input.outputLanguage === "en" ? "English" : "中文"}
- 本次任务目标：${input.taskGoal || "全流程执行"}
- 顾问备注：${input.notes || "无"}

## 学生基本信息

目前仅从任务创建页和材料文件名建立基础档案。Agent 后续应继续读取信息收集表、材料收集表、护照、成绩单、简历、文书等文件，补齐以下结构化字段。

## 联系方式

- 学生邮箱：待提取或补充
- 学生电话：待提取或补充
- 家庭联系人：待提取或补充
- 紧急联系人：待提取或补充

## 教育经历

待从成绩单、在读证明、毕业证或信息收集表中提取。

## 成绩信息

待从成绩单和语言/标化成绩报告中提取。

## 活动、奖项、文书与推荐信息

待从简历、文书和推荐材料中提取。推荐信邀请属于高风险动作，不能自动发送。

## 已有材料目录

${materials.map((item) => `- ${item.fileName} → ${item.classifiedPath}（${item.category}，${item.confidence}，${item.reason}）`).join("\n") || "- 暂未识别到材料"}

## 缺失信息

${missingItems
  .filter((item) => item.type === "information")
  .map((item) => `- ${item.name}：${item.whyNeeded}`)
  .join("\n") || "- 暂无"}

## 缺失材料

${missingItems
  .filter((item) => item.type === "material")
  .map((item) => `- ${item.name}：${item.whyNeeded}`)
  .join("\n") || "- 暂无"}

## 不确定信息

${missingItems
  .filter((item) => item.type === "uncertain")
  .map((item) => `- ${item.name}：${item.whyNeeded}`)
  .join("\n") || "- 暂无"}

## 申请平台填写注意事项

- 可以填写、上传、保存，但不能最终提交申请。
- 不确定字段必须询问顾问，不能猜测填写。
- 账号密码不能写入日志、档案或缺失清单。
- 付款、最终提交、推荐信邀请、不可逆确认必须由顾问人工完成。
`
}

function renderInfoCollection(input: ApplicationTaskInput, missingItems: MissingItem[]) {
  const items = missingItems.filter((item) => item.type === "information" || item.type === "uncertain")
  return `# ${input.studentName} 信息补充清单

以下内容用于 ${input.school} ${input.program} 申请。已有信息不会重复收集，只列出缺失、无法判断或需要确认的内容。

${items
  .map(
    (item, index) => `## ${index + 1}. ${item.name}

- 为什么需要：${item.whyNeeded}
- 去哪里准备：${item.prepareFrom}
- 格式要求：${item.formatRequirement}
- 是否影响继续申请：${item.blocksProgress ? "是" : "否"}
`,
  )
  .join("\n") || "当前没有需要补充的信息。"}
`
}

function renderMaterialCollection(input: ApplicationTaskInput, missingItems: MissingItem[]) {
  const items = missingItems.filter((item) => item.type === "material")
  return `# ${input.studentName} 材料补充清单

以下材料用于 ${input.school} ${input.program} 申请。请补齐后放入任务工作区的 06_new_materials 文件夹，或放回学生资料文件夹后让 Agent 重新读取。

${items
  .map(
    (item, index) => `## ${index + 1}. ${item.name}

- 为什么需要：${item.whyNeeded}
- 去哪里准备：${item.prepareFrom}
- 文件格式要求：${item.formatRequirement}
- 是否影响继续申请：${item.blocksProgress ? "是" : "否"}
`,
  )
  .join("\n") || "当前没有需要补充的材料。"}
`
}

function renderTaskSummary(input: ApplicationTaskInput, materials: MaterialRecord[], missingItems: MissingItem[]) {
  return `# ${input.studentName} 申请任务总结

## 本次完成

- 创建了独立申请工作区。
- 复制了原始学生材料副本，未修改原始文件夹。
- 按用途整理了 ${materials.length} 个文件。
- 生成了学生申请档案、信息收集表、材料收集表、缺失材料 Word 清单和任务状态文件。

## 当前申请目标

- 学校：${input.school}
- 项目 / 专业：${input.program}
- 类型：${input.applicationType}
- 平台：${input.applicationUrl}

## 缺失内容

${missingItems.map((item) => `- ${item.name}（${item.type}）：${item.whyNeeded}`).join("\n") || "- 暂无缺失项"}

## 下一步建议

${missingItems.length > 0 ? "- 将缺失材料补齐后，告诉 Agent「材料已经补好了，继续申请」。\n- 顾问登录申请平台后，Agent 可以继续填写和尝试上传。" : "- 当前可填写内容已准备好，可以进入申请平台继续填写。"}

## 安全边界

- Agent 可以填写、上传、保存。
- Agent 不能最终提交申请。
- Agent 不能付款。
- Agent 不能自动发送不可逆推荐信邀请。
- Agent 不能保存账号密码。
`
}

function renderMaterialsIndex(records: MaterialRecord[], backupRoot: string) {
  return `# 材料目录

原始材料副本目录：${backupRoot}

${records.map((item) => `- ${item.fileName} → ${item.classifiedPath}（${item.category}）`).join("\n") || "- 暂无材料"}
`
}

function renderWordText(input: ApplicationTaskInput, missingItems: MissingItem[]) {
  const includedItems = missingItems.filter((item) => item.addedToWordList !== false)
  const lines = [
    `${input.studentName} 补充材料清单`,
    "",
    `申请学校：${input.school}`,
    `申请项目：${input.program}`,
    "",
    "请按以下要求补充材料或信息。补齐后请发给顾问，或放入指定补充材料文件夹。",
    "",
  ]
  if (includedItems.length === 0) {
    lines.push("当前没有需要补充的材料或信息。")
  } else {
    includedItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.name}`)
      lines.push(`需要原因：${item.whyNeeded}`)
      lines.push(`准备方式：${item.prepareFrom}`)
      lines.push(`格式要求：${item.formatRequirement}`)
      lines.push("")
    })
  }
  lines.push("说明：最终提交申请、付款和推荐信邀请需由顾问人工确认完成。")
  return lines.join("\n")
}

function initialApplicationProgress(): ApplicationProgress {
  return {
    currentPage: "尚未进入申请平台",
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
    todoPlan: [
      { step: "读取任务输入并创建隔离工作区", status: "pending" },
      { step: "复制原始资料到 00_original_backup", status: "pending" },
      { step: "读取和 OCR 学生材料", status: "pending" },
      { step: "分类材料并生成 materials_index", status: "pending" },
      { step: "抓取学校/项目申请要求", status: "pending" },
      { step: "生成 student_profile.md", status: "pending" },
      { step: "检查缺失项并更新 missing_items.json", status: "pending" },
      { step: "生成信息表、材料表和 Word 清单", status: "pending" },
      { step: "ego-browser 打开平台、等待登录并填写可确认字段", status: "pending" },
      { step: "保存进度、生成总结并提示人工高风险动作", status: "pending" },
    ],
  }
}

function summarizeCounts(totalFiles: number, missingItems: MissingItem[]) {
  const activeItems = filterActiveMissingItems(missingItems)
  return {
    totalFiles,
    missingInformation: activeItems.filter((item) => item.type === "information").length,
    missingMaterials: activeItems.filter((item) => item.type === "material").length,
    uncertainItems: activeItems.filter((item) => item.type === "uncertain").length,
  }
}

function summarizeMissingRaw(value: unknown, totalFiles: number, progress?: unknown) {
  const empty = { totalFiles, missingInformation: 0, missingMaterials: 0, uncertainItems: 0 }
  if (!value || typeof value !== "object") return empty
  const summary = "summary" in value ? (value as { summary?: Record<string, unknown> }).summary : undefined
  if (summary) {
    return {
      totalFiles,
      missingInformation: Number(summary.missing_info ?? summary.missingInformation ?? 0),
      missingMaterials: Number(summary.missing_materials ?? summary.missingMaterials ?? 0),
      uncertainItems: Number(summary.uncertain_items ?? summary.uncertainItems ?? 0),
    }
  }
  const items = filterActiveMissingItems(syncMissingItemsWithProgress(normalizeMissingItems(value), progress))
  return {
    totalFiles,
    missingInformation: items.filter((item) => item.type === "information").length,
    missingMaterials: items.filter((item) => item.type === "material").length,
    uncertainItems: items.filter((item) => item.type === "uncertain").length,
  }
}

function classifyMissingType(item: unknown): MissingItem["type"] {
  if (!isRecord(item)) return "uncertain"
  const type = String(item.type ?? "").toLowerCase()
  const status = String(item.status ?? item.state ?? item.progress ?? "").toLowerCase()
  const category = String(item.category ?? "").toLowerCase()
  const text = `${type} ${category} ${firstText(item, ["name", "item", "field", "title", "detail", "details", "reason"]) ?? ""}`.toLowerCase()
  if (/missing_form|form_error|required_field/.test(status)) return "information"
  if (/available_not_uploaded|upload_pending/.test(status)) return "material"
  if (/information|info|field|personal|信息缺失|信息/.test(type)) return "information"
  if (/material|document|file|upload|essay|文书缺失|材料缺失|材料|文书/.test(type)) return "material"
  if (/uncertain|confirmation|待确认/.test(type)) return "uncertain"
  if (/推荐|recommendation|财务|financial|银行|bank|文书|essay|sop|resume|cv|简历|upload|上传|document|材料/.test(text)) return "material"
  if (/地址|公民|法律|就业|工作|申请信息|表单|问题|日期|姓名|电话|邮箱|信息/.test(text)) return "information"
  return "uncertain"
}

function generatedFiles(workspacePath: string): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { label: "申请工作区", path: workspacePath, kind: "folder" },
    ...GENERATED.map(([label, path, kind]) => ({ label, path: join(workspacePath, path), kind })),
  ]
  return files.filter((file) => file.kind === "folder" || existsSync(file.path))
}

function redactSensitiveText(value: unknown) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/\\n[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "\\n[REDACTED_EMAIL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(const\s+password\s*=\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_PASSWORD]"')
    .replace(/(const\s+username\s*=\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_USERNAME]"')
    .replace(/(const\s+password\s*=\\?")([^"\\]*(?:\\.[^"\\]*)*)(\\?")/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/(const\s+username\s*=\\?")([^"\\]*(?:\\.[^"\\]*)*)(\\?")/gi, '$1[REDACTED_USERNAME]$3')
    .replace(/("password"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_PASSWORD]"')
    .replace(/("username"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_USERNAME]"')
    .replace(/("authorization"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_AUTH]"')
}

async function appendLog(workspacePath: string, kind: "agent" | "cua", message: string) {
  const path = join(workspacePath, "04_logs", kind === "agent" ? "agent_log.md" : "cua_log.md")
  const current = existsSync(path) ? await readFile(path, "utf8") : ""
  await writeFile(path, `${current}- ${new Date().toISOString()} ${redactSensitiveText(message)}\n`, "utf8")
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return fallback
  }
}

function makeTaskSlug(input: ApplicationTaskInput) {
  const raw = `${input.studentName}-${input.school}-${input.program}`
  return raw
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase()
}

function slugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .toLowerCase()
}

function createStableId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function makeDocx(text: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${text
      .split("\n")
      .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
      .join("\n")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
  return zipStore({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "word/document.xml": documentXml,
  })
}

function zipStore(files: Record<string, string>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name)
    const data = Buffer.from(content, "utf8")
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }
  const centralOffset = offset
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, end])
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
