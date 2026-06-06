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
    rememberPlatformPassword: true,
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
  const map = new Map<string, ApplicationTask[]>()
  for (const item of tasks.filter((task) => task.input.studentName.trim() && (task.input.school.trim() || task.input.program.trim()))) {
    const student = item.input.studentName.trim()
    map.set(student, [...(map.get(student) ?? []), item])
  }
  return Array.from(map.entries())
    .map(([student, items]) => ({
      student,
      latestUpdatedAt: Math.max(...items.map((item) => new Date(item.updatedAt).getTime())),
      items: items.sort((a, b) => {
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
