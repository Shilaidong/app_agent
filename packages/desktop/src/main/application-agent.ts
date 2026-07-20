import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { app } from "electron"
import { writeOpenCodeConfig } from "./application-agent-opencode"
import {
  createStudentWorkspace,
  discoverApplicationTaskWorkspaces,
  studentWorkspaceLayout,
} from "./application-student-workspace"
import {
  completeApplicationRefillState,
  inspectApplicationRefillState,
  markApplicationRefillPromptSentState,
  prepareApplicationRefillState,
  validateApplicationRefillArtifacts,
  type ApplicationRefillAttempt,
} from "./application-agent-refill"
import { previewSelectionList, type SelectionListRow } from "./application-selection-list"
import { readJson, writeJson } from "./json-store"
import { isRecord } from "./util"
import {
  authorizeBrowserSafetyContinue as authorizeBrowserSafetyContinueState,
  browserSafetyStopSummary,
  type BrowserSafetyStopSummary,
} from "./application-agent-browser-safety"
import {
  buildMaterialReviewTrust,
  materialReviewTamperDetected,
  materialReviewTrustPath,
  type MaterialReviewTrust,
} from "./application-agent-material-review-gate"

export { buildApplicationAgentRefillPrompt, buildApplicationAgentStartPrompt } from "./application-agent-opencode"
export { applicationRefillSessionTitle } from "./application-agent-refill"
export { APPLICATION_AGENT_MODEL, APPLICATION_AGENT_MODEL_ID } from "./application-agent-model"
export type { ApplicationRefillAttempt } from "./application-agent-refill"
export type { BrowserSafetyStopSummary } from "./application-agent-browser-safety"

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

export type ApplicationOcrProgress = {
  phase: "running" | "done"
  current: number
  total: number
  startedAt: string
  avgSeconds: number
  etaAt: string
  finishedAt?: string
}

export type ApplicationMaterialReviewSummary = {
  status?: string
  mode?: string
  note?: string
  summary?: string
  submittedAt?: string
  preparationCompleteAt?: string
  reviewId?: string
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
  sharedDossierStatus?: "preparing" | "prepared" | "ready"
  browserSafetyStop?: BrowserSafetyStopSummary
  ocr?: ApplicationOcrProgress
  materialReviewTampered?: boolean
  materialReviewTamperMessage?: string
  browserHandoffPending?: boolean
  browserHandoffType?: string
  materialReview?: ApplicationMaterialReviewSummary
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
  | "等待顾问接管浏览器"
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
  ["浏览器审计状态", "03_state/cua_control.json", "json"],
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
  等待顾问接管浏览器: "浏览器正在等待顾问处理登录、验证码、原生弹窗或页面控制权；处理完成后点击“继续任务”。",
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
  const workspacePath = await uniqueWorkspacePath(slug, await taskWorkspaceParent(sanitizedInput))
  const sessionDirectory = workspacePath
  await createWorkspace(workspacePath, sanitizedInput)

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
      workspaceLayoutVersion: sanitizedInput.sharedWorkspacePath ? 2 : 1,
      batchId: sanitizedInput.batchId,
      batchWorkspacePath: sanitizedInput.batchWorkspacePath,
      batchOrder: sanitizedInput.batchOrder,
      selectionListPath: sanitizedInput.selectionListPath,
      selectionListRow: sanitizedInput.selectionListRow,
      sharedMaterialsPath: sanitizedInput.sourceFolder,
      sharedWorkspacePath: sanitizedInput.sharedWorkspacePath,
      sharedProfilePath: sanitizedInput.sharedWorkspacePath
        ? join(sanitizedInput.sharedWorkspacePath, "02_generated", "student_profile.md")
        : undefined,
      note: "学生材料、OCR、分类结果和学生核心档案由批次共享；学校要求、缺失项、浏览器进度和审计记录保持独立。",
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
  const invalidUrl = selections.find((selection) => {
    const url = String(selection.applicationUrl || selection.programUrl || "").trim()
    return url && !URL.canParse(url)
  })
  if (invalidUrl) throw new Error(`选校清单第 ${invalidUrl.rowNumber} 行的申请链接格式不正确，请修正后重试。`)

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const workspacePath = await uniqueWorkspacePath(`${slugPart(input.studentName)}-申请批次`)
  const layout = await createStudentWorkspace(workspacePath)
  await cp(input.sourceFolder, layout.sharedMaterialsPath, { recursive: true, force: false, errorOnExist: false })
  const copiedSelectionListPath = join(layout.selectionListPath, basename(input.selectionListPath))
  await cp(input.selectionListPath, copiedSelectionListPath, { force: false, errorOnExist: false })
  await writeJson(join(workspacePath, "03_state/selection_list_preview.json"), preview)
  await writeJson(layout.sharedDossierStatePath, {
    status: "preparing",
    version: 0,
    studentName: input.studentName.trim(),
    createdAt,
    updatedAt: createdAt,
    ownerTaskId: "",
    profilePath: layout.sharedProfilePath,
    note: "第一所学校完成材料整理后生成共享学生档案；后续学校只读复用。",
  })
  await writeJson(join(workspacePath, "03_state/batch_state.json"), {
    id,
    workspaceLayoutVersion: 2,
    createdAt,
    studentName: input.studentName.trim(),
    sourceFolder: input.sourceFolder,
    sharedWorkspacePath: layout.sharedWorkspacePath,
    sharedMaterialsPath: layout.sharedMaterialsPath,
    selectionListPath: copiedSelectionListPath,
    selectedRows: selections.map((row) => row.rowNumber),
    status: "待依次处理",
    materialHandling: "学生原始资料、OCR、分类结果和核心档案只整理一次；各学校仅保留本校要求、缺失项和浏览器进度。",
  })

  const tasks: ApplicationTask[] = []
  try {
    for (const [index, selection] of selections.entries()) {
      tasks.push(await createApplicationTask({
        studentName: input.studentName,
        sourceFolder: layout.sharedMaterialsPath,
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
        sharedWorkspacePath: layout.sharedWorkspacePath,
        batchOrder: index + 1,
        selectionListPath: copiedSelectionListPath,
        selectionListRow: selection.rowNumber,
      }))
      if (index === 0) {
        await writeJson(layout.sharedDossierStatePath, {
          status: "preparing",
          version: 0,
          studentName: input.studentName.trim(),
          createdAt,
          updatedAt: new Date().toISOString(),
          ownerTaskId: tasks[0].id,
          profilePath: layout.sharedProfilePath,
          note: "第一所学校负责一次性整理共享学生档案；后续学校只读复用。",
        })
      }
    }
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true })
    throw error
  }
  await writeJson(layout.sharedDossierStatePath, {
    status: "preparing",
    version: 0,
    studentName: input.studentName.trim(),
    createdAt,
    updatedAt: new Date().toISOString(),
    ownerTaskId: tasks[0]?.id || "",
    profilePath: layout.sharedProfilePath,
    note: "第一所学校负责一次性整理共享学生档案；后续学校只读复用。",
  })
  await writeJson(join(workspacePath, "03_state/batch_state.json"), {
    id,
    workspaceLayoutVersion: 2,
    createdAt,
    studentName: input.studentName.trim(),
    sourceFolder: input.sourceFolder,
    sharedWorkspacePath: layout.sharedWorkspacePath,
    sharedMaterialsPath: layout.sharedMaterialsPath,
    selectionListPath: copiedSelectionListPath,
    selectedRows: selections.map((row) => row.rowNumber),
    status: "待依次处理",
    materialHandling: "学生原始资料、OCR、分类结果和核心档案只整理一次；各学校仅保留本校要求、缺失项和浏览器进度。",
    tasks: tasks.map((task) => ({ id: task.id, workspacePath: task.workspacePath, school: task.input.school, program: task.input.program, order: task.input.batchOrder })),
  })
  return { id, workspacePath, sourceFolder: layout.sharedMaterialsPath, selectionListPath: copiedSelectionListPath, createdAt, tasks }
}

