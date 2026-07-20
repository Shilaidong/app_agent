import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import type { ApplicationTask } from "./application-agent"
import { readJson, writeJsonAtomic } from "./json-store"
import { isRecord } from "./util"

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

export function applicationRefillSessionTitle(task: ApplicationTask, attempt: ApplicationRefillAttempt) {
  return `重新填写 #${attempt.ordinal}：${task.input.studentName} / ${task.input.school} / ${task.input.program} [refill:${attempt.id}]`
}

export async function validateApplicationRefillArtifacts(workspacePath: string, task: ApplicationTask) {
  const requiredJson = async (relativePath: string, label: string) =>
    readFile(join(workspacePath, relativePath), "utf8")
      .then((contents) => JSON.parse(contents) as unknown)
      .catch(() => {
        throw new Error(`不能开始重新填写：${label}缺失或格式错误（${relativePath}）。请先回到原任务修复该整理产物。`)
      })
  const [taskState, materialsIndex, applicationRequirements, missingItems, applicationProgress, materialReview, studentProfile] = await Promise.all([
    requiredJson("03_state/task_state.json", "任务状态"),
    requiredJson("03_state/materials_index.json", "材料目录"),
    requiredJson("03_state/application_requirements.json", "申请要求"),
    requiredJson("03_state/missing_items.json", "缺失项记录"),
    requiredJson("03_state/application_progress.json", "申请进度"),
    requiredJson("03_state/material_review.json", "材料确认记录"),
    readFile(join(workspacePath, "02_generated/student_profile.md"), "utf8").catch(() => ""),
  ])
  if (!isRecord(taskState)) throw new Error("不能开始重新填写：03_state/task_state.json 不是有效任务状态。")
  if (!Array.isArray(materialsIndex) || materialsIndex.length === 0) {
    throw new Error("不能开始重新填写：03_state/materials_index.json 中没有可复用材料。请先完成原任务的材料整理。")
  }
  if (!isRecord(applicationRequirements)) {
    throw new Error("不能开始重新填写：03_state/application_requirements.json 不是有效申请要求记录。")
  }
  if (!Array.isArray(missingItems) && !isRecord(missingItems)) {
    throw new Error("不能开始重新填写：03_state/missing_items.json 不是有效缺失项记录。")
  }
  if (!isRecord(applicationProgress)) {
    throw new Error("不能开始重新填写：03_state/application_progress.json 不是有效申请进度。")
  }
  if (!isRecord(materialReview) || materialReview.status !== "approved") {
    throw new Error("不能开始重新填写：材料尚未由顾问确认。请先在原任务完成材料确认，再新建填表对话。")
  }
  if (!(await materialReviewPreparationComplete(workspacePath, materialReview))) {
    throw new Error("不能开始重新填写：顾问刚补充的文件或文字尚未同步到学生档案。原 Agent 会继续 OCR、分类和更新档案；完成后再点击“根据现有内容重新填写”。")
  }
  if (!studentProfile.trim()) {
    throw new Error("不能开始重新填写：02_generated/student_profile.md 为空。请先在原任务生成完整学生申请档案。")
  }
  if (!task.input.applicationUrl?.trim()) {
    throw new Error("不能开始重新填写：当前学校任务没有申请平台链接。请先补充链接，再新建填表对话。")
  }
  if (!URL.canParse(task.input.applicationUrl)) {
    throw new Error("不能开始重新填写：当前申请平台链接格式不正确。请先修正链接，再新建填表对话。")
  }
  return applicationProgress
}

export async function inspectApplicationRefillState(input: {
  workspacePath: string
  task: ApplicationTask
  requestID: string
}) {
  const requestID = input.requestID.trim()
  if (!requestID) throw new Error("重新填写请求缺少 requestID，请关闭确认面板后重试。")

  const attempts = await readAttempts(join(input.workspacePath, "03_state/filling_attempts.json"))
  const existing = attempts.find((attempt) => attempt.requestID === requestID)
  if (existing) {
    if (attempts.at(-1)?.id !== existing.id) {
      throw new Error("本次重新填写请求已被更新的填写会话取代；为避免回退到旧对话，已拒绝恢复该请求。")
    }
    return existing
  }
  const unfinished = attempts.at(-1)
  if (unfinished && (
    (unfinished.status === "prepared" && !unfinished.sessionID) ||
    (unfinished.status === "session_created" && unfinished.sessionID && !unfinished.promptSentAt)
  )) return unfinished
  await validateApplicationRefillArtifacts(input.workspacePath, input.task)
  return undefined
}

