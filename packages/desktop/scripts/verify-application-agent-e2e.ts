import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, extname, join } from "node:path"

const defaultSample = join(
  homedir(),
  "Documents/Terra-Edu Application Agent/application_workspaces/张志强-加州路德大学-master-of-science-in-management-degree-7",
)

const requestedWorkspace = process.env.APPLICATION_AGENT_WORKSPACE
const workspace = requestedWorkspace || (existsSync(defaultSample) ? defaultSample : newestWorkspace())
const warnings: string[] = []

function newestWorkspace() {
  const root = join(homedir(), "Documents/Terra-Edu Application Agent/application_workspaces")
  if (!existsSync(root)) return null
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, "03_state/task_state.json")))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return dirs[0] ?? null
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function readText(path: string) {
  assert(existsSync(path), `Missing file: ${path}`)
  return readFileSync(path, "utf8")
}

function readJson(path: string) {
  return JSON.parse(readText(path))
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const next = join(root, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(next))
    else out.push(next)
  }
  return out
}

function assertDir(path: string) {
  assert(existsSync(path) && statSync(path).isDirectory(), `Missing directory: ${path}`)
}

function assertNonEmptyFile(path: string) {
  assert(existsSync(path) && statSync(path).isFile(), `Missing file: ${path}`)
  assert(statSync(path).size > 0, `File is empty: ${path}`)
}

function includesAny(text: string, values: string[], message: string) {
  assert(values.some((value) => text.includes(value)), message)
}

function normalizeMissingItems(value: any) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value.items)) {
    return value.items.map((item: any, index: number) => ({
      name: item.name || item.item || item.field || item.title || item.id || `missing-${index + 1}`,
      type: item.status === "missing_form" || item.type === "info" ? "information" : item.type === "document" ? "material" : item.type || "uncertain",
      status: item.status || "missing",
      whyNeeded: item.whyNeeded || item.details || item.detail || item.reason,
      prepareFrom: item.prepareFrom || item.source || "请顾问/学生确认",
      formatRequirement: item.formatRequirement || item.format || "按申请平台要求提供",
    }))
  }
  const information = Array.isArray(value.missingInformation) ? value.missingInformation : []
  const materials = Array.isArray(value.missingMaterials) ? value.missingMaterials : []
  const uncertain = Array.isArray(value.uncertainItems) ? value.uncertainItems : []
  warnings.push("missing_items.json uses legacy grouped schema; normalized it for verification.")
  return [
    ...information.map((item: any) => ({
      name: item.field || item.item || item.name || item.id,
      type: "information",
      whyNeeded: item.details || item.whyNeeded,
      prepareFrom: item.source || item.prepareFrom || "请顾问/学生确认",
      formatRequirement: item.formatRequirement || "文字说明或清晰截图",
    })),
    ...materials.map((item: any) => ({
      name: item.item || item.field || item.name || item.id,
      type: "material",
      whyNeeded: item.details || item.whyNeeded,
      prepareFrom: item.prepareFrom || "请学生/家长提供",
      formatRequirement: item.formatRequirement || "清晰 PDF 或图片",
    })),
    ...uncertain.map((item: any) => ({
      name: item.item || item.field || item.name || item.id,
      type: "uncertain",
      whyNeeded: item.details || item.whyNeeded,
      prepareFrom: item.prepareFrom || "请顾问人工确认",
      formatRequirement: item.formatRequirement || "确认结果记录到任务备注",
    })),
  ]
}

function hasRawPasswordLine(body: string) {
  for (const match of body.matchAll(/password[ \t]*[:：]([^\n\r]*)/gi)) {
    const value = String(match[1] || "").trim()
    if (!/^\[已输入\]$/i.test(value) && !/^\[redacted\]$/i.test(value) && !/^\*+$/.test(value)) return true
  }
  return false
}

if (!workspace) {
  console.log("Application Agent E2E workspace verification skipped: clean install has no application workspace yet.")
  process.exit(0)
}

if (requestedWorkspace && !existsSync(workspace)) {
  throw new Error(`APPLICATION_AGENT_WORKSPACE does not exist: ${workspace}`)
}

assertDir(workspace)

const requiredDirs = [
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
  ".opencode/agents",
  ".opencode/commands",
  ".opencode/prompts",
  ".opencode/skills",
  ".opencode/tools",
]

for (const dir of requiredDirs) assertDir(join(workspace, dir))