export async function getApplicationWorkspaceRoot() {
  const root = join(app.getPath("documents"), "Terra-Edu Application Agent", "application_workspaces")
  await mkdir(root, { recursive: true })
  return root
}

async function initializeCuaAuditState(workspacePath: string) {
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

async function setTaskPaused(workspacePath: string, paused: boolean, resumeStatus?: ApplicationTaskStatus) {
  const current = await readJson<{ resumeStatus?: ApplicationTaskStatus }>(join(workspacePath, "03_state/task_control.json"), {})
  await writeJson(join(workspacePath, "03_state/task_control.json"), {
    paused,
    updatedAt: new Date().toISOString(),
    reason: paused ? "顾问在任务工作台点击了暂停任务。" : "顾问在任务工作台点击了继续任务。",
    resumeStatus: paused ? resumeStatus || current.resumeStatus || "" : current.resumeStatus || "",
  })
}

export async function listApplicationTasks(limit = 8): Promise<ApplicationTask[]> {
  const root = await getApplicationWorkspaceRoot()
  const tasks: ApplicationTask[] = []
  for (const workspacePath of await discoverApplicationTaskWorkspaces(root)) {
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
    await initializeCuaAuditState(directory)
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
  const savedInput = await readJson<ApplicationTaskInput | null>(join(directory, "03_state/task_input.json"), null)
  const taskInput = savedInput ? await canonicalTaskInput(directory, savedInput) : null
  await writeOpenCodeConfig(directory, { sharedWorkspacePath: taskInput?.sharedWorkspacePath })
}

export async function getApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const [task, savedInput, missing, progress, control, materialReview, materialReviewTrust] = await Promise.all([
    readJson<Record<string, unknown>>(join(workspacePath, "03_state/task_state.json"), {}),
    readJson<ApplicationTaskInput | null>(join(workspacePath, "03_state/task_input.json"), null),
    readJson<unknown>(join(workspacePath, "03_state/missing_items.json"), null),
    readJson<unknown>(join(workspacePath, "03_state/application_progress.json"), null),
    readJson<{ paused?: boolean; updatedAt?: string }>(join(workspacePath, "03_state/task_control.json"), {}),
    readJson<Record<string, unknown>>(join(workspacePath, "03_state/material_review.json"), {}),
    readJson<MaterialReviewTrust | null>(materialReviewTrustPath(workspacePath), null),
  ])
  const canonicalInput = savedInput ? await canonicalTaskInput(workspacePath, savedInput) : undefined
  const totalFiles = (await scanTaskMaterials(workspacePath, canonicalInput)).length
  const normalized = normalizeTask(task, workspacePath, canonicalInput, summarizeMissingRaw(missing, totalFiles, progress))
  if (task && typeof task === "object" && task.ocr && typeof task.ocr === "object") {
    normalized.ocr = task.ocr as ApplicationOcrProgress
  }
  if (canonicalInput?.sharedWorkspacePath) {
    const sharedState = await readJson<{ status?: string }>(
      join(canonicalInput.sharedWorkspacePath, "03_state", "shared_dossier_state.json"),
      {},
    )
    if (["preparing", "prepared", "ready"].includes(String(sharedState.status || ""))) {
      normalized.sharedDossierStatus = sharedState.status as ApplicationTask["sharedDossierStatus"]
    }
  }
  const safety = browserSafetyStopSummary(progress)
  if (safety) normalized.browserSafetyStop = safety
  if (progress && typeof progress === "object") {
    const ego = (progress as { egoBrowser?: { handoffPending?: boolean; handoffAt?: string; handoffType?: string } }).egoBrowser
    if (ego) {
      const pending = ego.handoffPending === true || (Boolean(ego.handoffAt) && ego.handoffPending === undefined)
      if (pending) {
        normalized.browserHandoffPending = true
        normalized.browserHandoffType = ego.handoffType || "browser_takeover"
      }
    }
  }
  const egoPrepared = Boolean(
    progress &&
      typeof progress === "object" &&
      (progress as { egoBrowser?: { preparedAt?: string } }).egoBrowser?.preparedAt,
  )
  if (materialReview && typeof materialReview === "object") {
    normalized.materialReview = {
      status: stringValue(materialReview.status),
      mode: stringValue(materialReview.mode),
      note: stringValue(materialReview.note),
      summary: stringValue(materialReview.summary),
      submittedAt: stringValue(materialReview.submittedAt),
      preparationCompleteAt: stringValue(materialReview.preparationCompleteAt),
      reviewId: stringValue(materialReview.reviewId),
    }
    const pendingReview = materialReview.status === "pending"
    const approvedAwaitingPrep =
      materialReview.status === "approved" &&
      !Date.parse(String(materialReview.preparationCompleteAt || "")) &&
      !egoPrepared
    normalized.materialReviewNeedsConsultant = pendingReview || approvedAwaitingPrep
    // Sticky gate: while consultant has not finished the material-review panel path,
    // surface the waiting status even if the agent rewrote task_state.status.
    if (pendingReview && normalized.status !== "已暂停") {
      normalized.status = "等待顾问确认材料"
    }
  }
  if (materialReviewTamperDetected(materialReview, materialReviewTrust)) {
    normalized.materialReviewTampered = true
    normalized.materialReviewTamperMessage =
      "检测到材料审核记录可能被非桌面路径改写（缺少桌面授权校验）。任务已自动暂停；请顾问在材料确认面板重新确认，不要继续填表。"
    if (!control.paused) {
      await setTaskPaused(workspacePath, true, normalized.status === "已暂停" ? "可继续申请" : normalized.status)
      await appendLog(workspacePath, "agent", normalized.materialReviewTamperMessage)
    }
  }
  if (normalized.materialReviewTampered || control.paused) {
    const updatedAt = stringValue(control.updatedAt) ?? normalized.updatedAt
    return {
      ...normalized,
      updatedAt,
      status: "已暂停",
      progress: normalized.progress.at(-1)?.status === "已暂停"
        ? normalized.progress
        : [...normalized.progress, {
          at: updatedAt,
          status: "已暂停",
          message: normalized.materialReviewTamperMessage || STATUS_MESSAGES.已暂停,
        }],
    }
  }
  return normalized
}

export async function continueApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  await setTaskPaused(workspacePath, false)
  await appendProgress(task, "可继续申请")
  const allFiles = await scanTaskMaterials(workspacePath, task.input)
  const materials = await classifyMaterials(workspacePath, allFiles, task.input)
  const missingItems = inferMissingItems(task.input, materials)
  const progress = await readJson<ApplicationProgress>(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  await writeGeneratedDocuments(
    workspacePath,
    task.input,
    materials,
    missingItems,
    progress,
    Boolean(task.input.sharedWorkspacePath),
  )
  const materialReview = await readJson<Record<string, unknown>>(join(workspacePath, "03_state/material_review.json"), {})
  if (
    materialReview.status === "approved" &&
    !materialReview.preparationCompleteAt &&
    (materialReview.mode === "skip" || Date.parse(String(materialReview.appliedAt || "")))
  ) {
    await writeJson(join(workspacePath, "03_state/material_review.json"), {
      ...materialReview,
      preparationCompleteAt: new Date().toISOString(),
    })
  }

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
  const existingReview = await readJson<{ status?: string; preparationCompleteAt?: string }>(
    join(workspacePath, "03_state/material_review.json"),
    {},
  )
  const canSubmit =
    task.status === "等待顾问确认材料" ||
    existingReview.status === "pending" ||
    (existingReview.status === "approved" && !Date.parse(String(existingReview.preparationCompleteAt || "")))
  if (!canSubmit) {
    throw new Error("当前不在材料确认阶段，不能提交补充内容。")
  }

  const note = input.note?.trim() || ""
  if (input.mode === "note" && !note) {
    throw new Error("请填写要补充给 Agent 的文字信息，或选择暂不补充。")
  }

  const sourceFolder = input.sourceFolder?.trim() || ""
  const scope = task.input.sharedWorkspacePath && input.scope === "student" ? "student" : "school"
  let supplementalFolder = ""
  if (input.mode === "supplement_folder") {
    if (!sourceFolder || !existsSync(sourceFolder)) throw new Error("补充材料文件夹不存在，请重新选择。")
    if (!(await stat(sourceFolder)).isDirectory()) throw new Error("请选择包含补充材料的文件夹。")
    supplementalFolder = join(
      scope === "student" && task.input.sharedWorkspacePath
        ? join(task.input.sharedWorkspacePath, "00_original_backup")
        : join(workspacePath, "06_new_materials"),
      `supplement-${Date.now()}`,
    )
    await cp(sourceFolder, supplementalFolder, { recursive: true, force: false, errorOnExist: false })
  }

  const submittedAt = new Date().toISOString()
  const sourceManifest = supplementalFolder
    ? await Promise.all(
        (await scanFiles(supplementalFolder)).map(async (path) => ({ path, sha256: await fileSha256(path) })),
      )
    : []
  const profilePath = join(workspacePath, "02_generated", "student_profile.md")
  const sharedProfileCandidatePath = scope === "student" && task.input.sharedWorkspacePath
    ? join(workspacePath, "02_generated", "shared_profile_candidate.md")
    : ""
  if (sharedProfileCandidatePath) {
    const sharedProfilePath = join(task.input.sharedWorkspacePath!, "02_generated", "student_profile.md")
    if (!existsSync(sharedProfilePath)) throw new Error("学生共享档案缺少可更新的核心档案。")
    await cp(sharedProfilePath, sharedProfileCandidatePath, { force: true })
  }
  await updateSharedDossierAfterMaterialReview(task, input.mode, scope, submittedAt)
  const reviewId = randomUUID()
  // skip/note can proceed once the consultant has confirmed on desktop. supplement_folder
  // still waits for materials tools to apply hashes before preparationCompleteAt is stamped.
  const preparationCompleteAt =
    input.mode === "skip" || input.mode === "note" ? submittedAt : undefined
  await writeJson(join(workspacePath, "03_state/material_review.json"), {
    reviewId,
    status: "approved",
    mode: input.mode,
    scope,
    note,
    supplementalFolder: supplementalFolder || undefined,
    sourceManifest,
    profileSha256Before: existsSync(profilePath) ? await fileSha256(profilePath) : "",
    sharedProfileCandidatePath: sharedProfileCandidatePath || undefined,
    sharedProfileSha256Before: sharedProfileCandidatePath ? await fileSha256(sharedProfileCandidatePath) : undefined,
    submittedAt,
    preparationCompleteAt,
    noteAppliedAt: input.mode === "note" ? submittedAt : undefined,
  })
  await writeJson(
    materialReviewTrustPath(workspacePath),
    buildMaterialReviewTrust({ workspacePath, reviewId, submittedAt }),
  )
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

async function updateSharedDossierAfterMaterialReview(
  task: ApplicationTask,
  mode: ApplicationMaterialReviewInput["mode"],
  scope: "school" | "student",
  submittedAt: string,
) {
  if (!task.input.sharedWorkspacePath) return
  const path = join(task.input.sharedWorkspacePath, "03_state", "shared_dossier_state.json")
  const state = await readJson<Record<string, unknown>>(path, {})
  if (mode === "skip") {
    if (String(state.ownerTaskId || "") !== task.id || state.status === "ready") return
    if (state.status !== "prepared") {
      throw new Error("学生共享档案尚未准备完整，不能跳过材料确认后直接进入学校填表。")
    }
    await writeJson(path, {
      ...state,
      status: "ready",
      publishedAt: submittedAt,
      updatedAt: submittedAt,
    })
    return
  }
  if (scope !== "student") return
  await writeJson(path, {
    ...state,
    status: "preparing",
    ownerTaskId: task.id,
    publishedAt: "",
    updatedAt: submittedAt,
    note: "顾问已补充材料或文字；资料库负责人完成更新并重新生成文档后才会发布新版本。",
  })
}

/** Rebuild shared_dossier_state hashes/status for a batch that was corrupted or half-published. */
export async function repairApplicationSharedDossier(workspacePath: string): Promise<{
  status: "prepared" | "ready"
  sharedWorkspacePath: string
  version: number
}> {
  const task = await getApplicationTask(workspacePath)
  const sharedWorkspacePath = task.input.sharedWorkspacePath
  if (!sharedWorkspacePath) throw new Error("当前任务不是选校批次共享资料库任务，无法修复共享档案。")
  const generated = join(sharedWorkspacePath, "02_generated")
  const statePath = join(sharedWorkspacePath, "03_state", "shared_dossier_state.json")
  const profile = join(generated, "student_profile.md")
  const materialsIndex = join(sharedWorkspacePath, "03_state", "materials_index.json")
  const ocrIndex = join(sharedWorkspacePath, "03_state", "ocr_index.json")
  const materials = join(sharedWorkspacePath, "00_original_backup")
  const classified = join(sharedWorkspacePath, "01_classified_materials")
  const extractedText = join(sharedWorkspacePath, "03_state", "extracted_text")
  const schoolProfile = join(workspacePath, "02_generated", "student_profile.md")
  const schoolMaterialsIndex = join(workspacePath, "03_state", "materials_index.json")
  if (!existsSync(profile) && existsSync(schoolProfile)) {
    await mkdir(generated, { recursive: true })
    await cp(schoolProfile, profile, { force: true })
  }
  if (!existsSync(materialsIndex) && existsSync(schoolMaterialsIndex)) {
    await mkdir(join(sharedWorkspacePath, "03_state"), { recursive: true })
    await cp(schoolMaterialsIndex, materialsIndex, { force: true })
  }
  if (!existsSync(profile) || !existsSync(materialsIndex)) {
    throw new Error("共享档案仍缺少 student_profile.md 或 materials_index.json，无法修复。")
  }
  const review = await readJson<{ status?: string; mode?: string }>(join(workspacePath, "03_state/material_review.json"), {})
  const trust = await readJson<MaterialReviewTrust | null>(materialReviewTrustPath(workspacePath), null)
  const ready = review.status === "approved" && Boolean(trust?.reviewId) && (review.mode === "skip" || Boolean(review))
  const previous = await readJson<Record<string, unknown>>(statePath, {})
  const now = new Date().toISOString()
  const hashTree = async (root: string) => {
    const files = existsSync(root) ? await scanFiles(root) : []
    const records = await Promise.all(
      files.sort().map(async (file) => relative(root, file).replaceAll("\\", "/") + "\0" + await fileSha256(file)),
    )
    return createHash("sha256").update(records.join("\n")).digest("hex")
  }
  const hashes = {
    studentProfileSha256: await fileSha256(profile),
    materialsIndexSha256: await fileSha256(materialsIndex),
    ocrIndexSha256: existsSync(ocrIndex) ? await fileSha256(ocrIndex) : "",
    rawMaterialsSha256: await hashTree(materials),
    classifiedMaterialsSha256: await hashTree(classified),
    extractedTextSha256: await hashTree(extractedText),
  }
  const status = ready ? "ready" as const : "prepared" as const
  const version = Math.max(1, Number(previous.version || 0) + 1)
  await writeJson(statePath, {
    ...previous,
    status,
    version,
    ownerTaskId: previous.ownerTaskId || task.id,
    profilePath: profile,
    materialsIndexPath: materialsIndex,
    ocrIndexPath: ocrIndex,
    hashes,
    preparedAt: previous.preparedAt || now,
    publishedAt: status === "ready" ? now : "",
    updatedAt: now,
    repairedAt: now,
  })
  await appendLog(workspacePath, "agent", "已修复学生共享档案状态为 " + status + "（version " + version + "）。")
  return { status, sharedWorkspacePath, version }
}

export async function pauseApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  await setTaskPaused(workspacePath, true, task.status)
  await appendLog(workspacePath, "agent", "顾问已暂停任务。当前正在执行的浏览器回合或单项处理会完成，但不会启动新的浏览器回合或后续步骤；继续前需顾问点击继续任务。")
  return getApplicationTask(workspacePath)
}

export async function resumeApplicationTask(workspacePath: string): Promise<ApplicationTask> {
  await setTaskPaused(workspacePath, false)
  const task = await getApplicationTask(workspacePath)
  if (task.status === "已暂停") {
    const control = await readJson<{ resumeStatus?: ApplicationTaskStatus }>(join(workspacePath, "03_state/task_control.json"), {})
    const materialReview = await readJson<{ status?: string }>(join(workspacePath, "03_state/material_review.json"), {})
    const progress = await readJson<{ egoBrowser?: { handoffAt?: string; handoffPending?: boolean; handoffType?: string } }>(join(workspacePath, "03_state/application_progress.json"), {})
    await appendProgress(
      task,
      control.resumeStatus && control.resumeStatus !== "已暂停"
        ? control.resumeStatus
        : materialReview.status === "pending"
          ? "等待顾问确认材料"
          : progress.egoBrowser?.handoffPending === true || (progress.egoBrowser?.handoffAt && progress.egoBrowser?.handoffPending === undefined)
            ? progress.egoBrowser.handoffType === "login"
              ? "等待顾问登录"
              : "等待顾问接管浏览器"
          : "可继续申请",
    )
  }
  await appendLog(workspacePath, "agent", "顾问已继续任务。Agent 将从已保存的任务状态和审计记录重新观察后开始下一步；如浏览器仍由顾问控制，不会自动夺回控制权。")
  return getApplicationTask(workspacePath)
}

export async function authorizeBrowserSafetyContinue(
  workspacePath: string,
  input: { decisionId: string; taskSpaceId: string },
): Promise<ApplicationTask> {
  await authorizeBrowserSafetyContinueState(workspacePath, input)
  const task = await getApplicationTask(workspacePath)
  await appendProgress(task, "正在填写申请平台")
  return getApplicationTask(workspacePath)
}

export async function refreshApplicationTaskDocuments(workspacePath: string): Promise<ApplicationTask> {
  const task = await getApplicationTask(workspacePath)
  const materials = await readJson<MaterialRecord[]>(join(workspacePath, "03_state/materials_index.json"), [])
  const missingRaw = await readJson<unknown>(join(workspacePath, "03_state/missing_items.json"), [])
  const progress = await readJson<ApplicationProgress>(join(workspacePath, "03_state/application_progress.json"), initialApplicationProgress())
  const syncedMissingItems = syncMissingItemsWithProgress(normalizeMissingItems(missingRaw), progress)
  await writeGeneratedDocuments(
    workspacePath,
    task.input,
    materials,
    syncedMissingItems,
    progress,
    Boolean(task.input.sharedWorkspacePath),
  )

  const activeMissingItems = filterActiveMissingItems(syncedMissingItems)
  const totalFiles = (await scanTaskMaterials(workspacePath, task.input)).length
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

export async function prepareApplicationRefillAttempt(
  workspacePath: string,
  requestID: string,
  sourceSessionID?: string,
): Promise<ApplicationRefillAttempt> {
  const task = await getApplicationTask(workspacePath)
  await syncSharedDossierSnapshot(task)
  const result = await prepareApplicationRefillState({ workspacePath, task, requestID, sourceSessionID })
  if (!result.created) return result.attempt
  await setTaskPaused(workspacePath, false)
  await appendProgress(task, "正在填写申请平台")
  await appendLog(
    workspacePath,
    "agent",
    `顾问已创建第 ${result.attempt.ordinal} 次重新填写：复用既有整理产物，新建 OpenCode 对话和独立 Ego task space；旧浏览器进度已归档到 ${result.attempt.progressArchivePath}。`,
  )
  return result.attempt
}

export async function validateApplicationRefillReadiness(workspacePath: string): Promise<void> {
  const task = await getApplicationTask(workspacePath)
  await syncSharedDossierSnapshot(task)
  await validateApplicationRefillArtifacts(workspacePath, task)
}

async function syncSharedDossierSnapshot(task: ApplicationTask) {
  if (!task.input.sharedWorkspacePath) return
  const state = await readJson<Record<string, unknown>>(
    join(task.input.sharedWorkspacePath, "03_state", "shared_dossier_state.json"),
    {},
  )
  if (state.status !== "ready") {
    throw new Error("学生共享档案尚未完成材料确认，不能开始重新填写。")
  }
  const profile = join(task.input.sharedWorkspacePath, "02_generated", "student_profile.md")
  const materialsIndex = join(task.input.sharedWorkspacePath, "03_state", "materials_index.json")
  if (!existsSync(profile) || !existsSync(materialsIndex)) {
    throw new Error("学生共享档案不完整：缺少学生核心档案或材料索引。")
  }
  const hashes = isRecord(state.hashes) ? state.hashes : {}
  const ocrIndex = join(task.input.sharedWorkspacePath, "03_state", "ocr_index.json")
  if (
    (typeof hashes.studentProfileSha256 === "string" && hashes.studentProfileSha256 !== await fileSha256(profile)) ||
    (typeof hashes.materialsIndexSha256 === "string" && hashes.materialsIndexSha256 !== await fileSha256(materialsIndex)) ||
    (typeof hashes.ocrIndexSha256 === "string" && hashes.ocrIndexSha256 && (!existsSync(ocrIndex) || hashes.ocrIndexSha256 !== await fileSha256(ocrIndex))) ||
    (typeof hashes.rawMaterialsSha256 !== "string" || hashes.rawMaterialsSha256 !== await directorySha256(join(task.input.sharedWorkspacePath, "00_original_backup"))) ||
    (typeof hashes.classifiedMaterialsSha256 !== "string" || hashes.classifiedMaterialsSha256 !== await directorySha256(join(task.input.sharedWorkspacePath, "01_classified_materials"))) ||
    (typeof hashes.extractedTextSha256 !== "string" || hashes.extractedTextSha256 !== await directorySha256(join(task.input.sharedWorkspacePath, "03_state", "extracted_text")))
  ) {
    throw new Error("学生共享档案在发布后发生变化，已停止重新填写；请重新确认学生资料库。")
  }
  const localProfile = join(task.workspacePath, "02_generated", "student_profile.md")
  const localMaterialsIndex = join(task.workspacePath, "03_state", "materials_index.json")
  const localOcrIndex = join(task.workspacePath, "03_state", "ocr_index.json")
  await Promise.all([
    cp(profile, join(task.workspacePath, "02_generated", "shared_student_profile.md"), { force: true }),
    cp(materialsIndex, join(task.workspacePath, "03_state", "shared_materials_index.json"), { force: true }),
    existsSync(localProfile) ? Promise.resolve() : cp(profile, localProfile, { force: true }),
    existsSync(localMaterialsIndex) ? Promise.resolve() : cp(materialsIndex, localMaterialsIndex, { force: true }),
    existsSync(ocrIndex)
      ? cp(
          ocrIndex,
          join(task.workspacePath, "03_state", "shared_ocr_index.json"),
          { force: true },
        )
      : Promise.resolve(),
    existsSync(ocrIndex) && !existsSync(localOcrIndex)
      ? cp(ocrIndex, localOcrIndex, { force: true })
      : Promise.resolve(),
  ])
  await writeJson(join(task.workspacePath, "03_state", "shared_dossier_snapshot.json"), {
    status: "ready",
    reusedSharedDossier: true,
    sharedWorkspacePath: task.input.sharedWorkspacePath,
    version: Number(state.version || 1),
    publishedAt: state.publishedAt || state.updatedAt || "",
    synchronizedAt: new Date().toISOString(),
  })
}

async function fileSha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function directorySha256(path: string) {
  const files = existsSync(path) ? await scanFiles(path) : []
  const records = await Promise.all(
    files.sort().map(async (file) => `${relative(path, file).replaceAll("\\", "/")}\\0${await fileSha256(file)}`),
  )
  return createHash("sha256").update(records.join("\n")).digest("hex")
}

export async function inspectApplicationRefillAttempt(
  workspacePath: string,
  requestID: string,
): Promise<ApplicationRefillAttempt | undefined> {
  const task = await getApplicationTask(workspacePath)
  return inspectApplicationRefillState({ workspacePath, task, requestID })
}

export async function completeApplicationRefillAttempt(
  workspacePath: string,
  attemptID: string,
  sessionID: string,
): Promise<ApplicationRefillAttempt> {
  const result = await completeApplicationRefillState(workspacePath, attemptID, sessionID)
  if (result.changed) {
    await appendLog(workspacePath, "agent", `第 ${result.attempt.ordinal} 次重新填写已绑定全新 OpenCode 对话 ${sessionID.trim()}。`)
  }
  return result.attempt
}

export async function markApplicationRefillPromptSent(
  workspacePath: string,
  attemptID: string,
  sessionID: string,
): Promise<ApplicationRefillAttempt> {
  return (await markApplicationRefillPromptSentState(workspacePath, attemptID, sessionID)).attempt
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
  if (input.sharedWorkspacePath && !input.batchWorkspacePath) throw new Error("学生共享资料库必须属于选校批次")
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
  return tasks.find((task) => {
    if (!isSameApplicationInput(task.input, input)) return false
    if (!input.batchId) return !task.input.batchId
    return task.input.batchId === input.batchId
  }) ?? null
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

async function uniqueWorkspacePath(slug: string, parent?: string) {
  const root = parent || await getApplicationWorkspaceRoot()
  await mkdir(root, { recursive: true })
  let candidate = join(root, slug)
  let index = 2
  while (existsSync(candidate)) {
    candidate = join(root, `${slug}-${index}`)
    index += 1
  }
  return candidate
}

async function taskWorkspaceParent(input: ApplicationTaskInput) {
  const root = await getApplicationWorkspaceRoot()
  if (!input.batchWorkspacePath) return root

  const canonicalRoot = await realpath(root)
  const requestedBatchWorkspacePath = resolve(input.batchWorkspacePath)
  const batchWorkspacePath = await realpath(requestedBatchWorkspacePath)
  const child = relative(canonicalRoot, batchWorkspacePath)
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("选校批次工作区不属于 Terra-Edu 申请目录")
  }
  if (requestedBatchWorkspacePath !== batchWorkspacePath) {
    throw new Error("选校批次工作区不能是符号链接")
  }
  const batchState = await readJson<Record<string, unknown> | null>(
    join(batchWorkspacePath, "03_state", "batch_state.json"),
    null,
  )
  if (!batchState) {
    throw new Error("选校批次状态不存在，不能在该目录创建学校任务")
  }
  if (
    Number(batchState.workspaceLayoutVersion || 0) !== 2 ||
    String(batchState.id || "") !== String(input.batchId || "") ||
    normalizeComparable(String(batchState.studentName || "")) !== normalizeComparable(input.studentName)
  ) {
    throw new Error("选校批次身份与当前学校任务不匹配")
  }
  const expectedSharedWorkspacePath = studentWorkspaceLayout(batchWorkspacePath).sharedWorkspacePath
  const expectedSchoolsPath = join(batchWorkspacePath, "schools")
  if (
    resolve(input.sharedWorkspacePath || "") !== expectedSharedWorkspacePath ||
    resolve(String(batchState.sharedWorkspacePath || "")) !== expectedSharedWorkspacePath ||
    resolve(input.sourceFolder) !== join(expectedSharedWorkspacePath, "00_original_backup") ||
    await realpath(expectedSharedWorkspacePath) !== expectedSharedWorkspacePath ||
    await realpath(expectedSchoolsPath) !== expectedSchoolsPath
  ) {
    throw new Error("学生共享资料库路径与选校批次不匹配")
  }
  return expectedSchoolsPath
}

async function canonicalTaskInput(workspacePath: string, input: ApplicationTaskInput) {
  const canonicalWorkspacePath = await realpath(workspacePath)
  const schoolsPath = dirname(canonicalWorkspacePath)
  const batchWorkspacePath = dirname(schoolsPath)
  const batchState = basename(schoolsPath) === "schools"
    ? await readJson<Record<string, unknown> | null>(join(batchWorkspacePath, "03_state", "batch_state.json"), null)
    : null
  if (Number(batchState?.workspaceLayoutVersion || 0) !== 2) {
    return { ...input, sharedWorkspacePath: undefined }
  }

  const canonicalRoot = await realpath(await getApplicationWorkspaceRoot())
  const child = relative(canonicalRoot, batchWorkspacePath)
  const sharedWorkspacePath = join(batchWorkspacePath, "shared")
  if (
    !child ||
    child.startsWith("..") ||
    isAbsolute(child) ||
    await realpath(schoolsPath) !== schoolsPath ||
    await realpath(sharedWorkspacePath) !== sharedWorkspacePath ||
    String(batchState?.id || "") !== String(input.batchId || "") ||
    normalizeComparable(String(batchState?.studentName || "")) !== normalizeComparable(input.studentName) ||
    resolve(String(batchState?.sharedWorkspacePath || "")) !== sharedWorkspacePath
  ) {
    throw new Error("学校任务与学生共享资料库的绑定已失效，已拒绝加载以避免跨学生读取。")
  }
  return {
    ...input,
    batchWorkspacePath,
    sharedWorkspacePath,
    sourceFolder: join(sharedWorkspacePath, "00_original_backup"),
  }
}

async function createWorkspace(workspacePath: string, input?: ApplicationTaskInput) {
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
  await writeOpenCodeConfig(workspacePath, { sharedWorkspacePath: input?.sharedWorkspacePath })
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
    if (currentStep.includes("cua_handoff") || currentStep.includes("handoff")) return "等待顾问接管浏览器"
    if (currentStep.includes("cua") || currentStep.includes("form")) return "正在填写申请平台"
    if (currentStep.includes("summary")) return "阶段性完成"
  }
  if (status === "in_progress") return "正在检查缺失内容"
  if (status === "completed") return "阶段性完成"
  if (status === "error") return "异常中断"
  return "已创建"
}

async function scanTaskMaterials(workspacePath: string, input?: ApplicationTaskInput) {
  const sharedMaterialsPath = input?.sharedWorkspacePath
    ? join(input.sharedWorkspacePath, "00_original_backup")
    : ""
  const roots = [
    sharedMaterialsPath && existsSync(sharedMaterialsPath) ? sharedMaterialsPath : join(workspacePath, "00_original_backup"),
    join(workspacePath, "06_new_materials"),
  ].filter(existsSync)
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

async function classifyMaterials(
  workspacePath: string,
  files: string[],
  input?: ApplicationTaskInput,
): Promise<MaterialRecord[]> {
  const records: MaterialRecord[] = []
  const sharedWorkspacePath = input?.sharedWorkspacePath && existsSync(input.sharedWorkspacePath)
    ? input.sharedWorkspacePath
    : ""
  const backupRoot = sharedWorkspacePath
    ? join(sharedWorkspacePath, "00_original_backup")
    : join(workspacePath, "00_original_backup")
  const classifiedRoot = sharedWorkspacePath
    ? join(sharedWorkspacePath, "01_classified_materials")
    : join(workspacePath, "01_classified_materials")
  const sharedMaterialsIndex = sharedWorkspacePath
    ? join(sharedWorkspacePath, "03_state", "materials_index.json")
    : ""
  if (sharedMaterialsIndex && existsSync(sharedMaterialsIndex)) {
    const sharedRecords = await readJson<MaterialRecord[]>(sharedMaterialsIndex, [])
    await writeJson(join(workspacePath, "03_state/materials_index.json"), sharedRecords)
    await writeFile(join(workspacePath, "02_generated/materials_index.md"), renderMaterialsIndex(sharedRecords, backupRoot), "utf8")
    return sharedRecords
  }
  for (const file of files) {
    const fileName = basename(file)
    const match = classifyFile(fileName)
    const categoryDir = join(classifiedRoot, CATEGORY_DIRS[match.category])
    await mkdir(categoryDir, { recursive: true })
    const target = await uniqueFilePath(join(categoryDir, fileName))
    await cp(file, target, { force: false, errorOnExist: false })
    records.push({
      originalPath: file,
      backupPath: sharedWorkspacePath ? file : relative(workspacePath, file),
      classifiedPath: sharedWorkspacePath ? target : relative(workspacePath, target),
      fileName,
      extension: extname(fileName).toLowerCase(),
      category: match.category,
      confidence: match.confidence,
      reason: match.reason,
    })
  }
  await writeJson(join(workspacePath, "03_state/materials_index.json"), records)
  if (sharedWorkspacePath) {
    await writeJson(join(sharedWorkspacePath, "03_state/materials_index.json"), records)
    await writeFile(join(sharedWorkspacePath, "02_generated/materials_index.md"), renderMaterialsIndex(records, backupRoot), "utf8")
  }
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

async function writeGeneratedDocuments(
  workspacePath: string,
  input: ApplicationTaskInput,
  materials: MaterialRecord[],
  missingItems: MissingItem[],
  applicationProgress: ApplicationProgress,
  preserveStudentProfile = false,
) {
  const syncedMissingItems = syncMissingItemsWithProgress(normalizeMissingItems(missingItems), applicationProgress)
  const activeMissingItems = filterActiveMissingItems(syncedMissingItems)
  await writeJson(join(workspacePath, "03_state/missing_items.json"), syncedMissingItems)
  await writeJson(join(workspacePath, "03_state/application_progress.json"), applicationProgress)
  const studentProfilePath = join(workspacePath, "02_generated/student_profile.md")
  if (!preserveStudentProfile || !existsSync(studentProfilePath)) {
    await writeFile(studentProfilePath, renderStudentProfile(input, materials), "utf8")
  }
  await writeFile(join(workspacePath, "02_generated/info_collection_form.md"), renderInfoCollection(input, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/material_collection_form.md"), renderMaterialCollection(input, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/task_summary.md"), renderTaskSummary(input, materials, activeMissingItems), "utf8")
  await writeFile(join(workspacePath, "02_generated/missing_materials.docx"), makeDocx(renderWordChecklistData(input, activeMissingItems)))
}

function renderStudentProfile(input: ApplicationTaskInput, materials: MaterialRecord[]) {
  return `# ${input.studentName} 学生核心档案

> 本文件只记录能够由材料或顾问确认的学生事实，可供同一学生的多所学校申请只读复用。学校、项目、截止日期、学校特定问题和文书答案必须保存在各学校任务中，不得写入本档案。

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

## 活动、奖项与推荐人事实

待从简历和推荐材料中提取可跨学校复用的客观事实。学校特定文书观点和问题答案不得写入这里；推荐信邀请属于高风险动作，不能自动发送。

## 已有材料目录

${materials.map((item) => `- ${item.fileName} → ${item.classifiedPath}（${item.category}，${item.confidence}，${item.reason}）`).join("\n") || "- 暂未识别到材料"}

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

function renderWordChecklistData(input: ApplicationTaskInput, missingItems: MissingItem[]) {
  const includedItems = missingItems.filter((item) => item.addedToWordList !== false)
  return {
    title: `${input.studentName} 补充材料清单`,
    school: input.school,
    program: input.program,
    intro: "请按以下要求补充材料或信息。补齐后请发给顾问，或放入指定补充材料文件夹。",
    rows: includedItems.map((item, index) => ({
      index: String(index + 1),
      name: item.name,
      whyNeeded: item.whyNeeded,
      prepareFrom: item.prepareFrom,
      formatRequirement: item.formatRequirement,
    })),
    footer: "说明：最终提交申请、付款和推荐信邀请需由顾问人工确认完成。",
  }
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

function makeTaskSlug(input: ApplicationTaskInput) {
  if (input.batchWorkspacePath) {
    return `${String(input.batchOrder || 0).padStart(2, "0")}-${slugPart(input.school)}-${slugPart(input.program)}`
  }
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

function paragraphXml(text: string, bold = false) {
  const run = bold
    ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
    : `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  return `<w:p>${run}</w:p>`
}

function cellXml(text: string, width: number, header = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="E8F0E9"/>` : ""}</w:tcPr>${paragraphXml(text, header)}</w:tc>`
}

function makeDocx(checklist: {
  title: string
  school: string
  program: string
  intro: string
  rows: Array<{ index: string; name: string; whyNeeded: string; prepareFrom: string; formatRequirement: string }>
  footer: string
}): Buffer {
  const widths = [700, 2200, 2800, 2800, 2200]
  const headers = ["序号", "缺失项", "为什么需要", "如何准备", "文件格式"]
  let table = `<w:tbl><w:tblPr><w:tblW w:w="10700" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C8B8"/><w:left w:val="single" w:sz="4" w:color="B7C8B8"/><w:bottom w:val="single" w:sz="4" w:color="B7C8B8"/><w:right w:val="single" w:sz="4" w:color="B7C8B8"/><w:insideH w:val="single" w:sz="4" w:color="B7C8B8"/><w:insideV w:val="single" w:sz="4" w:color="B7C8B8"/></w:tblBorders></w:tblPr><w:tr>${headers.map((header, index) => cellXml(header, widths[index], true)).join("")}</w:tr>`
  if (checklist.rows.length === 0) {
    table += `<w:tr>${cellXml("—", widths[0])}${cellXml("当前没有需要补充的材料或信息。", widths[1] + widths[2] + widths[3] + widths[4])}</w:tr>`
  } else {
    for (const row of checklist.rows) {
      table += `<w:tr>${[
        cellXml(row.index, widths[0]),
        cellXml(row.name, widths[1]),
        cellXml(row.whyNeeded, widths[2]),
        cellXml(row.prepareFrom, widths[3]),
        cellXml(row.formatRequirement, widths[4]),
      ].join("")}</w:tr>`
    }
  }
  table += "</w:tbl>"
  const body = [
    paragraphXml(checklist.title, true),
    paragraphXml(`申请学校：${checklist.school}`),
    paragraphXml(`申请项目：${checklist.program}`),
    paragraphXml(checklist.intro),
    paragraphXml(""),
    table,
    paragraphXml(""),
    paragraphXml(checklist.footer),
  ].join("")
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>
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
