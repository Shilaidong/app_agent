import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const sourcePath = join(root, "src/main/application-agent.ts")
const applicationSource = readFileSync(sourcePath, "utf8")
const opencodeSource = readFileSync(join(root, "src/main/application-agent-opencode.ts"), "utf8")
const modelSource = readFileSync(join(root, "src/main/application-agent-model.ts"), "utf8")
const source = [applicationSource, opencodeSource, modelSource].join("\n")
const authSource = readFileSync(join(root, "src/main/terra-auth.ts"), "utf8")
const rendererSource = readFileSync(join(root, "src/renderer/index.tsx"), "utf8")

const expectedSkills = [
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

const expectedCommands = [
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

const expectedTools = ["workspace", "materials", "state", "documents", "requirements", "login", "risk", "cua"]

const expectedWorkspaceDirs = [
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
]

const expectedGeneratedFiles = [
  "02_generated/student_profile.md",
  "02_generated/info_collection_form.md",
  "02_generated/material_collection_form.md",
  "02_generated/missing_materials.docx",
  "02_generated/task_summary.md",
  "03_state/task_state.json",
  "03_state/missing_items.json",
  "03_state/application_progress.json",
  "03_state/application_requirements.json",
  "02_generated/application_requirements.md",
  "03_state/cua_control.json",
  "03_state/login_credentials.json",
  "03_state/agent_execution_audit.json",
  "04_logs/agent_log.md",
  "04_logs/cua_log.md",
]

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function countMatches(pattern: RegExp) {
  return [...source.matchAll(pattern)].length
}

function includesAll(values: string[], label: string) {
  for (const value of values) {
    assert(source.includes(value), `Missing ${label}: ${value}`)
  }
}

assert(existsSync(sourcePath), `Missing source file: ${sourcePath}`)
includesAll(expectedSkills.map((name) => `name: "${name}"`), "skill definition")
includesAll(expectedCommands.map((name) => `["${name}"`), "command definition")
includesAll(expectedTools.map((name) => `export const ${name} =`), "custom tool export")
includesAll(expectedWorkspaceDirs, "workspace directory")
includesAll(expectedGeneratedFiles, "generated file contract")

assert(countMatches(/name: "/g) >= expectedSkills.length, "Skill definitions appear truncated")
assert(source.includes("model: APPLICATION_AGENT_MODEL"), "Default OpenCode Go model constant is not used")
assert(source.includes("APPLICATION_AGENT_MODEL_ID = \"deepseek-v4-pro\""), "Default OpenCode Go model must be DeepSeek V4 Pro")
assert(source.includes("question: \"allow\""), "OpenCode question tool must be enabled for consultant confirmation cards")
assert(source.includes("todowrite"), "OpenCode todowrite SOP is missing")
assert(source.includes("webfetch"), "OpenCode webfetch requirement research is missing")
assert(source.includes("websearch"), "OpenCode websearch requirement research is missing")
assert(source.includes("tool_output"), "OpenCode tool output truncation config is missing")
assert(source.includes("compaction"), "OpenCode compaction config is missing")
assert(source.includes("tail_turns: 18"), "Application Agent must preserve more recent turns during compaction")
assert(source.includes("preserve_recent_tokens: 60000"), "Application Agent must preserve a larger recent-token budget")
assert(source.includes("permission: {"), "OpenCode permission block is missing")
assert(source.includes("\"*\": \"allow\""), "Workspace allow permissions are missing")

assert(source.includes("application-agent_workspace"), "Start prompt must mention workspace tool")
assert(source.includes("application-agent_materials"), "Start prompt must mention materials tool")
assert(source.includes("application-agent_documents"), "Start prompt must mention documents tool")
assert(source.includes("application-agent_state"), "Start prompt must mention state tool")
assert(source.includes("application-agent_cua"), "Start prompt must mention CUA tool")
assert(source.includes("ego-browser skill"), "Start prompt must mention ego-browser skill")
assert(source.includes("useOrCreateTaskSpace"), "ego-browser task space SOP is missing")
assert(source.includes("snapshotText"), "ego-browser snapshotText SOP is missing")
assert(source.includes("handOffTaskSpace"), "ego-browser handoff SOP is missing")
assert(source.includes("takeOverTaskSpace"), "ego-browser takeover SOP is missing")
assert(source.includes("completeTaskSpace"), "ego-browser completion SOP is missing")
assert(source.includes("writeEgoBrowserSkill"), "Workspace generator must install bundled ego-browser skill")
assert(source.includes("readBundledEgoBrowserResource"), "Bundled ego-browser resource loader is missing")
assert(source.includes("application-agent_login"), "Start prompt must mention login tool")
assert(source.includes("application-agent_risk"), "Start prompt must mention risk tool")
assert(source.includes("application-agent_requirements"), "Start prompt must mention requirements tool")
assert(source.includes("工具调用硬性约束"), "Start prompt must include hard tool-call constraints")
assert(source.includes("appendAudit"), "Custom tools must write execution audit records")
assert(source.includes("agent_execution_audit.json"), "Execution audit output file is missing")
assert(source.includes("application_requirements.json"), "Application requirements JSON contract is missing")
assert(source.includes("application_requirements.md"), "Application requirements Markdown contract is missing")
assert(source.includes("login_credentials.json"), "Application login credential state contract is missing")
assert(source.includes("sessionID") && source.includes("messageID") && source.includes("threadID"), "Execution audit context fields are missing")

assert(rendererSource.includes("question-card"), "Renderer question confirmation card is missing")
assert(rendererSource.includes("需要顾问确认"), "Renderer must show consultant confirmation title")
assert(rendererSource.includes("onReply"), "Question card option replies must route back to OpenCode")
assert(!rendererSource.includes("Notification.requestPermission"), "Renderer must not request web notification permission on every launch")
assert(rendererSource.includes("showNotification"), "Renderer must keep main-process notification support")
assert(rendererSource.includes("申请 Agent 自动化已停止"), "Renderer must notify when automation stops")
assert(rendererSource.includes("notifyPendingQuestion"), "Renderer must notify when OpenCode question needs consultant input")
assert(rendererSource.includes("申请 Agent 需要你确认"), "Question notification title is missing")
assert(rendererSource.includes("notifyTaskProgress"), "Renderer must notify task progress updates")
assert(rendererSource.includes("申请 Agent 步骤已更新"), "Step progress notification title is missing")
assert(rendererSource.includes("isSameApplicationTaskInput"), "Renderer duplicate task guard is missing")
assert(rendererSource.includes("不会再创建重复任务"), "Renderer duplicate task user notice is missing")

assert(source.includes("prepare_ego_task"), "ego-browser prepare action is missing")
assert(source.includes("record_observation"), "ego-browser observation record action is missing")
assert(source.includes("record_field_verified"), "ego-browser field verification record action is missing")
assert(source.includes("record_select_verified"), "ego-browser select verification record action is missing")
assert(source.includes("record_save_verified"), "ego-browser save verification record action is missing")
assert(source.includes("record_blocker"), "ego-browser blocker record action is missing")
assert(source.includes("handoff_to_consultant"), "ego-browser consultant handoff action is missing")
assert(source.includes("resume_ego"), "ego-browser resume action is missing")
assert(source.includes("complete_ego_task"), "ego-browser completion action is missing")
assert(source.includes("findExistingApplicationTask"), "Duplicate application task guard is missing")
assert(source.includes("reusedExisting"), "Duplicate application task reuse marker is missing")
assert(source.includes("platformLastOpenedAt"), "Application platform open debounce is missing")
assert(source.includes("离开此网站"), "CUA beforeunload Chinese prompt handling is missing")
assert(source.includes("UNVERIFIED_SAVE_RECORDED"), "record_saved must not mark a page as verified saved")
assert(source.includes("typeahead") && source.includes("snapshotText") && source.includes("pageInfo"), "ego-browser native select/typeahead SOP is missing")
assert(!source.includes("async function execCua"), "Legacy cua-driver execution helper must not be generated")
assert(source.includes("cua_control.json"), "CUA control state contract is missing")
assert(source.includes("browserBackend = \"ego-browser\""), "Application progress must record ego-browser backend")
assert(source.includes("BLOCKED"), "High-risk BLOCKED response is missing")
assert(source.includes("最终提交"), "Final submit risk rule is missing")
assert(source.includes("付款"), "Payment risk rule is missing")
assert(source.includes("推荐信邀请"), "Recommendation invite risk rule is missing")
assert(source.includes("保存密码"), "Credential-storage risk rule is missing")

assert(source.includes("扫描 PDF"), "Scanned PDF/OCR SOP is missing")
assert(source.includes("本地 OCR"), "Local OCR/MCP SOP is missing")
assert(source.includes("03_state/extracted_text"), "OCR result output path is missing")
assert(source.includes("不要假装读懂"), "OCR failure rule is missing")

assert(!source.includes("- 已有信息不要重复要求。\n- 已有信息不要重复要求。"), "Duplicate skill principle found")

assert(authSource.includes("application_agent_get_quota"), "Terra auth must read Supabase AI quota")
assert(authSource.includes("application_agent_consume_ai_quota"), "Terra auth must consume Supabase AI quota")
assert(authSource.includes("output * 4") || authSource.includes("tokens.output * 4"), "Weighted token quota rule is missing")
assert(authSource.includes("shilaidong"), "Quota exhaustion contact WeChat is missing")
assert(rendererSource.includes("Terra-Edu 顾问登录"), "Desktop consultant login gate is missing")
assert(rendererSource.includes("AI 额度"), "Desktop AI quota display is missing")

const workspace = process.env.APPLICATION_AGENT_WORKSPACE
if (workspace) {
  const opencode = join(workspace, ".opencode")
  assert(existsSync(opencode), `Workspace is missing .opencode config: ${opencode}`)
  assert(existsSync(join(opencode, "opencode.json")), "Workspace missing .opencode/opencode.json")
  assert(existsSync(join(opencode, "agents/application-agent.md")), "Workspace missing application-agent agent")
  assert(existsSync(join(opencode, "prompts/application-agent.md")), "Workspace missing application-agent prompt")
  assert(existsSync(join(opencode, "tools/application-agent.ts")), "Workspace missing custom tools")

  const skillDirs = readdirSync(join(opencode, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  for (const skill of expectedSkills) {
    assert(skillDirs.includes(skill), `Workspace missing skill: ${skill}`)
    const body = readFileSync(join(opencode, "skills", skill, "SKILL.md"), "utf8")
    assert(body.includes("执行步骤"), `Workspace skill lacks SOP steps: ${skill}`)
    assert(body.includes("执行原则"), `Workspace skill lacks execution principles: ${skill}`)
  }

  for (const command of expectedCommands) {
    assert(existsSync(join(opencode, "commands", `${command}.md`)), `Workspace missing command: ${command}`)
  }

  const tools = readFileSync(join(opencode, "tools/application-agent.ts"), "utf8")
  for (const tool of expectedTools) assert(tools.includes(`export const ${tool} =`), `Workspace missing tool: ${tool}`)
  assert(existsSync(join(opencode, "skills/ego-browser/SKILL.md")), "Workspace missing official ego-browser skill")
  assert(existsSync(join(opencode, "skills/ego-browser/references/install.md")), "Workspace missing ego-browser install reference")
  const egoSkill = readFileSync(join(opencode, "skills/ego-browser/SKILL.md"), "utf8")
  assert(egoSkill.includes("ego-browser nodejs"), "Workspace ego-browser skill must use official heredoc runtime")
  assert(egoSkill.includes("useOrCreateTaskSpace"), "Workspace ego-browser skill missing task spaces")
  for (const action of ["prepare_ego_task", "record_observation", "record_field_verified", "record_select_verified", "record_save_verified", "record_blocker"]) {
    assert(tools.includes(action), `Workspace ego-browser CUA coordination tool missing action: ${action}`)
  }
  assert(tools.includes("UNVERIFIED_SAVE_RECORDED"), "Workspace record_saved must require record_save_verified")
  assert(tools.includes("BLOCKED"), "Workspace risk tool missing BLOCKED response")
  assert(tools.includes("appendAudit"), "Workspace custom tools missing execution audit writer")
  assert(tools.includes("agent_execution_audit.json"), "Workspace custom tools missing execution audit file")
  assert(tools.includes("application_requirements.json"), "Workspace custom tools missing application requirements output")
}

console.log("Application Agent contract verification passed.")
console.log(`Skills: ${expectedSkills.length}, commands: ${expectedCommands.length}, tools: ${expectedTools.length}`)
