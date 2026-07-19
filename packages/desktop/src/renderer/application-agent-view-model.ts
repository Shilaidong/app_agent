import type { ApplicationAgentChatItem, ApplicationTask, ApplicationTaskInput } from "../preload/types"

export const applicationTypes = ["硕士", "本科", "转学", "夏校", "博士", "其他"]
export const taskGoals = ["全流程执行", "仅整理材料", "仅生成清单", "继续上次申请"]
export const quickCommands = [
  "整理学生资料",
  "生成学生申请档案",
  "检查缺失内容",
  "生成信息收集表",
  "生成材料收集表",
  "开始申请填表",
  "继续申请填表",
  "生成 Word 缺失清单",
  "总结当前进度",
  "材料已经补好了，继续申请",
]
export const activeApplicationSessionKey = "terra-edu-application-agent-active-session"

export function base64Encode(value: string) {
  const bytes = new TextEncoder().encode(value)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function defaultTaskInput(): ApplicationTaskInput {
  return {
    studentName: "",
    sourceFolder: "",
    school: "",
    program: "",
    applicationType: "硕士",
    applicationUrl: "",
    deadline: "",
    notes: "",
    loginMethod: "顾问手动登录",
    platformUsername: "",
    outputLanguage: "zh",
    allowUpload: true,
    taskGoal: "全流程执行",
  }
}

export function taskCounts(current: ApplicationTask) {
  return {
    totalFiles: current.counts?.totalFiles ?? 0,
    missingMaterials: current.counts?.missingMaterials ?? 0,
    missingInformation: current.counts?.missingInformation ?? 0,
    uncertainItems: current.counts?.uncertainItems ?? 0,
  }
}

export function taskProgress(current: ApplicationTask) {
  return Array.isArray(current.progress) ? current.progress : []
}

export function taskGeneratedFiles(current: ApplicationTask) {
  return Array.isArray(current.generatedFiles) ? current.generatedFiles : []
}

export function isSameApplicationTaskInput(a: ApplicationTaskInput, b: ApplicationTaskInput) {
  return (
    normalizeTaskComparable(a.studentName) === normalizeTaskComparable(b.studentName) &&
    normalizeTaskComparable(a.school) === normalizeTaskComparable(b.school) &&
    normalizeTaskComparable(a.program) === normalizeTaskComparable(b.program) &&
    normalizeTaskUrl(a.applicationUrl) === normalizeTaskUrl(b.applicationUrl)
  )
}

export function groupedTasks(tasks: ApplicationTask[]) {
  const map = new Map<string, { student: string; items: ApplicationTask[] }>()
  for (const item of tasks.filter((task) => task.input.studentName.trim() && (task.input.school.trim() || task.input.program.trim()))) {
    const student = item.input.studentName.trim()
    const key = taskGroupKey(item)
    const group = map.get(key)
    map.set(key, { student, items: [...(group?.items ?? []), item] })
  }
  return Array.from(map.entries())
    .map(([key, group]) => ({
      key,
      student: group.student,
      latestUpdatedAt: Math.max(...group.items.map((item) => new Date(item.updatedAt).getTime())),
      items: group.items.sort((a, b) => {
        if (a.input.batchId && a.input.batchId === b.input.batchId) {
          const batchOrder = (a.input.batchOrder ?? Number.MAX_SAFE_INTEGER) - (b.input.batchOrder ?? Number.MAX_SAFE_INTEGER)
          if (batchOrder !== 0) return batchOrder
        }
        const schoolOrder = (a.input.school || a.input.program).localeCompare(b.input.school || b.input.program, "zh-Hans")
        if (schoolOrder !== 0) return schoolOrder
        const programOrder = (a.input.program || "").localeCompare(b.input.program || "", "zh-Hans")
        if (programOrder !== 0) return programOrder
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }),
    }))
    .sort((a, b) => {
      const studentOrder = a.student.localeCompare(b.student, "zh-Hans")
      if (studentOrder !== 0) return studentOrder
      return b.latestUpdatedAt - a.latestUpdatedAt
    })
}

export function taskGroupKey(task: ApplicationTask) {
  return task.input.batchWorkspacePath?.trim() || `legacy:${normalizeTaskComparable(task.input.studentName)}`
}

export type ComposerRuntimeKind =
  | "safety_stop"
  | "paused"
  | "awaiting_reply"
  | "browser_handoff"
  | "working"
  | "idle"

export type ComposerRuntimeState = {
  kind: ComposerRuntimeKind
  label: string
  detail: string
  canTogglePause: boolean
}

/** Pure UI state for the chat composer chip. Priority is safety > pause > wait > work. */
export function deriveComposerRuntimeState(input: {
  task: ApplicationTask | null | undefined
  messages?: ApplicationAgentChatItem[]
  questionPending?: boolean
}): ComposerRuntimeState {
  const task = input.task
  if (!task) {
    return { kind: "idle", label: "空闲", detail: "尚未选择任务", canTogglePause: false }
  }
  if (task.browserSafetyStop?.active || task.browserSafetyStop?.observationRequired || task.materialReviewTampered) {
    return {
      kind: "safety_stop",
      label: "安全停止",
      detail: task.materialReviewTamperMessage || task.browserSafetyStop?.kind || "需要顾问处理浏览器安全门控",
      canTogglePause: false,
    }
  }
  if (task.status === "已暂停") {
    return { kind: "paused", label: "已暂停", detail: "点击可继续任务", canTogglePause: true }
  }
  if (input.questionPending || (input.messages || []).some((item) => item.status === "pending" && Boolean((item as { questions?: unknown }).questions))) {
    return { kind: "awaiting_reply", label: "等待顾问回复", detail: "Agent 正在等待你的选项或补充", canTogglePause: true }
  }
  if (task.browserHandoffPending || task.status === "等待顾问登录" || task.status === "等待顾问接管浏览器") {
    return {
      kind: "browser_handoff",
      label: task.status === "等待顾问登录" || task.browserHandoffType === "login" ? "等待顾问登录" : "等待顾问操作浏览器",
      detail: "请在浏览器中完成操作后回来继续",
      canTogglePause: true,
    }
  }
  if (
    task.status === "正在读取文件" ||
    task.status === "正在整理材料" ||
    task.status === "正在生成学生资料" ||
    task.status === "正在检查缺失内容" ||
    task.status === "正在填写申请平台" ||
    task.status === "正在保存申请进度" ||
    task.status === "正在上传材料" ||
    task.status === "正在复制原始材料" ||
    task.status === "正在创建申请工作区" ||
    (input.messages || []).some((item) => item.status === "running" || item.status === "pending")
  ) {
    const ocr = task.ocr?.phase === "running" && task.ocr.total > 0
      ? `OCR ${task.ocr.current}/${task.ocr.total}`
      : task.status
    return { kind: "working", label: "工作中", detail: ocr, canTogglePause: true }
  }
  return {
    kind: "idle",
    label: task.status === "阶段性完成" ? "阶段性完成" : "空闲",
    detail: task.status,
    canTogglePause: true,
  }
}

export function mergeAgentMessages(current: ApplicationAgentChatItem[], next: ApplicationAgentChatItem[]) {
  if (current.length === 0) return next
  const byID = new Map(current.map((item) => [item.id, item]))
  let changed = current.length !== next.length
  const merged = next.map((item, index) => {
    const previous = byID.get(item.id)
    if (!previous) {
      changed = true
      return item
    }
    if (current[index]?.id !== item.id || !sameAgentMessage(previous, item)) changed = true
    return sameAgentMessage(previous, item) ? previous : item
  })
  return changed ? merged : current
}

function normalizeTaskComparable(value?: string) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function normalizeTaskUrl(value?: string) {
  const raw = String(value || "").trim()
  if (!URL.canParse(raw)) return normalizeTaskComparable(raw).replace(/\/+$/, "")
  const url = new URL(raw)
  url.hash = ""
  const pathname = url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host}${pathname || "/"}${url.search}`.toLowerCase()
}

function sameAgentMessage(left: ApplicationAgentChatItem, right: ApplicationAgentChatItem) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.title === right.title &&
    left.body === right.body &&
    left.status === right.status &&
    left.time === right.time &&
    JSON.stringify(left.question ?? null) === JSON.stringify(right.question ?? null)
  )
}