const skills = [
  "task-initialization",
  "student-file-reading",
  "workspace-building",
  "material-organization",
  "student-profile-generation",
  "application-target-analysis",
  "missing-content-recording",
  "word-checklist-generation",
  "cua-application-filling",
  "material-upload",
  "continue-after-supplement",
  "task-summary",
]

const commands = [
  "organize-materials",
  "generate-profile",
  "check-missing",
  "generate-info-form",
  "generate-material-form",
  "start-application",
  "continue-application",
  "continue-after-supplement",
  "generate-word-checklist",
  "summarize-progress",
]

assertNonEmptyFile(join(workspace, ".opencode/opencode.json"))
assertNonEmptyFile(join(workspace, ".opencode/agents/application-agent.md"))
assertNonEmptyFile(join(workspace, ".opencode/prompts/application-agent.md"))
assertNonEmptyFile(join(workspace, ".opencode/tools/application-agent.ts"))
assertNonEmptyFile(join(workspace, ".opencode/bin/ego-browser"))
assert((statSync(join(workspace, ".opencode/bin/ego-browser")).mode & 0o111) !== 0, "Workspace ego-browser wrapper must be executable.")

for (const skill of skills) {
  const file = join(workspace, ".opencode/skills", skill, "SKILL.md")
  const body = readText(file)
  assert(body.includes("执行步骤"), `Skill lacks executable SOP steps: ${skill}`)
  assert(body.includes("执行原则"), `Skill lacks execution principles: ${skill}`)
  assert(body.includes("application-agent_") || body.includes("CUA") || body.includes("OCR"), `Skill does not guide tool/OCR/CUA usage: ${skill}`)
}