export async function prepareApplicationRefillState(input: {
  workspacePath: string
  task: ApplicationTask
  requestID: string
  sourceSessionID?: string
}) {
  const requestID = input.requestID.trim()
  if (!requestID) throw new Error("重新填写请求缺少 requestID，请关闭确认面板后重试。")

  const attemptsPath = join(input.workspacePath, "03_state/filling_attempts.json")
  const recoverable = await inspectApplicationRefillState({
    workspacePath: input.workspacePath,
    task: input.task,
    requestID,
  })
  const attempts = await readAttempts(attemptsPath)
  if (recoverable) {
    const progressPath = join(input.workspacePath, "03_state/application_progress.json")
    const progress = await readJson<Record<string, unknown>>(progressPath, {})
    if (!isRecord(progress.refillAttempt) || progress.refillAttempt.id !== recoverable.id) {
      await writeJsonAtomic(
        progressPath,
        applicationProgress(input.task, recoverable),
      )
    } else if (recoverable.sessionID && (
      progress.refillAttempt.sessionID !== recoverable.sessionID ||
      (recoverable.promptSentAt && progress.refillAttempt.promptSentAt !== recoverable.promptSentAt)
    )) {
      await writeJsonAtomic(progressPath, {
        ...progress,
        refillAttempt: {
          ...progress.refillAttempt,
          sessionID: recoverable.sessionID,
          promptSentAt: recoverable.promptSentAt,
        },
      })
    }
    return { attempt: recoverable, created: false }
  }

  const previousProgress = await validateApplicationRefillArtifacts(input.workspacePath, input.task)
  const id = randomUUID()
  const ordinal = attempts.length + 1
  const createdAt = new Date().toISOString()
  const attempt: ApplicationRefillAttempt = {
    id,
    requestID,
    workspacePath: input.workspacePath,
    ordinal,
    createdAt,
    status: "prepared",
    sourceSessionID: input.sourceSessionID?.trim() || undefined,
    taskSpaceName: [
      "Terra-Edu",
      input.task.input.studentName,
      input.task.input.school,
      input.task.input.program,
      `重新填写 ${ordinal}`,
      id.slice(0, 8),
    ].filter(Boolean).join(" / "),
    progressArchivePath: join(
      "03_state",
      "filling_attempts",
      `${String(ordinal).padStart(3, "0")}-${id}-application_progress.json`,
    ),
    reusedArtifacts: [
      "00_original_backup",
      "01_classified_materials",
      "03_state/materials_index.json",
      "02_generated/student_profile.md",
      "03_state/application_requirements.json",
      "03_state/missing_items.json",
      "03_state/material_review.json",
    ],
    batchId: input.task.input.batchId,
    batchOrder: input.task.input.batchOrder,
  }
  await writeJsonAtomic(join(input.workspacePath, attempt.progressArchivePath), previousProgress)
  await writeJsonAtomic(attemptsPath, [...attempts, attempt])
  await writeJsonAtomic(
    join(input.workspacePath, "03_state/application_progress.json"),
    applicationProgress(input.task, attempt),
  )
  return { attempt, created: true }
}

export async function completeApplicationRefillState(workspacePath: string, attemptID: string, sessionID: string) {
  const normalizedSessionID = sessionID.trim()
  if (!normalizedSessionID) throw new Error("OpenCode 会话 ID 为空，不能完成重新填写会话绑定。")
  const attemptsPath = join(workspacePath, "03_state/filling_attempts.json")
  const attempts = await readAttempts(attemptsPath)
  const attempt = attempts.find((item) => item.id === attemptID)
  if (!attempt) throw new Error("找不到本次重新填写记录，请重新点击“重新填写”。")
  if (attempt.sessionID && attempt.sessionID !== normalizedSessionID) {
    throw new Error("本次重新填写已绑定另一个 OpenCode 对话，已拒绝重复创建。")
  }
  const completed: ApplicationRefillAttempt = {
    ...attempt,
    status: "session_created",
    sessionID: normalizedSessionID,
  }
  const changed = attempt.sessionID !== normalizedSessionID || attempt.status !== "session_created"
  if (changed) {
    await writeJsonAtomic(attemptsPath, attempts.map((item) => item.id === attemptID ? completed : item))
  }
  const progressPath = join(workspacePath, "03_state/application_progress.json")
  const progress = await readJson<Record<string, unknown>>(progressPath, {})
  if (isRecord(progress.refillAttempt) && progress.refillAttempt.id === attemptID && progress.refillAttempt.sessionID !== normalizedSessionID) {
    await writeJsonAtomic(progressPath, {
      ...progress,
      refillAttempt: { ...progress.refillAttempt, sessionID: normalizedSessionID },
    })
  }
  return { attempt: completed, changed }
}

