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
const dialogGuardBuildSource = readFileSync(join(root, "scripts/build-terra-dialog-guard.ts"), "utf8")
const dialogGuardSource = readFileSync(join(root, "native/terra-dialog-guard.swift"), "utf8")
const releaseMacSource = readFileSync(join(root, "scripts/release-mac.ts"), "utf8")
const packageVerifySource = readFileSync(join(root, "scripts/verify-application-agent-package.ts"), "utf8")
const guiDialogVerifySource = readFileSync(join(root, "scripts/verify-application-agent-gui-dialog.ts"), "utf8")
const ipcSource = readFileSync(join(root, "src/main/ipc.ts"), "utf8")
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
const selectionListSource = readFileSync(join(root, "src/main/application-selection-list.ts"), "utf8")
const selectionListTemplate = join(root, "resources/templates/terra-edu-selection-list-template.xlsx")
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

const expectedTools = ["workspace", "materials", "state", "documents", "requirements", "risk", "native_dialog", "cua"]

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

assert(source.includes("application-agent_workspace"), "Start prompt must mention workspace tool")
assert(source.includes("application-agent_materials"), "Start prompt must mention materials tool")
assert(source.includes("application-agent_documents"), "Start prompt must mention documents tool")
assert(source.includes("application-agent_state"), "Start prompt must mention state tool")
assert(source.includes("application-agent_cua"), "Start prompt must mention CUA tool")
assert(source.includes("application-agent_native_dialog"), "Start prompt must mention the native-dialog fallback tool")
assert(source.includes("ego-browser skill"), "Start prompt must mention ego-browser skill")
assert(source.includes("useOrCreateTaskSpace"), "ego-browser task space SOP is missing")
assert(source.includes("snapshotText"), "ego-browser snapshotText SOP is missing")
assert(source.includes("handOffTaskSpace"), "ego-browser handoff SOP is missing")
assert(source.includes("takeOverTaskSpace"), "ego-browser takeover SOP is missing")
assert(source.includes("completeTaskSpace"), "ego-browser completion SOP is missing")
assert(source.includes("只有顾问明确回复继续后"), "ego-browser SOP must require explicit consultant consent before takeover")
assert(source.includes("绝不自动抢回控制"), "ego-browser SOP must forbid automatic task-space takeover")
assert(source.includes("type 为 alert 时使用 accept:true"), "ego-browser SOP must accept validation alerts before rescanning")
assert(source.includes("type 为 beforeunload 时一律 accept:false"), "ego-browser SOP must cancel beforeunload dialogs")
assert(source.includes("唯一例外是 Page.handleJavaScriptDialog"), "ego-browser SOP must stop all other actions while a native dialog is open")
assert(source.includes("任何可能改变页面结构或可见内容的动作都会使旧复查失效"), "ego-browser SOP must invalidate prior form checks after dynamic changes")
assert(source.includes("writeEgoBrowserSkill"), "Workspace generator must install bundled ego-browser skill")
assert(source.includes("readBundledEgoBrowserResource"), "Bundled ego-browser resource loader is missing")
assert(source.includes("TERRA_PINNED.md"), "Workspace generator must mark ego-browser skill as Terra pinned")
assert(source.includes("writeEgoBrowserWrapper"), "Workspace generator must install Terra ego-browser wrapper")
assert(source.includes("EGO_LITE_VENDOR_VERSION = \"0.4.4.15\""), "Vendored ego lite version pin is missing")
assert(source.includes("UPDATER_EXECUTABLE") && source.includes("EgoUpdater.app") && source.includes("EgoSoftwareUpdate.bundle"), "Terra ego-browser wrapper must refuse enabled bundled updater components")
assert(source.includes("Versions/$EXPECTED_VERSION/Helpers/ego-browser"), "Terra ego-browser wrapper must prefer the helper matching its pinned version")
assert(source.includes('"$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"') && source.includes("RUNTIME_ROOT=${runtimeRoot}"), "Terra ego-browser wrapper must isolate its mutable Ego runtime outside the signed app")
assert(source.includes('/usr/bin/ditto "$APP_PATH" "$STAGED_APP"'), "Terra ego-browser wrapper must copy the signed Ego source before launch")
assert(source.includes("/usr/bin/codesign --verify --deep --strict \"$APP_PATH\""), "Terra ego-browser wrapper must verify its immutable Ego source before copying it")
assert(source.includes("open -n -gj \"$RUNTIME_APP\" --args --no-default-browser-check --no-first-run"), "Terra ego-browser wrapper must launch its managed Ego runtime and suppress first-run/default-browser promotion")
assert(source.includes('/usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/"'), "Terra ego-browser wrapper must reuse its managed Ego runtime across browser rounds")
assert(source.includes("com.citrolabs.ego.lite.ego-browser") && source.includes("/bin/launchctl print"), "Terra ego-browser wrapper must check external Ego state without invoking the helper")
assert(!source.includes("existing_service_status"), "Terra ego-browser wrapper must not invoke ego-browser during external-service preflight")
assert(source.includes('"$HELPER" taskspace list'), "Terra ego-browser wrapper must use a read-only bundled-service readiness check")
assert(source.includes("helper_status=$?"), "Terra ego-browser wrapper must translate a post-readiness service conflict")
assert(source.includes("页面动作是否已经执行无法确认"), "Terra ego-browser wrapper must preserve an unknown page outcome after a post-readiness service failure")
assert(source.includes("TERRA_EGO_BROWSER_VERSION_CONFLICT"), "Terra ego-browser wrapper must reject incompatible external Ego Lite services explicitly")
assert(source.includes("EXPECTED_BUNDLE_ID='com.citrolabs.ego.lite'") && source.includes("EXPECTED_TEAM_ID='JGQLC6YQYJ'") && source.includes("Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)"), "Terra ego-browser wrapper must verify the official Ego Lite identity instead of trusting any valid signature")
assert(source.includes("watch-and-acknowledge") && source.includes("TERRA_EGO_NATIVE_DIALOG_"), "Terra ego-browser wrapper must arm and report the action-scoped native-dialog guard")
assert(source.includes('"$DIALOG_GUARD" inspect') && source.includes("本次预检只读取、没有点击"), "Native-dialog preflight must never acknowledge a dialog that predates the current browser action")
assert(source.includes("settle_dialog_watch") && source.includes('"$attempt" -le 60'), "The wrapper must let a detected native-dialog event finish persisting before terminating its watcher")
assert(source.includes("--pid \"$EGO_PID\"") && source.includes("--expected-url \"$EXPECTED_URL\""), "Native-dialog monitoring must bind to the exact managed Ego PID and URL")
assert(source.includes("native_dialog_last.json") && source.includes("native_dialog_events"), "Native-dialog evidence must be persisted before a new browser round")
assert(source.includes("Terra-Edu material review is pending"), "Terra ego-browser wrapper must block browser startup before material review")
assert(source.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs"), "Prompts/tools must invoke Terra ego-browser wrapper before PATH fallback")
assert(source.includes("TERRA_EGO_BROWSER_ALLOW_INSTALL=1"), "Start prompt must forbid automatic ego lite install/update")
assert(constantsSource.includes("export const UPDATER_ENABLED = false"), "Terra private build must disable Electron auto-updates")
assert(!builderSource.includes("owner: \"anomalyco\""), "Electron builder must not publish/check updates from upstream OpenCode repos")
assert(builderSource.includes("resources/vendor/ego-lite/"), "Electron builder must package vendored ego lite as extra resource")
assert(builderSource.includes("!resources/vendor/**"), "Electron builder must keep vendored ego lite out of app.asar")
assert(!builderSource.includes("signBundledEgoLite"), "Electron builder must preserve the signed Ego Lite identity")
assert(builderSource.includes("signTerraRuntimeCode"), "Electron builder must sign the Electron runtime before sealing the outer app")
assert(!builderSource.includes('"--deep"'), "Electron builder must not deep-sign and replace Ego Lite's identity")
assert(egoSkillSource.includes("Terra-Edu pinned-build policy"), "Bundled ego-browser skill must declare pinned-build policy")
assert(egoSkillSource.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser"), "Bundled ego-browser skill must use Terra wrapper")
assert(egoSkillSource.includes("application-agent_native_dialog") && egoSkillSource.includes("AXCustomContent"), "Bundled ego-browser skill must document the native-dialog fallback")
assert(!egoSkillSource.includes("claimTaskSpace"), "Generated Terra-Edu workspace skill must use the real Ego task-space API without the nonexistent claimTaskSpace helper")
assert(egoInstallSource.includes("locked by default"), "Bundled ego-browser install instructions must be locked by default")
assert(egoInstallSource.includes("Do not install or upgrade ego lite from the public website"), "Install docs must forbid public ego lite upgrades")
assert(egoInstallScript.includes("TERRA_EGO_BROWSER_ALLOW_INSTALL"), "Bundled ego-browser install script must require explicit install unlock")
assert(!egoInstallScript.includes("install_ego_lite\n\t\tinstalled_app_path") || egoInstallScript.includes("TERRA_EGO_BROWSER_ALLOW_INSTALL"), "Install script must not auto-install ego lite")
assert(existsSync(vendoredEgoLiteInfoPlist), "Vendored ego lite app must be bundled under resources/vendor/ego-lite")
const vendoredPaths = listFiles(join(vendoredEgoLiteApp, "Contents"))
const vendoredUpdaterFiles = vendoredPaths.filter((file) => file.includes("/EgoUpdater.app/") || file.includes("/EgoSoftwareUpdate.bundle/") || file.endsWith("/com.citrolabs.ego.UpdaterPrivilegedHelper"))
assert(vendoredUpdaterFiles.length > 0, "Vendored ego lite must retain its original signed updater payload")
assert(!vendoredUpdaterFiles.some((file) => (statSync(file).mode & 0o111) !== 0), "Vendored ego lite updater payload must not contain an executable file")
const vendoredHelpers = vendoredPaths.filter((file) => file.endsWith("/ego-browser"))
assert(vendoredHelpers.length > 0, "Vendored ego lite must include ego-browser helper")
assert(vendoredHelpers.some((file) => (statSync(file).mode & 0o111) !== 0), "Vendored ego-browser helper must be executable")
assert(!source.includes("application-agent_login"), "Application Agent must not expose a password login tool")
assert(!source.includes("login_credentials.json"), "Application Agent must not create a password credential workspace file")
assert(!source.includes("find-generic-password"), "Application Agent must not read the macOS keychain")
assert(source.includes("application-agent_risk"), "Start prompt must mention risk tool")
assert(source.includes("application-agent_requirements"), "Start prompt must mention requirements tool")
assert(source.includes("Direct distribution intentionally omits the legacy runtime fallback"), "Customer build must not expose the legacy runtime fallback")
assert(desktopServerSource.includes("OPENCODE_RIPGREP_PATH"), "Customer build must use the bundled ripgrep path")
assert(ripgrepSource.includes("Configured ripgrep binary is missing"), "OpenCode must prefer the bundled ripgrep binary")
assert(source.includes("terra-ocr"), "Customer build must install the bundled OCR wrapper")
assert(source.includes("terra-dialog-guard"), "Customer build must install the native-dialog wrapper")
assert(dialogGuardSource.includes("kAXApplicationDialogSubrole"), "Native dialog helper must match Chromium AXApplicationDialog exactly")
assert(dialogGuardSource.includes('readAttribute(element, "AXCustomContent" as CFString)') && dialogGuardSource.includes("CustomContentEvidence"), "Native dialog helper must decode AXCustomContent instead of relying on screenshots")
assert(dialogGuardSource.includes("AXUIElementSetMessagingTimeout"), "Native dialog helper must bound accessibility calls to a wedged browser")
assert(dialogGuardSource.includes("options.processIdentifier != nil") && dialogGuardSource.includes("executablePathPrefix"), "Native dialog helper must require an exact managed process target")
assert(dialogGuardSource.includes("candidate.buttons.count == 1") && dialogGuardSource.includes("!candidate.hasTextField"), "Native dialog helper must press only a single-button alert without an input")
assert(dialogGuardSource.includes("AXUIElementPerformAction") && dialogGuardSource.includes("kAXPressAction"), "Native dialog helper must use the verified accessibility press action")
assert(dialogGuardSource.includes("clickButtonCenter") && dialogGuardSource.includes("kAXPositionAttribute") && dialogGuardSource.includes("kAXSizeAttribute") && dialogGuardSource.includes("CGEvent"), "Native dialog helper must have a verified coordinate fallback when Chromium swallows AXPress")
assert(dialogGuardSource.includes("waitForClosedDialog") && dialogGuardSource.includes("consecutiveCompleteAbsences >= 3") && dialogGuardSource.includes("scan.applicationDialogCount == 0"), "Native dialog helper must verify complete consecutive observations that an acknowledged dialog actually disappeared")
assert(dialogGuardSource.includes("postToPid") && dialogGuardSource.includes("AXUIElementCopyElementAtPosition") && dialogGuardSource.includes("frontmostApplication"), "Coordinate fallback must be hit-tested and delivered only to the exact frontmost Ego PID")
assert(dialogGuardSource.includes("treeTruncated") && dialogGuardSource.includes("tree.nodes.filter { $0.role == kAXButtonRole"), "Native dialog safety checks must count every button and fail closed on truncated AX trees")
assert(dialogGuardSource.includes("tree.nodes.contains { editableRoles.contains($0.role) }") && dialogGuardSource.includes("fallback: Bool = false"), "Native dialog safety checks must treat any input field or unknown enabled state as unsafe")
assert(dialogGuardSource.includes("scheme == \"http\"") && dialogGuardSource.includes("NSRegularExpression.escapedPattern"), "Native dialog origin matching must require an absolute HTTP(S) URL and host boundary")
assert(dialogGuardSource.includes("expectedFingerprint") && dialogGuardSource.includes("dialogFingerprint(application, candidate: stable.candidates[0], options: options) == options.expectedFingerprint") && dialogGuardSource.includes("axPressResult == .cannotComplete"), "Native dialog fallback must preserve the inspected dialog fingerprint and refuse uncertain AXPress completion")
assert(dialogGuardSource.includes("readyOutputPath") && dialogGuardSource.includes("requireTaskSpaceContext") && dialogGuardSource.includes("taskSpaceContext"), "Action-scoped dialog acknowledgement must establish a clear baseline and verify the visible task-space context")
assert(dialogGuardSource.includes("candidate.customContent.present") && dialogGuardSource.includes("candidate.customContent.decoded"), "Native dialog acknowledgement must require real, fully decoded AXCustomContent evidence")
assert(dialogGuardSource.includes('append("expectedUrl", options.expectedURL)') && dialogGuardSource.includes('append("taskSpaceLabel", options.windowTitle)'), "Native dialog fingerprint must bind the exact URL and task-space label")
assert(dialogGuardSource.includes("let baseline = inspect(options: options, acknowledge: false)"), "A watcher must inspect its baseline without acknowledging a pre-existing dialog")
assert(source.includes("extract_text"), "Materials tool must expose deterministic OCR extraction")
assert(source.includes("record_dynamic_form_verified") && source.includes("DYNAMIC_FORM_SCAN_REQUIRED"), "Dynamic form rescan gate is missing")
assert(desktopUiSource.includes("multiple?: boolean") && desktopUiSource.includes("确认并提交所选项"), "Consultant multi-select question submission is missing")
assert(!windowsSource.includes("trafficLightPosition"), "macOS windows must keep the native draggable titlebar")
assert(prebuildSource.includes("bundle-ripgrep") && prebuildSource.includes("build-terra-paddleocr") && prebuildSource.includes("build-terra-dialog-guard"), "Desktop build must prepare bundled local tools")
assert(dialogGuardBuildSource.includes("apple-macos12.0") && dialogGuardBuildSource.includes("swiftc"), "Native dialog helper must compile for the desktop app's macOS 12 minimum")
assert(builderSource.includes("resources/vendor/ripgrep/") && builderSource.includes("resources/vendor/terra-paddleocr/") && builderSource.includes("resources/vendor/terra-dialog-guard/"), "Desktop package must include bundled local tools")
assert(builderSource.includes("terra-dialog-guard/terra-dialog-guard"), "Electron builder must explicitly sign the native dialog helper")
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
assert(applicationSource.includes("submitApplicationMaterialReview"), "Desktop backend must accept material-review decisions")
assert(source.includes("等待顾问确认材料"), "Material-review task status is missing")
assert(source.includes("material_review.json"), "Material-review state contract is missing")
assert(source.includes("prepare_ego_task") && source.includes("material review has not been approved"), "CUA must block browser preparation before material review")
assert(source.includes("sessionID") && source.includes("messageID") && source.includes("threadID"), "Execution audit context fields are missing")

assert(rendererSource.includes("question-card"), "Renderer question confirmation card is missing")
assert(rendererSource.includes("需要顾问确认"), "Renderer must show consultant confirmation title")
assert(rendererSource.includes("onReply"), "Question card option replies must route back to OpenCode")
assert(!rendererSource.includes("Notification.requestPermission"), "Renderer must not request web notification permission on every launch")
assert(rendererSource.includes("showNotification"), "Renderer must keep main-process notification support")
assert(rendererSource.includes("showUrgentNotification"), "Renderer must expose urgent browser-handoff notifications")
assert(rendererSource.includes("⚠️ 顾问需要接管浏览器"), "Browser handoff notification title is missing")
assert(rendererSource.includes("handoffMessage = messages"), "Browser handoff notification must inspect fresh Agent/tool messages")
assert(rendererSource.includes("user\\s*(?:is\\s*)?controlling"), "Browser handoff notification must recognize lost browser control")
assert(rendererSource.includes("TERRA_EGO_BROWSER_(?:VERSION_CONFLICT|EXTERNAL_SERVICE_ACTIVE|SERVICE_UNAVAILABLE)"), "Browser handoff notification must recognize Ego service conflicts")
assert(rendererSource.includes("申请 Agent 自动化已停止"), "Renderer must notify when automation stops")
assert(rendererSource.includes("notifyPendingQuestion"), "Renderer must notify when OpenCode question needs consultant input")
assert(rendererSource.includes("申请 Agent 需要你确认"), "Question notification title is missing")
assert(rendererSource.includes("notifyTaskProgress"), "Renderer must notify task progress updates")
assert(rendererSource.includes("申请 Agent 步骤已更新"), "Step progress notification title is missing")
assert(rendererSource.includes("scrollAgentToLatest"), "Renderer must keep the application chat pinned to its latest message")
assert(!rendererSource.includes("pendingScrollRestore"), "Renderer must not restore stale chat positions after new messages")
assert(rendererSource.includes("material-review-gate"), "Renderer must show the material-review gate before browser automation")
assert(rendererSource.includes("pickSupplementalFolder"), "Material-review gate must open a native folder picker")
assert(rendererSource.includes("暂不补充，开始填表"), "Material-review gate must let advisors continue without extra material")
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
assert(releaseMacSource.includes("bun test"), "mac release must run desktop unit tests")
assert(releaseMacSource.includes("verify:application-agent:package"), "mac release must verify the final packaged app")
assert(packageVerifySource.includes("0.4.4.15"), "package verification must pin the bundled ego lite version")
assert(packageVerifySource.includes("terra-paddleocr") && packageVerifySource.includes("ego-browser") && packageVerifySource.includes("terra-dialog-guard"), "package verification must inspect bundled OCR, dialog guard, and ego-browser executables")
assert(packageVerifySource.includes("--no-default-browser-check") && packageVerifySource.includes("--no-first-run"), "package verification must inspect first-run/default-browser protections")
assert(packageVerifySource.includes("codesign") && packageVerifySource.includes("unzip") && packageVerifySource.includes("ditto"), "package verification must inspect both app and final ZIP archive")
assert(packageVerifySource.includes('verify-application-agent-gui-dialog.ts"), archivedApp') && packageVerifySource.includes("Final ZIP app post-smoke code-signature verification"), "package verification must run the GUI smoke against the app extracted from the final ZIP")
assert(guiDialogVerifySource.includes("Page.handleJavaScriptDialog"), "GUI dialog smoke must exercise the native dialog protocol")
assert(guiDialogVerifySource.includes("beforeunload") && guiDialogVerifySource.includes("dialog-frame.html") && guiDialogVerifySource.includes("unknown confirmation"), "GUI dialog smoke must cover beforeunload, a real same-origin iframe alert, and an unknown confirmation")
assert(guiDialogVerifySource.includes('"-n", "-gj"') && guiDialogVerifySource.includes("sourceEgoLite") && guiDialogVerifySource.includes("runtimeRoot") && guiDialogVerifySource.includes('spawnSync("ditto"'), "GUI dialog smoke must launch an isolated copy of the signed Ego Lite source")
assert(guiDialogVerifySource.includes("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE") && guiDialogVerifySource.includes("hasEgoBrowserService") && guiDialogVerifySource.includes("waitForBundledApp"), "GUI dialog smoke must refuse an external Ego Lite service before launching its isolated runtime")
assert(guiDialogVerifySource.includes("127.0.0.1") && !guiDialogVerifySource.includes("pathToFileURL"), "GUI dialog smoke must use a local loopback fixture instead of file URLs")
assert(guiDialogVerifySource.includes("writeOpenCodeConfig") && guiDialogVerifySource.includes("runWrapperRound") && guiDialogVerifySource.includes("native_dialog_last.json") && guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED"), "GUI dialog smoke must exercise the generated native-dialog wrapper around the iframe action and reobserve afterward")
assert(guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_LEFT_UNCLICKED_BY_AX") && guiDialogVerifySource.includes('confirmationResult.clicked !== false'), "GUI dialog smoke must prove the AX guard does not click two-button confirmations")
assert(guiDialogVerifySource.includes("stopSmokeLaunchedApps") && guiDialogVerifySource.includes("existingBundledAppPids") && guiDialogVerifySource.includes("sourceSignature"), "GUI dialog smoke must preserve and verify the packaged Ego Lite source while cleaning up only its isolated runtime")
assert(guiDialogVerifySource.includes("required for distribution readiness"), "Unavailable GUI smoke must explicitly block distribution readiness")
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
assert(source.includes("beforeunload") && source.includes("accept:false"), "CUA beforeunload handling is missing")
assert(source.includes("下一回合先确认 URL 未变化"), "CUA beforeunload handling must require a fresh URL-preservation check")
assert(source.includes("UNVERIFIED_SAVE_RECORDED"), "record_saved must not mark a page as verified saved")
assert(source.includes("remainingRequiredFields") && source.includes("UNVERIFIED_DYNAMIC_FORM"), "Dynamic-form verification must gate verified saves")
assert(source.includes("DYNAMIC_FORM_OBSERVATION_REQUIRED"), "Dynamic-form verification must require a matching fresh observation")
assert(source.includes("lastBrowserObservation"), "Verified saves must be tied to a concrete post-save browser observation")
assert(source.includes("requireNumericTaskSpaceId"), "Browser audits must require the real numeric ego-browser task-space id")
assert(source.includes("record_blocker") && source.includes("blockerDisposition"), "Native dialog blockers must record a resolved or handoff disposition")
assert(source.includes("handoffPending") && source.includes("BROWSER_HANDOFF_PENDING"), "A handed-off task space must not be automatically prepared or reclaimed")
assert(source.includes("listTaskSpaces") && source.includes("legacyTaskSpaceConfirmationRequiredAt"), "Legacy workspaces without a task-space id must require advisor confirmation")
assert(source.includes("takeOverTaskSpace(\" + JSON.stringify(selectedLegacyTaskSpaceId)"), "A consultant-selected legacy task space must resume with explicit takeover")
assert(!source.includes("async function execCua"), "Legacy cua-driver execution helper must not be generated")
assert(!ipcSource.includes("cua-driver") && !ipcSource.includes("CuaDriver"), "Desktop IPC must not launch the retired cua-driver")
assert(!ipcSource.includes("application-agent:stop-automation"), "Desktop IPC must not retain the retired stop-automation route")
assert(source.includes("cua_control.json"), "CUA control state contract is missing")
assert(!source.includes('"cua_control.json" ] &&'), "Legacy CUA control must not gate the ego-browser wrapper")
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
assert(existsSync(selectionListTemplate), "Passwordless selection-list template is missing")
assert(selectionListSource.includes("申请平台密码"), "Selection-list importer must reject legacy password templates")
assert(selectionListSource.includes("normalizeSelectionListRows"), "Selection-list importer must normalize Excel rows")
assert(applicationSource.includes("createApplicationTasksFromSelectionList"), "Application Agent must create tasks from selection lists")
assert(applicationSource.includes("00_shared_materials"), "Selection-list batch must stage source materials once")
assert(rendererSource.includes("下载无密码模板"), "Renderer must expose the selection-list template download")
assert(rendererSource.includes("创建 ${selectedSelectionRows().length} 个申请任务"), "Renderer must support multi-row task creation")
assert(!rendererSource.includes("申请平台密码"), "Renderer must not collect application platform passwords")
assert(applicationSource.includes("resumeStatus") && applicationSource.includes("task_control.json"), "Paused task projection must preserve the task's resumable status")
assert(rendererSource.includes("taskNeedsExplicitContinue") && rendererSource.includes("等待顾问接管浏览器"), "Browser-handoff tasks must expose the same explicit Continue action as paused tasks")
assert(rendererSource.includes("action=resume_ego") && rendererSource.includes("consultantConfirmed=true"), "Explicit browser-handoff continuation must instruct the Agent to record resume_ego confirmation")
assert(rendererSource.includes("不得在调用成功前运行 ego-browser"), "Browser-handoff continuation must not allow takeover before resume_ego succeeds")

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