const egoBrowserSkillPath = join(workspace, ".opencode/skills/ego-browser/SKILL.md")
if (existsSync(egoBrowserSkillPath)) {
  assertNonEmptyFile(egoBrowserSkillPath)
  assertNonEmptyFile(join(workspace, ".opencode/skills/ego-browser/references/install.md"))
  const egoBrowserSkill = readText(egoBrowserSkillPath)
  assert(egoBrowserSkill.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs"), "ego-browser skill must use Terra-Edu pinned wrapper heredoc workflow.")
  assert(egoBrowserSkill.includes("useOrCreateTaskSpace"), "ego-browser skill must describe task spaces.")
  assert(egoBrowserSkill.includes("handOffTaskSpace"), "ego-browser skill must describe user handoff.")
} else {
  warnings.push("Legacy workspace has no ego-browser skill yet. Reopening the task will regenerate .opencode with the ego-lite backend.")
}

for (const command of commands) assertNonEmptyFile(join(workspace, ".opencode/commands", `${command}.md`))

const prompt = readText(join(workspace, ".opencode/prompts/application-agent.md"))
if (!prompt.includes("todowrite")) warnings.push("Legacy workspace prompt does not yet mention todowrite; reopening the task will regenerate .opencode config.")
if (!prompt.includes("webfetch") && !prompt.includes("websearch")) warnings.push("Legacy workspace prompt does not yet mention webfetch/websearch; reopening the task will regenerate .opencode config.")
if (!prompt.includes("question")) warnings.push("Legacy workspace prompt does not yet mention question; reopening the task will regenerate .opencode config.")
if (!prompt.includes("启动阶段")) warnings.push("Legacy workspace prompt does not yet use the staged startup prompt; reopening the task will regenerate .opencode config.")

const tools = readText(join(workspace, ".opencode/tools/application-agent.ts"))
for (const tool of ["workspace", "materials", "state", "documents", "risk", "cua"]) {
  assert(tools.includes(`export const ${tool} =`), `Missing custom tool export: ${tool}`)
}
if (!tools.includes("export const requirements =")) warnings.push("Legacy workspace custom tools do not yet include application-agent_requirements; reopening the task will regenerate .opencode config.")
if (tools.includes("export const login =")) warnings.push("Legacy workspace still exposes the retired application-agent_login tool; reopening the task will regenerate its no-password configuration.")
if (!tools.includes("extract_text")) warnings.push("Legacy workspace custom tools do not yet include bundled OCR extraction; reopening the task will regenerate .opencode config.")
for (const action of ["prepare_ego_task", "record_observation", "record_field_verified", "record_select_verified", "record_save_verified", "record_blocker", "handoff_to_consultant"]) {
  if (!tools.includes(action)) warnings.push(`Legacy workspace CUA coordination tool does not yet include ego-browser action: ${action}.`)
}
if (!tools.includes("lastObservedAt")) warnings.push("Legacy workspace CUA custom tool lacks lastObservedAt progress synchronization.")
if (!tools.includes("verifiedFields")) warnings.push("Legacy workspace CUA custom tool lacks verifiedFields progress synchronization.")
if (!tools.includes("blockedDialogs")) warnings.push("Legacy workspace CUA custom tool lacks blockedDialogs progress synchronization.")
if (!tools.includes("UNVERIFIED_SAVE_RECORDED")) warnings.push("Legacy workspace record_saved behavior predates verified save enforcement.")
if (!tools.includes("browserBackend = \"ego-browser\"")) warnings.push("Legacy workspace does not yet record ego-browser as the browser backend.")
assert(tools.includes("BLOCKED"), "Risk custom tool lacks BLOCKED response.")
if (!tools.includes("application_requirements.json")) warnings.push("Legacy workspace custom tools do not yet include application_requirements.json output.")

const task = readJson(join(workspace, "03_state/task_state.json"))
const missingRaw = readJson(join(workspace, "03_state/missing_items.json"))
const missing = normalizeMissingItems(missingRaw)
const progress = readJson(join(workspace, "03_state/application_progress.json"))
const materials = readJson(join(workspace, "03_state/materials_index.json"))
const requirementsPath = join(workspace, "03_state/application_requirements.json")
const requirementsMdPath = join(workspace, "02_generated/application_requirements.md")
const cuaControlPath = join(workspace, "03_state/cua_control.json")

assert(task && typeof task === "object", "task_state.json must be an object.")
assert(task.input && typeof task.input === "object", "task_state.json must include task.input.")
assert(Array.isArray(missing), "missing_items.json must be an array or supported legacy grouped schema.")
assert(missing.every((item: any) => item.name && !String(item.name).includes("未命名缺失项")), "missing_items.json normalization must produce named missing items.")
assert(Array.isArray(materials), "materials_index.json must be an array.")
assert(progress && typeof progress === "object", "application_progress.json must be an object.")
if (existsSync(requirementsPath)) {
  const requirements = readJson(requirementsPath)
  assert(requirements && typeof requirements === "object", "application_requirements.json must be an object when present.")
} else {
  warnings.push("Legacy workspace has no application_requirements.json yet. New tasks will create it; old tasks will get it after application-agent_requirements runs.")
}
if (!existsSync(requirementsMdPath)) {
  warnings.push("Legacy workspace has no application_requirements.md yet. New tasks will create it; old tasks will get it after requirement research runs.")
}
if (existsSync(cuaControlPath)) {
  const cuaControl = readJson(cuaControlPath)
  assert(cuaControl && typeof cuaControl === "object", "cua_control.json must be an object when present.")
  assert("stopped" in cuaControl, "cua_control.json must include stopped.")
} else {
  warnings.push("Legacy workspace has no cua_control.json yet. Reopening the task will create it.")
}

const originalFiles = listFiles(join(workspace, "00_original_backup"))
assert(originalFiles.length > 0, "00_original_backup must contain copied student materials.")
assert(materials.length > 0, "materials_index.json must contain classified material records.")

for (const item of materials) {
  assert(item.fileName && item.classifiedPath && item.category, "Each material record must include fileName, classifiedPath, and category.")
  assert(existsSync(join(workspace, item.classifiedPath)), `Classified file missing on disk: ${item.classifiedPath}`)
}

for (const item of missing) {
  assert(item.name, "Missing item lacks name.")
  assert(item.type, `Missing item lacks type: ${JSON.stringify(item)}`)
  assert(item.whyNeeded, `Missing item lacks consultant-facing reason: ${item.name}`)
  assert(item.prepareFrom, `Missing item lacks prepareFrom: ${item.name}`)
  assert(item.formatRequirement, `Missing item lacks formatRequirement: ${item.name}`)
}

const generated = [
  "02_generated/student_profile.md",
  "02_generated/info_collection_form.md",
  "02_generated/material_collection_form.md",
  "02_generated/missing_materials.docx",
  "02_generated/task_summary.md",
]
for (const file of generated) assertNonEmptyFile(join(workspace, file))
for (const file of generated.filter((item) => item.endsWith(".md"))) {
  assert(!readText(join(workspace, file)).includes("未命名缺失项"), `${file} must not contain unnamed missing-item placeholders.`)
}

const profile = readText(join(workspace, "02_generated/student_profile.md"))
includesAny(profile, [String(task.input.studentName || ""), "张志强", basename(workspace)], "student_profile.md must identify the student.")
includesAny(profile, [String(task.input.school || ""), "加州路德大学", "California Lutheran", "Northeastern", "NEU", "UC Berkeley", "Berkeley"], "student_profile.md must identify the target school.")
includesAny(profile, [String(task.input.program || ""), "Master of Science in Management"], "student_profile.md must identify the target program.")
includesAny(profile, ["01_classified_materials", "00_original_backup", "材料"], "student_profile.md must reference source/classified materials.")
includesAny(profile, ["缺失", "待确认", "不确定", "Missing", "Uncertain", "Needs Review"], "student_profile.md must include missing or uncertain items.")

const docx = readFileSync(join(workspace, "02_generated/missing_materials.docx"))
assert(docx.length > 100, "missing_materials.docx is too small.")
assert(docx[0] === 0x50 && docx[1] === 0x4b, "missing_materials.docx is not a valid ZIP/DOCX package.")

const summary = readText(join(workspace, "02_generated/task_summary.md"))
includesAny(summary, ["最终提交", "付款", "推荐信"], "task_summary.md must remind consultant about high-risk manual actions.")

const arrayProgressKeys = ["completedPages", "savedPages", "uploadedMaterials", "failedActions", "highRiskBlocks"]
const hasArrayProgressContract = arrayProgressKeys.every((key) => Array.isArray(progress[key]))
const hasSectionProgressContract = progress.sections && typeof progress.sections === "object" && Object.keys(progress.sections).length > 0
assert(
  hasArrayProgressContract || hasSectionProgressContract,
  "application_progress.json must include either array-based progress fields or a non-empty sections object.",
)
if (hasSectionProgressContract && !hasArrayProgressContract) {
  warnings.push("application_progress.json uses section-based progress; array progress fields will be created by newer CUA tool updates.")
}
if (hasArrayProgressContract) {
  for (const key of arrayProgressKeys) assert(Array.isArray(progress[key]), `application_progress.json.${key} must be an array.`)
}

const agentLog = readText(join(workspace, "04_logs/agent_log.md"))
const cuaLog = readText(join(workspace, "04_logs/cua_log.md"))
assert(agentLog.length > 0, "agent_log.md must not be empty.")
assert(cuaLog.length > 0, "cua_log.md must not be empty.")
includesAny(agentLog, ["OCR", "材料", "student_profile", "缺失"], "agent_log.md must show Agent workflow progress.")
includesAny(cuaLog, ["申请平台", "CUA", "截图", "填写", "高风险"], "cua_log.md must show CUA/application-platform activity.")

const auditPath = join(workspace, "03_state/agent_execution_audit.json")
if (existsSync(auditPath)) {
  const audit = readJson(auditPath)
  if (!Array.isArray(audit) || audit.length === 0) {
    warnings.push("agent_execution_audit.json exists but has no entries. Legacy workspaces may need to be opened once after this update.")
  } else {
    const toolNames = new Set(audit.map((entry: any) => entry.tool))
    for (const expected of ["application-agent_workspace", "application-agent_materials", "application-agent_state"]) {
      if (!toolNames.has(expected)) warnings.push(`Execution audit does not yet include ${expected}.`)
    }
    if (!audit.some((entry: any) => entry.context && "directory" in entry.context)) {
      warnings.push("Execution audit entries are legacy and do not yet include context.directory.")
    }
  }
} else {
  warnings.push("Legacy workspace has no 03_state/agent_execution_audit.json yet. New/updated tasks will create it.")
}

const textFiles = listFiles(workspace).filter((file) => [".md", ".json", ".log", ".txt", ".ts"].includes(extname(file)))
for (const file of textFiles) {
  const body = readFileSync(file, "utf8")
  const isGeneratedToolSource = file.endsWith("/.opencode/tools/application-agent.ts")
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(body), `Potential API key leaked into workspace text file: ${file}`)
  if (!isGeneratedToolSource) {
    assert(!hasRawPasswordLine(body), `Potential raw password leaked into workspace text file: ${file}`)
  }
}

console.log("Application Agent E2E workspace verification passed.")
console.log(`Workspace: ${workspace}`)
console.log(`Original files: ${originalFiles.length}, classified records: ${materials.length}, missing items: ${missing.length}`)
if (warnings.length) {
  console.log("Warnings:")
  for (const warning of warnings) console.log("- " + warning)
}