export async function markApplicationRefillPromptSentState(workspacePath: string, attemptID: string, sessionID: string) {
  const normalizedSessionID = sessionID.trim()
  const attemptsPath = join(workspacePath, "03_state/filling_attempts.json")
  const attempts = await readAttempts(attemptsPath)
  const attempt = attempts.find((item) => item.id === attemptID)
  if (!attempt || attempt.sessionID !== normalizedSessionID) {
    throw new Error("重新填写对话与持久化记录不一致，不能把启动指令标记为已发送。")
  }
  if (attempt.promptSentAt) return { attempt, changed: false }
  const completed = { ...attempt, promptSentAt: new Date().toISOString() }
  await writeJsonAtomic(attemptsPath, attempts.map((item) => item.id === attemptID ? completed : item))
  const progressPath = join(workspacePath, "03_state/application_progress.json")
  const progress = await readJson<Record<string, unknown>>(progressPath, {})
  if (isRecord(progress.refillAttempt) && progress.refillAttempt.id === attemptID) {
    await writeJsonAtomic(progressPath, {
      ...progress,
      refillAttempt: { ...progress.refillAttempt, promptSentAt: completed.promptSentAt },
    })
  }
  return { attempt: completed, changed: true }
}

function applicationProgress(task: ApplicationTask, attempt: ApplicationRefillAttempt) {
  return {
    currentPage: "重新填写尚未进入申请平台",
    currentUrl: task.input.applicationUrl,
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
    todoPlan: [
      { step: "读取已确认的申请档案和缺失项", status: "pending" },
      { step: "创建本次独立 ego-browser task space", status: "pending" },
      { step: "重新观察申请平台并填写可确认字段", status: "pending" },
      { step: "逐页复查动态字段并保存", status: "pending" },
      { step: "记录阻塞项和阶段总结", status: "pending" },
    ],
    refillAttempt: {
      id: attempt.id,
      ordinal: attempt.ordinal,
      requestID: attempt.requestID,
      createdAt: attempt.createdAt,
      sourceSessionID: attempt.sourceSessionID,
      progressArchivePath: attempt.progressArchivePath,
      batchId: attempt.batchId,
      batchOrder: attempt.batchOrder,
      sessionID: attempt.sessionID,
      promptSentAt: attempt.promptSentAt,
    },
    browserBackend: "ego-browser",
    egoBrowser: {
      taskSpaceName: attempt.taskSpaceName,
      applicationUrl: task.input.applicationUrl,
      backend: "ego-browser",
      refillAttemptId: attempt.id,
      freshTaskSpaceAuthorizedAt: attempt.createdAt,
      freshTaskSpaceAuthorizedBy: "consultant_refill_click",
      awaitingFreshTaskSpaceId: true,
    },
  }
}

async function readAttempts(path: string) {
  if (!existsSync(path)) return []
  const attempts = await readFile(path, "utf8")
    .then((contents) => JSON.parse(contents) as unknown)
    .catch(() => {
      throw new Error("重新填写记录格式异常，请联系技术人员检查 03_state/filling_attempts.json。")
    })
  if (!Array.isArray(attempts)) throw new Error("重新填写记录格式异常，请联系技术人员检查 03_state/filling_attempts.json。")
  return attempts as ApplicationRefillAttempt[]
}

async function materialReviewPreparationComplete(workspacePath: string, materialReview: Record<string, unknown>) {
  if (Date.parse(String(materialReview.preparationCompleteAt || ""))) return true
  if (materialReview.mode === "skip") return true
  const submittedAt = Date.parse(String(materialReview.submittedAt || ""))
  if (!submittedAt || (materialReview.mode !== "note" && materialReview.mode !== "supplement_folder")) return true
  const required = ["02_generated/student_profile.md", "03_state/missing_items.json"]
  if (materialReview.mode === "supplement_folder") {
    const supplementalFolder = String(materialReview.supplementalFolder || "").trim()
    if (!supplementalFolder) return false
    required.push("03_state/materials_index.json")
    if ((await listFiles(supplementalFolder)).some((path) => /\.(pdf|png|jpe?g|heic|tiff?)$/i.test(path))) {
      required.push("03_state/ocr_index.json")
    }
  }
  return (await Promise.all(required.map((path) => stat(join(workspacePath, path)).then(
    (info) => info.mtimeMs >= submittedAt,
    () => false,
  )))).every(Boolean)
}

async function listFiles(directory: string): Promise<string[]> {
  return readdir(directory, { withFileTypes: true }).then(
    (entries) => Promise.all(entries.map((entry) => entry.isDirectory()
      ? listFiles(join(directory, entry.name))
      : [join(directory, entry.name)]
    )).then((files) => files.flat()),
    () => [],
  )
}
