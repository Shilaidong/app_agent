import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const sourcePath = join(root, "src/main/application-agent.ts")
const applicationSource = readFileSync(sourcePath, "utf8")
const opencodeSource = readFileSync(join(root, "src/main/application-agent-opencode.ts"), "utf8")
const mainSource = readFileSync(join(root, "src/main/index.ts"), "utf8")
const modelSource = readFileSync(join(root, "src/main/application-agent-model.ts"), "utf8")
const constantsSource = readFileSync(join(root, "src/main/constants.ts"), "utf8")
const builderSource = readFileSync(join(root, "electron-builder.config.ts"), "utf8")
const prebuildSource = readFileSync(join(root, "scripts/prebuild.ts"), "utf8")
const releaseMacSource = readFileSync(join(root, "scripts/release-mac.ts"), "utf8")
const windowsSource = readFileSync(join(root, "src/main/windows.ts"), "utf8")
const desktopServerSource = readFileSync(join(root, "src/main/server.ts"), "utf8")
const desktopSidecarSource = readFileSync(join(root, "src/main/sidecar.ts"), "utf8")
const ripgrepSource = readFileSync(join(root, "../opencode/src/file/ripgrep.ts"), "utf8")
const databaseSource = readFileSync(join(root, "../opencode/src/storage/db.ts"), "utf8")
const permissionRepairSource = readFileSync(join(root, "../opencode/src/storage/permission-schema-repair.ts"), "utf8")
const opencodeConfigSource = readFileSync(join(root, "../opencode/src/config/config.ts"), "utf8")
const opencodeToolRegistrySource = readFileSync(join(root, "../opencode/src/tool/registry.ts"), "utf8")
const egoSkillSource = readFileSync(join(root, "resources/ego-browser/SKILL.md"), "utf8")
const egoInstallSource = readFileSync(join(root, "resources/ego-browser/references/install.md"), "utf8")
const egoInstallScript = readFileSync(join(root, "resources/ego-browser/scripts/install.sh"), "utf8")
const vendoredEgoLiteApp = join(root, "resources/vendor/ego-lite/ego lite.app")
const vendoredEgoLiteInfoPlist = join(vendoredEgoLiteApp, "Contents/Info.plist")
const source = [applicationSource, opencodeSource, modelSource].join("\n")
const authSource = readFileSync(join(root, "src/main/terra-auth.ts"), "utf8")
const rendererSource = readFileSync(join(root, "src/renderer/index.tsx"), "utf8")
const desktopUiSource = [source, mainSource, rendererSource].join("\n")

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

function listFiles(rootPath: string): string[] {
  if (!existsSync(rootPath)) return []
  const out: string[] = []
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const full = join(rootPath, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    if (entry.isFile()) out.push(full)
  }
  return out
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
assert(source.includes("glob: \"allow\""), "Application Agent must explicitly allow OpenCode glob")
assert(source.includes("grep: \"allow\""), "Application Agent must explicitly allow OpenCode grep")
assert(source.includes("read: {"), "Application Agent must explicitly allow OpenCode read")
assert(source.includes("bash: {"), "Application Agent must explicitly allow OpenCode bash")
assert(source.includes('"python*": "deny"') && source.includes('"python3*": "deny"'), "Application Agent must block ad-hoc Python commands")
assert(desktopServerSource.includes("OPENCODE_DISABLE_PLUGIN_DEPENDENCY_INSTALL"), "Desktop sidecar must disable OpenCode project dependency auto-install")
assert(desktopServerSource.includes("TERRA_EDU_LEGACY_XDG_DATA_HOME"), "Desktop must preserve the legacy OpenCode data location before isolation")
assert(desktopServerSource.includes("XDG_DATA_HOME: join(userDataPath, \"data\")"), "Desktop must isolate OpenCode data by application")
assert(desktopSidecarSource.includes("copyLegacyDatabase"), "Desktop sidecar must migrate an existing OpenCode database into its isolated data directory")
assert(desktopSidecarSource.includes("VACUUM INTO"), "Desktop must copy the legacy database through a consistent SQLite snapshot")
assert(databaseSource.includes("repairLegacyPermissionSchema"), "OpenCode database startup must repair legacy permission schemas")
assert(permissionRepairSource.includes("before-permission-repair"), "Legacy permission repair must create a recoverable database backup")
assert(opencodeConfigSource.includes("OPENCODE_DISABLE_PLUGIN_DEPENDENCY_INSTALL"), "OpenCode config loader must support disabling project dependency auto-install")
assert(opencodeToolRegistrySource.includes('providerID.startsWith("opencode")'), "OpenCode Go models must expose websearch")
assert(source.includes('rm(join(base, name), { recursive: true, force: true })'), "Workspace config writer must remove stale OpenCode dependency install artifacts")

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
assert(source.includes("TERRA_PINNED.md"), "Workspace generator must mark ego-browser skill as Terra pinned")
assert(source.includes("writeEgoBrowserWrapper"), "Workspace generator must install Terra ego-browser wrapper")
assert(source.includes("EGO_LITE_VENDOR_VERSION = \"0.4.2.15\""), "Vendored ego lite version pin is missing")
assert(source.includes("EgoUpdater.app") && source.includes("EgoSoftwareUpdate.bundle"), "Terra ego-browser wrapper must refuse bundled updater components")
assert(source.includes("open -gj \"$APP_PATH\""), "Terra ego-browser wrapper must launch bundled ego lite before invoking the helper")
assert(source.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs"), "Prompts/tools must invoke Terra ego-browser wrapper before PATH fallback")
assert(source.includes("TERRA_EGO_BROWSER_ALLOW_INSTALL=1"), "Start prompt must forbid automatic ego lite install/update")
assert(constantsSource.includes("export const UPDATER_ENABLED = false"), "Terra private build must disable Electron auto-updates")
assert(!builderSource.includes("owner: \"anomalyco\""), "Electron builder must not publish/check updates from upstream OpenCode repos")
assert(builderSource.includes("resources/vendor/ego-lite/"), "Electron builder must package vendored ego lite as extra resource")
assert(builderSource.includes("!resources/vendor/**"), "Electron builder must keep vendored ego lite out of app.asar")
assert(egoSkillSource.includes("Terra-Edu pinned-build policy"), "Bundled ego-browser skill must declare pinned-build policy")
assert(egoSkillSource.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser"), "Bundled ego-browser skill must use Terra wrapper")
assert(egoInstallSource.includes("locked by default"), "Bundled ego-browser install instructions must be locked by default")
assert(egoInstallSource.includes("Do not install or upgrade ego lite from the public website"), "Install docs must forbid public ego lite upgrades")
assert(egoInstallScript.includes("TERRA_EGO_BROWSER_ALLOW_INSTALL"), "Bundled ego-browser install script must require explicit install unlock")
assert(!egoInstallScript.includes("install_ego_lite\n\t\tinstalled_app_path") || egoInstallScript.includes("TERRA_EGO_BROWSER_ALLOW_INSTALL"), "Install script must not auto-install ego lite")
assert(existsSync(vendoredEgoLiteInfoPlist), "Vendored ego lite app must be bundled under resources/vendor/ego-lite")
assert(!readFileSync(vendoredEgoLiteInfoPlist, "utf8").includes("KSUpdateURL"), "Vendored ego lite must not include Keystone update URL")
assert(!existsSync(join(vendoredEgoLiteApp, "Contents/Library/LaunchServices/com.citrolabs.ego.UpdaterPrivilegedHelper")), "Vendored ego lite updater helper must be removed")
const vendoredPaths = listFiles(join(vendoredEgoLiteApp, "Contents"))
assert(!vendoredPaths.some((file) => /EgoUpdater\.app|EgoSoftwareUpdate\.bundle|\/ksadmin$|\/ksinstall$/.test(file)), "Vendored ego lite updater components must be removed")
const vendoredHelpers = vendoredPaths.filter((file) => file.endsWith("/ego-browser"))
assert(vendoredHelpers.length > 0, "Vendored ego lite must include ego-browser helper")
assert(vendoredHelpers.some((file) => (statSync(file).mode & 0o111) !== 0), "Vendored ego-browser helper must be executable")
assert(source.includes("application-agent_login"), "Start prompt must mention login tool")
assert(source.includes("application-agent_risk"), "Start prompt must mention risk tool")
assert(source.includes("application-agent_requirements"), "Start prompt must mention requirements tool")
assert(source.includes("Direct distribution intentionally omits the legacy runtime fallback"), "Customer build must not expose the legacy runtime fallback")
assert(desktopServerSource.includes("OPENCODE_RIPGREP_PATH"), "Customer build must use the bundled ripgrep path")
assert(ripgrepSource.includes("Configured ripgrep binary is missing"), "OpenCode must prefer the bundled ripgrep binary")
assert(source.includes("terra-ocr"), "Customer build must install the bundled OCR wrapper")
assert(source.includes("extract_text"), "Materials tool must expose deterministic OCR extraction")
assert(source.includes("record_dynamic_form_verified") && source.includes("DYNAMIC_FORM_SCAN_REQUIRED"), "Dynamic form rescan gate is missing")
assert(desktopUiSource.includes("multiple?: boolean") && desktopUiSource.includes("确认并提交所选项"), "Consultant multi-select question submission is missing")
assert(!windowsSource.includes("trafficLightPosition"), "macOS windows must keep the native draggable titlebar")
assert(prebuildSource.includes("bundle-ripgrep") && prebuildSource.includes("build-terra-paddleocr"), "Desktop build must prepare bundled local tools")
assert(builderSource.includes("resources/vendor/ripgrep/") && builderSource.includes("resources/vendor/terra-paddleocr/"), "Desktop package must include bundled local tools")
assert(source.includes("启动阶段只做"), "Startup prompt must constrain the first turn to a minimal startup phase")
assert(source.includes("不要在启动阶段调用 webfetch"), "Startup prompt must keep web research out of the first turn")
assert(source.includes("todowrite 如果失败一次"), "Startup prompt must not block workspace initialization on todowrite failure")
assert(!source.includes("OpenCode 内置工具参数必须严格使用官方字段名"), "Startup prompt must not include brittle built-in field-name contracts")
assert(!source.includes("read -> read_file"), "Startup prompt must not include a fallback mapping table")
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
assert(desktopUiSource.includes("Agent 可能卡住"), "Renderer/main message projection must expose stalled agent state")
assert(desktopUiSource.includes("OpenCode 消息读取失败"), "Renderer/main message projection must expose message read failures")
assert(rendererSource.includes("重新发送启动指令"), "Renderer must allow resending the startup prompt")
assert(rendererSource.includes("重建 OpenCode 会话"), "Renderer must allow rebuilding the OpenCode session")
assert(mainSource.includes("resendApplicationAgentStartPrompt"), "Main process must expose startup prompt resend")
assert(prebuildSource.includes("MODELS_DEV_API_JSON"), "Desktop prebuild must use a local models.dev snapshot")
assert(prebuildSource.includes("models-api.json"), "Desktop prebuild must point MODELS_DEV_API_JSON to the vendored fixture")
assert(releaseMacSource.includes("ELECTRON_BUILDER_CACHE"), "mac release must keep electron-builder cache inside the workspace")
assert(builderSource.includes("TERRA_EDU_MAC_TARGET"), "mac builder config must allow ZIP-only fallback when hdiutil is unavailable")
assert(releaseMacSource.includes("hdiutil create"), "mac release must probe DMG capability before packaging")
assert(releaseMacSource.includes("ZIP-only"), "mac release must explain ZIP-only fallback")

assert(source.includes("prepare_ego_task"), "ego-browser prepare action is missing")
assert(source.includes("record_observation"), "ego-browser observation record action is missing")
assert(source.includes("record_field_verified"), "ego-browser field verification record action is missing")
assert(source.includes("record_select_verified"), "ego-browser select verification record action is missing")
assert(source.includes("record_save_verified"), "ego-browser save verification record action is missing")
assert(source.includes("syncMissingItemsWithProgress"), "Missing-item sync after verified save is missing")
assert(source.includes("collectMissingRecords"), "Missing-item object/grouped schema normalizer is missing")
assert(source.includes("item\", \"field\""), "Missing-item normalizer must support OpenCode item/field naming")
assert(source.includes("detail\", \"details\""), "Missing-item normalizer must support OpenCode detail/details fields")
assert(source.includes("missing_form"), "Missing-item normalizer must understand form-error statuses")
assert(source.includes("Application Ready for Submission") || source.includes("ready for submission"), "Review-ready evidence detection is missing")
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
assert(source.includes("PaddleOCR"), "Bundled PaddleOCR SOP is missing")
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
  assert(existsSync(join(opencode, "bin/ego-browser")), "Workspace missing Terra ego-browser wrapper")
  assert((statSync(join(opencode, "bin/ego-browser")).mode & 0o111) !== 0, "Workspace Terra ego-browser wrapper must be executable")
  assert(existsSync(join(opencode, "skills/ego-browser/SKILL.md")), "Workspace missing official ego-browser skill")
  assert(existsSync(join(opencode, "skills/ego-browser/references/install.md")), "Workspace missing ego-browser install reference")
  const egoSkill = readFileSync(join(opencode, "skills/ego-browser/SKILL.md"), "utf8")
  assert(egoSkill.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs"), "Workspace ego-browser skill must use Terra pinned wrapper heredoc runtime")
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
