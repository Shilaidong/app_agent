import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const sourcePath = join(root, "src/main/application-agent.ts")
const applicationSource = readFileSync(sourcePath, "utf8")
const studentWorkspaceSource = readFileSync(join(root, "src/main/application-student-workspace.ts"), "utf8")
const refillSource = readFileSync(join(root, "src/main/application-agent-refill.ts"), "utf8")
const opencodeSource = readFileSync(join(root, "src/main/application-agent-opencode.ts"), "utf8")
const mainSource = readFileSync(join(root, "src/main/index.ts"), "utf8")
const modelSource = readFileSync(join(root, "src/main/application-agent-model.ts"), "utf8")
const ollamaCloudSource = readFileSync(join(root, "src/main/ollama-cloud.ts"), "utf8")
const constantsSource = readFileSync(join(root, "src/main/constants.ts"), "utf8")
const builderSource = readFileSync(join(root, "electron-builder.config.ts"), "utf8")
const prebuildSource = readFileSync(join(root, "scripts/prebuild.ts"), "utf8")
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
const opencodeErrorSource = readFileSync(join(root, "../opencode/src/provider/error.ts"), "utf8")
const opencodePromptSource = readFileSync(join(root, "../opencode/src/session/prompt.ts"), "utf8")
const modelsCatalogSource = readFileSync(join(root, "../opencode/test/tool/fixtures/models-api.json"), "utf8")
const modelsCatalog = JSON.parse(modelsCatalogSource) as Record<
  string,
  { models?: Record<string, { description?: string; attachment?: boolean; modalities?: { input?: string[] }; provider?: { npm?: string } }> }
>
const vendoredEgoLiteApp = join(root, "resources/vendor/ego-lite/ego lite.app")
const vendoredEgoLiteInfoPlist = join(vendoredEgoLiteApp, "Contents/Info.plist")
const egoRuntimeLock = JSON.parse(readFileSync(join(root, "resources/ego-runtime.lock.json"), "utf8")) as { officialSkill: { relativePath: string } }
const egoSkillSource = readFileSync(join(vendoredEgoLiteApp, egoRuntimeLock.officialSkill.relativePath), "utf8")
const source = [applicationSource, refillSource, opencodeSource, modelSource].join("\n")
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

const expectedTools = ["workspace", "materials", "state", "documents", "requirements", "risk", "cua"]

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
assert(source.includes("model: ${APPLICATION_AGENT_MODEL}"), "Default OpenCode Go model constant is not used")
assert(modelSource.includes('model("opencode-go", "qwen3.7-plus"') && modelSource.includes("APPLICATION_AGENT_MODEL_ID = APPLICATION_AGENT_MODELS[0].id"), "Default OpenCode Go model must be Qwen 3.7 Plus")
assert(modelSource.includes('model("ollama-cloud", "qwen3.5:397b"'), "Ollama Cloud Qwen 3.5 must be available as an application model")
assert(modelSource.includes("OpenCode Go 订阅") && modelSource.includes("Ollama Cloud 订阅"), "Model picker must label OpenCode Go vs Ollama Cloud subscriptions")
assert(modelSource.includes('"kimi-k2.6"') && modelSource.includes('"minimax-m3"') && modelSource.includes('"nemotron-3-super"'), "Multimodal catalog must include Kimi, MiniMax M3, and NVIDIA options")
assert(rendererSource.includes("<optgroup label={group.subscription}>"), "Model select must group options by subscription")
assert(ollamaCloudSource.includes("process.resourcesPath") && ollamaCloudSource.includes("ollama-cloud-key.txt"), "Ollama Cloud must read its bundled private API key")
assert(!ollamaCloudSource.includes("security") && !ollamaCloudSource.includes("keychain"), "Ollama Cloud must not access the macOS Keychain")
assert(desktopServerSource.includes("OLLAMA_API_KEY") && desktopServerSource.includes("getOllamaCloudApiKey"), "Desktop sidecar must receive the bundled Ollama Cloud credential")
assert(builderSource.includes("ollama-cloud-key.txt"), "mac package must bundle the Ollama Cloud credential")
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
assert(source.includes('"*": "deny"'), "Application Agent bash must default-deny")
assert(source.includes('"PATH=\\"$PWD/.opencode/bin:$PATH\\" ego-browser nodejs*": "allow"'), "Application Agent bash must allow the workspace-prefixed Ego wrapper")
assert(!source.includes('"ego-browser nodejs*": "allow"') && !source.includes('"*>*": "deny"'), "Application Agent must not allow unprefixed Ego or rely on broad output-redirection denies")
assert(opencodeSource.includes("function authoritativeEditDenyPatterns"), "Authoritative edit denials must expand relative/glob/absolute forms")
for (const protectedPath of [".opencode/**", "03_state/application_progress.json", "03_state/task_state.json", "03_state/task_control.json", "03_state/agent_execution_audit.json", "03_state/material_review.json", "03_state/task_input.json", "03_state/.desktop_material_review_trust.json"]) {
  assert(
    opencodeSource.includes(`"${protectedPath}"`) || opencodeSource.includes(`'${protectedPath}'`),
    `Ordinary Agent edit permission must protect authoritative state: ${protectedPath}`,
  )
}
assert(opencodeSource.includes("OpenCode routes write/edit/patch through permission.edit"), "Protected write/edit/patch state must be enforced through OpenCode permission.edit")
assert(opencodeSource.includes("MATERIAL_REVIEW_UNTRUSTED"), "prepare_ego_task must reject forged material reviews without desktop trust")
assert(opencodeSource.includes("documentsGenerated") && opencodeSource.includes("publishWarning"), "Document generation must report publish failures without swallowing generated files")
assert(opencodeSource.includes("mustContinuePreparation") && opencodeSource.includes("STUDENT_DOSSIER_INCOMPLETE"), "Incomplete shared dossiers must remain in preparation instead of opening material review")
assert(
  (opencodeSource.includes("禁止自行给批次名增加空格") || opencodeSource.includes("禁止在连字符两侧插入空格") || opencodeSource.includes("连字符两侧") || opencodeSource.includes("read_profile_sources"))
    && opencodeSource.includes("当前选校批次路径契约"),
  "Generated Agent prompts must preserve exact batch paths",
)
assert(opencodeSource.includes("task.ocr") && opencodeSource.includes("avgSeconds"), "OCR loop must write structured progress for the desktop UI")
assert(opencodeSource.includes("--jsonl") && opencodeSource.includes("spawn(ocr"), "Materials OCR must prefer multi-file --jsonl batch mode with single-file fallback")
assert(opencodeSource.includes("fillDatePickerByClicks") && opencodeSource.includes("EGO_FILL_DATE_PICKER_SOURCE"), "Managed browser policy must ship fillDatePickerByClicks")
assert(readFileSync(join(root, "native/terra-paddleocr.py"), "utf8").includes("--jsonl"), "Bundled PaddleOCR source must accept multi-file --jsonl mode")
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
assert(source.includes("ego-browser skill"), "Start prompt must mention ego-browser skill")
assert(source.includes("useOrCreateTaskSpace"), "ego-browser task space SOP is missing")
assert(source.includes("snapshotText"), "ego-browser snapshotText SOP is missing")
assert(source.includes("handOffTaskSpace"), "ego-browser handoff SOP is missing")
assert(source.includes("takeOverTaskSpace"), "ego-browser takeover SOP is missing")
assert(source.includes("completeTaskSpace"), "ego-browser completion SOP is missing")
assert(source.includes("completeTaskSpace(taskSpaceId, { keep: true })") && source.includes("一律不得使用 keep:false"), "Application Agent must preserve the completed Ego window and forbid the crashing keep:false close path")
assert(source.includes("只有顾问明确回复继续") && source.includes("await takeOverTaskSpace(taskSpaceId)"), "ego-browser SOP must require explicit consultant consent before takeover")
assert(source.includes("绝不自动抢回控制"), "ego-browser SOP must forbid automatic task-space takeover")
assert(source.includes("type 为 alert 时") && source.includes("dismiss_js_alert") && source.includes("pendingJsAlert"), "ego-browser SOP must route validation alerts through record_blocker pendingJsAlert then dismiss_js_alert")
assert(source.includes("type 为 beforeunload 时") && source.includes("确认 URL 未变"), "ego-browser SOP must end the round on beforeunload and confirm the URL is unchanged on the next pageInfo-only round")
assert(source.includes("不得再调用 snapshotText、captureScreenshot、js、点击/输入/上传/导航") || source.includes("也不得在本回合死等 Page.handleJavaScriptDialog"), "ego-browser SOP must stop page actions while a native dialog is open")
assert(!ipcSource.includes("application-agent:dismiss-js-alert") && !ipcSource.includes("dismissJsAlertViaAx"), "Half-finished dismiss-js-alert IPC must be removed; AX dismiss is CUA-only")
assert(source.includes("本页落盘/前进控件") && (source.includes("该点击必须包在 observePageAction 里") || source.includes("必须通过 observePageAction 点击页面上真实可见的本页落盘")), "ego-browser SOP must require a real page-commit click after verified page completion")
assert(source.includes("Major is required.") && source.includes("严禁对裸字符串「确定/OK」做 snapshot click") && source.includes("dismiss_js_alert"), "ego-browser SOP must dismiss native validation alerts via dismiss_js_alert outside Ego CDP")
assert(source.includes("先填完再查") && source.includes("Academic/Add Institution") && source.includes("Employment/Internship") && source.includes("Research/Publications") && source.includes("未填完禁止 Save"), "ego-browser SOP must fill stable fields first and hard-block Save on Academic/Employment/Research branch gaps")
assert(source.includes("JS_ALERT_AX_JXA") && source.includes("dismissJsAlertViaAx"), "Generated tools must embed the Terra JS-alert Accessibility helper")
assert(source.includes('"dismiss_js_alert"') && source.includes("PENDING_JS_ALERT_REQUIRED"), "CUA must expose dismiss_js_alert and require pendingJsAlert")
assert(source.includes("未走完疑似弹窗流程并达限前禁止 handoff/takeOver") || source.includes("PENDING_ALERT_DISMISS_REQUIRED") || source.includes("forbid early handoff until the alert dismiss flow is exhausted"), "Validation/suspected alerts must forbid early handoff until the dismiss flow is exhausted")
assert(source.includes("clickByCoordinates") && source.includes("TERRA_EGO_SYNTHETIC_DOM_EVENT_DENIED") && source.includes("TERRA_EGO_UNAUTHORIZED_TAKEOVER"), "Coordinate CDP click fallback, synthetic DOM event ban, and unauthorized takeOver gate must ship")
assert(source.includes("PAGE_LEFT_WITHOUT_SAVE_EVIDENCE") && source.includes("CONSULTANT_HANDOFF_GUIDANCE") && source.includes("pageHasFormActivity"), "URL leave-without-save warning, form-activity exemption, and consultant handoff template must ship")
assert(source.includes("alertDismissHandoffAllowed") && source.includes("known-message and suspected"), "Dismiss-limit handoff exit must cover both known-message and suspected alerts")
assert(source.includes("Runtime alerts are not auto-cleared by helper exit") || source.includes("runtime 弹窗不会因 helper 退出而自动消失"), "Runtime alerts must stay distinct from load-time navigateInitialPageCapturingAlerts auto-accept")
assert(existsSync(join(root, "src/main/js-alert-ax.ts")), "Desktop must ship js-alert-ax helper")
const jsAlertAxSource = readFileSync(join(root, "src/main/js-alert-ax.ts"), "utf8")
assert(jsAlertAxSource.includes("Only Terra-managed Ego Lite") && !jsAlertAxSource.includes("Fallback: any process"), "JS-alert AX must target Ego Lite only with no all-process fallback scan")
const jsAlertAxTestSource = readFileSync(join(root, "src/main/js-alert-ax.test.ts"), "utf8")
assert(jsAlertAxTestSource.includes("Only Terra-managed Ego Lite") && !jsAlertAxTestSource.includes("osascript") && !jsAlertAxTestSource.includes("await dismissJsAlertViaAx"), "Unit tests must shape-check AX source and must not invoke live osascript dismiss")
assert(source.includes("任何可能改变页面结构或可见内容的动作都会使旧复查失效") || source.includes("分支点"), "ego-browser SOP must invalidate prior form checks after dynamic changes")
assert(source.includes("writeEgoBrowserSkill"), "Workspace generator must install bundled ego-browser skill")
assert(source.includes("readAuthoritativeEgoBrowserResource") && source.includes("officialSkill.sha256"), "Workspace generator must load and hash-check the current vendored Ego skill")
assert(source.includes("TERRA_POLICY.md"), "Generated upstream Ego skill must point to a separate Terra policy")
assert(source.includes("TERRA_PINNED.md"), "Workspace generator must mark ego-browser skill as Terra pinned")
assert(source.includes("writeEgoBrowserWrapper"), "Workspace generator must install Terra ego-browser wrapper")
assert(source.includes("EGO_LITE_VENDOR_VERSION = egoRuntimeLock.version"), "Vendored ego lite version must derive from the runtime lock")
assert(source.includes("EXPECTED_HELPER_SHA256") && source.includes("EXPECTED_CDHASH") && source.includes("helper_integrity_valid"), "Wrapper must enforce the runtime lock helper hash and app CDHash")
assert(source.includes("UPDATER_EXECUTABLE") && source.includes("EgoUpdater.app") && source.includes("EgoSoftwareUpdate.bundle"), "Terra ego-browser wrapper must refuse enabled bundled updater components")
assert(source.includes("Versions/$EXPECTED_VERSION/Helpers/ego-browser"), "Terra ego-browser wrapper must prefer the helper matching its pinned version")
assert(source.includes('"$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"') && source.includes("RUNTIME_ROOT=${runtimeRoot}"), "Terra ego-browser wrapper must isolate its mutable Ego runtime outside the signed app")
assert(source.includes('/usr/bin/ditto "$APP_PATH" "$STAGED_APP"'), "Terra ego-browser wrapper must copy the signed Ego source before launch")
assert(source.includes("/usr/bin/codesign --verify --deep --strict \"$APP_PATH\""), "Terra ego-browser wrapper must verify its immutable Ego source before copying it")
assert(source.includes('/usr/bin/open --env "HOME=$HOME" --env "CFFIXED_USER_HOME=$CFFIXED_USER_HOME"') && source.includes('-n -gj "$RUNTIME_APP" --args --no-default-browser-check --no-first-run --password-store=basic --use-mock-keychain'), "Terra ego-browser wrapper must cold-start managed Ego with isolated HOME/CFFIXED_USER_HOME and suppress browser promotion/keychain dialogs")
assert(source.includes('/usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/"'), "Terra ego-browser wrapper must reuse its managed Ego runtime across browser rounds")
assert(source.includes("com.citrolabs.ego.lite.ego-browser") && source.includes("/bin/launchctl print"), "Terra ego-browser wrapper must check external Ego state without invoking the helper")
assert(!source.includes("existing_service_status"), "Terra ego-browser wrapper must not invoke ego-browser during external-service preflight")
assert(source.includes('"$HELPER" taskspace list'), "Terra ego-browser wrapper must use a read-only bundled-service readiness check")
assert(source.includes("helper_status=$?"), "Terra ego-browser wrapper must translate a post-readiness service conflict")
assert(source.includes("页面动作是否已经执行无法确认"), "Terra ego-browser wrapper must preserve an unknown page outcome after a post-readiness service failure")
assert(source.includes("TERRA_EGO_BROWSER_VERSION_CONFLICT"), "Terra ego-browser wrapper must reject incompatible external Ego Lite services explicitly")
assert(source.includes("EXPECTED_BUNDLE_ID='com.citrolabs.ego.lite'") && source.includes("EXPECTED_TEAM_ID='JGQLC6YQYJ'") && source.includes("Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)"), "Terra ego-browser wrapper must verify the official Ego Lite identity instead of trusting any valid signature")
assert(source.includes("observePageAction") && source.includes("先启动动作但不 await"), "Application Agent must observe native dialogs concurrently with page-changing actions")
assert(source.includes("pageInfoTimeoutMs = 1500") && source.includes("settleMs = 2000") && source.includes("pageInfo produced no bounded post-action observation"), "Application Agent must bound pageInfo calls and preserve a post-action quiet window")
assert(source.includes("const actionPromise = Promise.resolve()") && source.includes("Promise.resolve().then(() => pageInfo())"), "Application Agent must start the page-changing action before concurrently polling pageInfo")
assert(source.includes("return { kind: 'dialog', info: lastInfo, actionPromise }"), "Application Agent must return a detected Ego dialog without waiting for the blocked iframe action")
assert(opencodeSource.includes("Do not Page.handleJavaScriptDialog here") && opencodeSource.includes("never CDP accept") && opencodeSource.includes("confirm URL unchanged"), "kind:dialog branch must end the round without CDP accept and document beforeunload URL confirmation")
assert(!opencodeSource.includes("accept: true") && !opencodeSource.includes("accept:true"), "application-agent-opencode must not CDP-accept any dialog")
assert(source.includes("所有 confirm 或 prompt 都必须 handOffTaskSpace") && source.includes("dialogUrl") && source.includes("dialogFrameId"), "Application Agent must hand off confirm/prompt and keep iframe dialog identity separate from the top-level URL")
assert(source.includes("takeoverPending: true") && source.includes("resumeAuthorizedAt") && source.includes("completed authorized ego-browser takeover"), "Consultant-authorized task-space recovery must remain pending until the first post-takeover observation")
assert(source.includes("不得刷新/重开/JS submit/takeOver") && source.includes("疑似原生校验弹窗") && source.includes("达重试上限仍未点掉时（且仅此时）才允许 handoff_to_consultant"), "Unknown/timeout browser outcomes must enter the suspected-alert path instead of destructive recovery, with handoff only after the limit")
assert(!source.includes("export const native_dialog") && !source.includes("application-agent_native_dialog") && !source.includes("TERRA_EGO_NATIVE_DIALOG"), "Application Agent must not expose the retired native Accessibility dialog sidecar")
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
assert(egoSkillSource.includes("claimTaskSpace") && egoSkillSource.includes("takeOverTaskSpace"), "Authoritative vendored Ego skill must expose its current ownership APIs")
assert(egoSkillSource.includes("Closing all tabs in a task space is equivalent to closing that task space."), "Authoritative vendored Ego Skill must be the Current framework copy")
assert(source.includes("Never call `captureScreenshot()` without a path") && source.includes("OpenCode `read` on that exact"), "Terra policy must require explicit workspace screenshots and exact image attachment")
assert(source.includes("Vue internals") && source.includes("fillInput+Tab+readback") && source.includes("click+snapshot+click-option+reobserve"), "Terra policy must require real generic interactions and ban framework-internal writes")
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
assert(!existsSync(join(root, "native/terra-dialog-guard.swift")), "Customer build must omit the retired native Accessibility source")
assert(!existsSync(join(root, "resources/vendor/terra-dialog-guard/terra-dialog-guard")), "Customer build must omit the retired native Accessibility binary")
assert(source.includes("extract_text"), "Materials tool must expose deterministic OCR extraction")
assert(source.includes("isNativeTextMaterialPath") && source.includes("appendNativeTextExtractions") && source.includes("textutil"), "Materials extract_text must extract office/text documents, not only OCR scans")
assert(source.includes("信息收集") && source.includes("命中学生信息收集表关键词"), "Info-collection forms must classify as high-value identity materials")
assert(source.includes("ownerPreparation:true 后不得在只更新") || source.includes("ownerPreparation:true 时，更新状态后不得结束本回合") || source.includes("必须在同一连续执行中立刻调用 application-agent_materials"), "Startup SOP must forbid finishing after only setting 正在读取文件")
assert(source.includes("syncSchoolLocalExtractedText") && source.includes("localRead"), "extract_text must mirror OCR text into school-local relative paths for profile generation")
assert(source.includes("read_profile_sources") && source.includes("readProfileSources"), "materials tool must expose read_profile_sources so profile generation does not invent absolute paths")
assert(source.includes("mustContinueWith") && source.includes("application-agent_materials extract_text"), "Owner workspace initialize must require immediate extract_text continuation")
assert(!source.includes("请现在只执行“启动阶段”"), "Start prompt must not stop after the startup phase")
assert(source.includes("read_profile_sources") || source.includes("连字符两侧") || source.includes("禁止改写批次目录名"), "Path contract must keep agents off hand-written absolute batch paths")
assert(source.includes("record_dynamic_form_verified") && source.includes("DYNAMIC_FORM_SCAN_REQUIRED"), "Dynamic form rescan gate is missing")
assert(desktopUiSource.includes("multiple?: boolean") && desktopUiSource.includes("确认并提交所选项"), "Consultant multi-select question submission is missing")
assert(!windowsSource.includes("trafficLightPosition"), "macOS windows must keep the native draggable titlebar")
assert(prebuildSource.includes("bundle-ripgrep") && prebuildSource.includes("build-terra-paddleocr") && !prebuildSource.includes("build-terra-dialog-guard"), "Desktop build must prepare bundled ripgrep and PaddleOCR without the retired dialog guard")
assert(builderSource.includes("resources/vendor/ripgrep/") && builderSource.includes("resources/vendor/terra-paddleocr/") && !builderSource.includes("resources/vendor/terra-dialog-guard/"), "Desktop package must include ripgrep and PaddleOCR without the retired dialog guard")
assert(source.includes("启动阶段只做") || source.includes("启动阶段先做"), "Startup prompt must constrain the first turn to a minimal startup phase")
assert(source.includes("不要在启动阶段调用 webfetch") || source.includes("启动阶段不要调用 webfetch"), "Startup prompt must keep web research out of the first turn")
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
assert(rendererSource.includes("opencodeSession() ?? await window.api.findApplicationAgentSession"), "Material review must recover a missing renderer session instead of silently returning")
assert(rendererSource.includes("发现学生核心档案尚未生成") && rendererSource.includes("必须逐字使用以上路径"), "Material review must route incomplete owner dossiers back to the Agent with exact paths")
assert(rendererSource.includes("isSameApplicationTaskInput"), "Renderer duplicate task guard is missing")
assert(rendererSource.includes("不会再创建重复任务"), "Renderer duplicate task user notice is missing")
assert(desktopUiSource.includes("Agent 可能卡住"), "Renderer/main message projection must expose stalled agent state")
assert(desktopUiSource.includes("OpenCode 消息读取失败"), "Renderer/main message projection must expose message read failures")
assert(rendererSource.includes("重新发送启动指令"), "Renderer must allow resending the startup prompt")
assert(!rendererSource.includes("重建 OpenCode 会话"), "Renderer must remove the unsafe full-flow session rebuild action")
assert(rendererSource.includes("根据现有内容重新填写"), "Renderer must expose the clean refill-session action")
assert(rendererSource.includes("新建一个干净的填表对话"), "Renderer must explain the refill-session boundary before starting")
assert(rendererSource.includes("startApplicationAgentRefillSession"), "Renderer must call the dedicated refill-session API")
assert(mainSource.includes("resendApplicationAgentStartPrompt"), "Main process must expose startup prompt resend")
assert(mainSource.includes("application-refill-agent"), "Main process must create a dedicated refill agent session")
assert(mainSource.includes("/abort"), "Main process must stop the old Agent turn before starting a refill session")
assert(mainSource.includes("prepareApplicationRefillAttempt"), "Main process must persist the refill attempt before browser work")
const refillMain = mainSource.slice(mainSource.indexOf("const startApplicationAgentRefillSession"), mainSource.indexOf("const resendApplicationAgentStartPrompt"))
assert(refillMain.indexOf("inspectApplicationRefillAttempt") < refillMain.indexOf("/abort"), "Main process must reject stale refill requests before aborting any session")
assert(refillMain.includes("旧填写会话不属于当前学校工作区"), "Main process must validate source-session ownership before aborting it")
assert(refillMain.includes("findCreatedSession") && refillMain.includes("search=${encodeURIComponent(prepared.id)}"), "Main process must recover a sidecar session after an uncertain create result")
assert(refillMain.includes("markApplicationRefillPromptSent"), "Main process must persist prompt delivery before a later click may create another refill session")
assert(mainSource.includes("applicationAgentForSession") && mainSource.includes('agent === "application-refill-agent"'), "Follow-up prompts must preserve the refill agent instead of switching back to the preparation agent")
assert(mainSource.includes("不得重新初始化工作区、OCR、分类、研究要求、生成档案"), "Refill follow-up prompts must preserve the fill-only boundary")
assert(source.includes("buildApplicationAgentRefillPrompt"), "Application Agent must provide a fill-only startup prompt")
assert(source.includes("REFILL_PREPARATION_LOCKED"), "Refill custom tools must hard-block material preparation mutations")
assert(source.includes("REFILL_SESSION_MISMATCH"), "Only the active refill OpenCode session may mutate its browser state")
assert(source.includes("REFILL_TASK_SPACE_OBSERVED_NAME_MISMATCH") && source.includes("taskSpaceOwnership"), "Fresh Ego task spaces must match ID, name, and agent ownership")
assert(source.includes('task: "deny"') && source.includes('"application-agent_state": "deny"'), "Refill agent must not escape through subagents or preparation-state tools")
assert(source.includes("preparationCompleteAt"), "Supplemental content must be applied before a refill can start")
assert(source.includes("freshTaskSpaceAuthorizedBy: \"consultant_refill_click\""), "Refill attempts must persist explicit consultant authorization for a fresh Ego space")
assert(source.includes("03_state/filling_attempts.json"), "Refill attempts must have a durable lineage record")
assert(mainSource.includes("--terra-package-smoke-write-opencode") && mainSource.includes("TERRA_EDU_PACKAGE_SMOKE_WRITE_OPENCODE") && mainSource.includes("TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN") && mainSource.includes("runPackageSmokeConfigProbe"), "Packaged main process must expose the isolated no-window config-generation smoke probe")
assert(prebuildSource.includes("MODELS_DEV_API_JSON"), "Desktop prebuild must use a local models.dev snapshot")
assert(prebuildSource.includes("models-api.json"), "Desktop prebuild must point MODELS_DEV_API_JSON to the vendored fixture")
const qwenCatalogModel = modelsCatalog["opencode-go"]?.models?.["qwen3.7-plus"]
assert(qwenCatalogModel?.description === "Multimodal reasoning model for visual analysis, planning, and tool use", "Vendored models.dev snapshot must contain the full Qwen 3.7 Plus catalog record")
assert(qwenCatalogModel.attachment === true && qwenCatalogModel.modalities?.input?.includes("image"), "Vendored Qwen 3.7 Plus metadata must enable image attachments")
assert(qwenCatalogModel.provider?.npm === "@ai-sdk/anthropic", "Vendored Qwen 3.7 Plus metadata must select its real provider protocol")
const ollamaQwenCatalogModel = modelsCatalog["ollama-cloud"]?.models?.["qwen3.5:397b"]
assert(ollamaQwenCatalogModel?.attachment === true && ollamaQwenCatalogModel.modalities?.input?.includes("image"), "Vendored Ollama Qwen 3.5 metadata must enable image attachments")
assert(releaseMacSource.includes("ELECTRON_BUILDER_CACHE"), "mac release must keep electron-builder cache inside the workspace")
assert(releaseMacSource.includes("bun test"), "mac release must run desktop unit tests")
assert(releaseMacSource.includes("bundled-qwen-catalog.test.ts") && releaseMacSource.includes("test/tool/read.test.ts"), "mac release must run the empty-cache Qwen catalog and read-permission regressions")
assert(releaseMacSource.includes("verify:application-agent:package"), "mac release must verify the final packaged app")
assert(packageVerifySource.includes("readEgoRuntimeLock") && packageVerifySource.includes("verifyEgoRuntime"), "package verification must derive bundled Ego integrity from the runtime lock")
assert(packageVerifySource.includes("terra-paddleocr") && packageVerifySource.includes("ego-browser"), "package verification must inspect bundled OCR and Ego")
assert(packageVerifySource.includes("--no-default-browser-check") && packageVerifySource.includes("--no-first-run"), "package verification must inspect first-run/default-browser protections")
assert(packageVerifySource.includes("codesign") && packageVerifySource.includes("unzip") && packageVerifySource.includes("ditto"), "package verification must inspect both app and final ZIP archive")
assert(packageVerifySource.includes('const guiSmokeScript = join(root, "scripts/verify-application-agent-gui-dialog.ts")') && packageVerifySource.includes('[guiSmokeScript, archivedApp, guiRuntimeRoot]') && packageVerifySource.includes("Final ZIP app post-smoke code-signature verification"), "package verification must run the GUI smoke against the app extracted from the final ZIP")
assert(guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_ALERT_OBSERVED") && guiDialogVerifySource.includes("never Page.handleJavaScriptDialog") && !guiDialogVerifySource.includes("accept: true") && !guiDialogVerifySource.includes("accept:true"), "GUI dialog smoke must observe alerts and end the round without CDP accept:true")
assert(guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_BEFOREUNLOAD_OBSERVED") && guiDialogVerifySource.includes("never CDP accept/cancel") && guiDialogVerifySource.includes("pageInfo-only round confirms URL unchanged"), "GUI dialog smoke must end beforeunload rounds without CDP and confirm URL on the next pageInfo-only round")
assert(guiDialogVerifySource.includes("Page.handleJavaScriptDialog") && guiDialogVerifySource.includes("Smoke-only fixture teardown") && guiDialogVerifySource.includes("accept: false"), "GUI dialog smoke may use CDP only for modeled consultant/fixture teardown, never Agent alert handling")
assert(guiDialogVerifySource.includes("beforeunload") && guiDialogVerifySource.includes("dialog-frame.html") && guiDialogVerifySource.includes("unknown confirmation"), "GUI dialog smoke must cover beforeunload, a real same-origin iframe alert, and an unknown confirmation")
assert(guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_COLD_START") && guiDialogVerifySource.includes("cold-start fixture was contaminated") && guiDialogVerifySource.includes("product wrapper did not create Ego first-run state"), "GUI dialog smoke must cold-start the managed Ego runtime and onboarding state through the packaged product wrapper")
assert(guiDialogVerifySource.includes("TERRA_EGO_VISUAL_SCREENSHOT_VERIFIED") && guiDialogVerifySource.includes("captureScreenshot") && guiDialogVerifySource.includes("valid PNG"), "GUI dialog smoke must preserve the direct Ego visual screenshot workflow")
assert(guiDialogVerifySource.includes("stale packaged application still contains the retired terra-dialog-guard") && guiDialogVerifySource.includes("stale packaged app.asar still references the retired terra-dialog-guard"), "GUI dialog smoke must refuse a stale sidecar-containing artifact before launching Ego")
assert(!guiDialogVerifySource.includes('spawnSync("ditto"') && !guiDialogVerifySource.includes('spawnSync(\n  "open"'), "GUI dialog smoke must not pre-copy or pre-launch Ego outside the product wrapper")
assert(guiDialogVerifySource.includes("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE") && guiDialogVerifySource.includes("hasEgoBrowserService") && guiDialogVerifySource.includes("waitForBundledApp"), "GUI dialog smoke must refuse an external Ego Lite service before launching its isolated runtime")
assert(guiDialogVerifySource.includes("127.0.0.1") && !guiDialogVerifySource.includes("pathToFileURL"), "GUI dialog smoke must use a local loopback fixture instead of file URLs")
assert((guiDialogVerifySource.includes("port:0") || guiDialogVerifySource.includes("port: 0")) && guiDialogVerifySource.includes("TERRA_EDU_FIXTURE_READY_PATH") && guiDialogVerifySource.includes("last readiness payload") && !guiDialogVerifySource.includes("40_000 + (process.pid % 10_000)"), "GUI dialog smoke must use an OS-assigned port with an explicit readiness handshake and failure diagnostics")
assert(guiDialogVerifySource.includes("observePageAction") && guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_IFRAME_REOBSERVED"), "GUI dialog smoke must exercise direct concurrent iframe-dialog handling and reobserve afterward")
assert(guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_NAVIGATION_ALERT_CAPTURED") && guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_DELAYED_ALERT_AFTER_ACTION"), "GUI dialog smoke must cover direct initial-navigation alert capture and an alert delayed until after its action resolves")
assert(
  guiDialogVerifySource.indexOf('"cold-start task-space observation"') < guiDialogVerifySource.indexOf("initial navigation alert capture") &&
    guiDialogVerifySource.includes("const taskMatch = coldStart.match") &&
    guiDialogVerifySource.includes("navigationAttempt"),
  "GUI dialog smoke must stabilize and identify the single cold-start task space before its first page-changing navigation round",
)
assert(guiDialogVerifySource.includes("navigateInitialPageCapturingAlerts(${JSON.stringify(sourceUrl)}") && guiDialogVerifySource.includes("Page.addScriptToEvaluateOnNewDocument") && guiDialogVerifySource.includes("Runtime.addBinding") && !guiDialogVerifySource.includes("openOrReuseTab"), "GUI dialog smoke must capture synchronous load-time alert text through direct Ego CDP while navigating the selected blank target in place")
assert(!guiDialogVerifySource.includes('"deferred navigation dialog observation"') && !guiDialogVerifySource.includes("next-round pageInfo did not preserve the blocked navigation dialog"), "GUI dialog smoke must not rely on a load-time alert surviving helper detachment into another round")
assert(guiDialogVerifySource.includes("window.addEventListener('load'") && !guiDialogVerifySource.includes("navigationState='accepted'},600"), "GUI dialog smoke must bind the navigation alert to page load instead of racing a browser timer against the observer deadline")
assert(guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_CONFIRMATION_HANDOFF") && guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_PROMPT_HANDOFF") && guiDialogVerifySource.includes("handOffTaskSpace"), "GUI dialog smoke must prove both confirm and prompt are handed off without Agent answers")
assert(guiDialogVerifySource.includes("takeOverTaskSpace(taskId)\nconst info = await pageInfo()"), "GUI dialog smoke must prove an explicitly authorized takeover starts with a fresh observation")
assert(guiDialogVerifySource.includes("drainEvents()") && guiDialogVerifySource.includes("Network.requestWillBeSent") && guiDialogVerifySource.includes("Network.responseReceived"), "GUI dialog smoke must consume real CDP network events")
assert(
  guiDialogVerifySource.includes("TERRA_EGO_NETWORK_EVENT_SHAPE_FETCH_POST") &&
    guiDialogVerifySource.includes("TERRA_EGO_NETWORK_EVENT_SHAPE_DOCUMENT_POST") &&
    guiDialogVerifySource.includes("TERRA_EGO_NETWORK_EVENT_SHAPE_IFRAME_DOCUMENT_REDIRECT") &&
    guiDialogVerifySource.includes("request.params.frameId") &&
    guiDialogVerifySource.includes("request.params.loaderId") &&
    !guiDialogVerifySource.includes("networkEvidence"),
  "GUI dialog smoke must derive fetch/document/iframe redirect evidence from real CDP requestId/frameId/loaderId events",
)
assert(
  guiDialogVerifySource.includes("completeTaskSpace(taskId, { keep: true })") &&
    guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_COMPLETE_KEEP_TRUE") &&
    guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_PAGE_PRESERVED") &&
    guiDialogVerifySource.includes("TERRA_EGO_DIALOG_SMOKE_PROCESS_PRESERVED_AFTER_COMPLETION") &&
    !guiDialogVerifySource.includes("keep: false"),
  "GUI dialog smoke must prove keep:true completion preserves its task space, page, and Ego process",
)
assert(
  guiDialogVerifySource.includes("/^ego (?:lite|helper).*\\.ips$/i") &&
    guiDialogVerifySource.includes('join(diagnosticReports, "Retired")') &&
    guiDialogVerifySource.includes("newEgoCrashReports") &&
    guiDialogVerifySource.includes("attempt <= 20") &&
    guiDialogVerifySource.includes("Ego Lite crashed during the isolated smoke"),
  "GUI dialog smoke must poll active and retired locations for delayed main/helper Ego crash reports",
)
assert(
  guiDialogVerifySource.includes('["-KILL", String(pid)]') &&
    !guiDialogVerifySource.includes('["-TERM", String(pid)]') &&
    guiDialogVerifySource.includes("bundledRuntimePids") &&
    guiDialogVerifySource.includes("exact disposable runtime") &&
    !guiDialogVerifySource.includes('runWrapperRound("failure cleanup"') &&
    !guiDialogVerifySource.includes("keep: false"),
  "GUI dialog smoke must avoid Ego NSWindow teardown and kill only its exact disposable runtime",
)
assert(guiDialogVerifySource.includes("TERRA_EDU_PACKAGE_SMOKE_WRITE_OPENCODE") && guiDialogVerifySource.includes("TERRA_EDU_PACKAGE_SMOKE_CONFIG_WRITTEN") && guiDialogVerifySource.includes("spawnSync(appExecutable, []") && !guiDialogVerifySource.includes('from "../src/main/application-agent-opencode"'), "GUI dialog smoke must execute the config generator from the packaged app via env (Electron rejects unknown CLI switches)")
assert(guiDialogVerifySource.includes("stopSmokeLaunchedApps") && guiDialogVerifySource.includes("existingBundledAppPids") && guiDialogVerifySource.includes("sourceSignature") && guiDialogVerifySource.includes("runtimeSignature"), "GUI dialog smoke must preserve the packaged Ego source, verify the wrapper-created runtime, and clean up only the isolated runtime")
assert(guiDialogVerifySource.includes("originalMainPid") && guiDialogVerifySource.includes("singleLaunchClaim") && guiDialogVerifySource.includes("requireOriginalMainProcess"), "GUI dialog smoke must prove all rounds remain on its single original Ego process")
assert(packageVerifySource.includes("TERRA_EDU_GUI_SMOKE_RUNTIME_ROOT") && packageVerifySource.includes("killExactRuntimeProcesses") && packageVerifySource.includes("newStableEgoCrashReports") && packageVerifySource.includes("waitForEgoBrowserLaunchdServiceRemoval"), "The package verifier must own cleanup and crash detection even when the GUI child times out")
assert(guiDialogVerifySource.includes("required for distribution readiness"), "Unavailable GUI smoke must explicitly block distribution readiness")
assert(builderSource.includes("TERRA_EDU_MAC_TARGET"), "mac builder config must allow ZIP-only fallback when hdiutil is unavailable")
assert(releaseMacSource.includes("TERRA_EDU_MAC_TARGET=zip"), "mac release must ask electron-builder for only the signed app and ZIP")
assert(releaseMacSource.includes("dmgBlockmap") && releaseMacSource.includes("unlinkSync(dmgBlockmap)"), "mac release must remove the stale electron-builder DMG blockmap")
assert(releaseMacSource.includes("createDmgFromVerifiedApp") && releaseMacSource.includes("ditto ${app} ${stagedApp}"), "mac release must stage the verified app with ditto before creating a DMG")
assert(releaseMacSource.includes("codesign --verify --deep --strict ${stagedApp}") && releaseMacSource.includes("ln -s /Applications"), "mac release must verify the staged app and add the Applications link before creating a DMG")
assert(releaseMacSource.includes("hdiutil create -size 1m -fs APFS") && releaseMacSource.includes("hdiutil create -fs APFS") && releaseMacSource.includes("-srcfolder ${staging}"), "mac release must probe and create an APFS DMG directly from the verified staging directory")
assert(releaseMacSource.includes("ZIP-only"), "mac release must explain ZIP-only fallback")
assert(releaseMacSource.includes("/usr/bin/env -u APPLICATION_AGENT_WORKSPACE bun verify:application-agent`") && releaseMacSource.includes("/usr/bin/env -u APPLICATION_AGENT_WORKSPACE bun verify:application-agent:e2e`"), "Release verification must clear APPLICATION_AGENT_WORKSPACE while retaining opt-in diagnostics for direct verifier runs")

assert(source.includes("prepare_ego_task"), "ego-browser prepare action is missing")
assert(source.includes("record_observation"), "ego-browser observation record action is missing")
assert(source.includes("record_field_verified"), "ego-browser field verification record action is missing")
assert(source.includes("record_select_verified"), "ego-browser select verification record action is missing")
assert(source.includes("begin_save_attempt"), "ego-browser save-attempt action is missing")
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
assert(source.includes("retire_and_rebind_ego_task"), "ego-browser retire-and-rebind recovery action is missing")
assert(source.includes("complete_ego_task"), "ego-browser completion action is missing")
assert(source.includes("findExistingApplicationTask"), "Duplicate application task guard is missing")
assert(source.includes("reusedExisting"), "Duplicate application task reuse marker is missing")
assert(source.includes("platformLastOpenedAt"), "Application platform open debounce is missing")
assert(source.includes("beforeunload") && source.includes("确认 URL 未变") && !opencodeSource.includes("accept:false") && !opencodeSource.includes("accept: false"), "CUA beforeunload handling must end the round and confirm URL unchanged without CDP accept/cancel")
assert(source.includes("下一回合确认 URL 未变") || source.includes("下一回合先确认 URL 未变化") || source.includes("下一独立 heredoc 只 pageInfo，确认 URL 未变") || source.includes("confirm URL unchanged"), "CUA beforeunload handling must require a fresh URL-preservation check")
assert(source.includes("UNVERIFIED_SAVE_RECORDED"), "record_saved must not mark a page as verified saved")
assert(source.includes("remainingRequiredFields") && source.includes("UNVERIFIED_DYNAMIC_FORM"), "Dynamic-form verification must gate verified saves")
assert(source.includes("DYNAMIC_FORM_OBSERVATION_REQUIRED"), "Dynamic-form verification must require a matching fresh observation")
assert(source.includes("lastBrowserObservation"), "Verified saves must be tied to a concrete post-save browser observation")
assert(source.includes("pendingSaveAttempt") && source.includes("networkEvidence") && source.includes("serverConfirmed: true"), "Verified saves must bind a pending attempt to structured server confirmation")
assert(source.includes("POST\", \"PUT\", \"PATCH") && source.includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "GET, non-2xx, stale, and absent network evidence must not verify a save")
assert(source.includes("requestId === responseRequestId") && source.includes("sourceUrl === attemptSourceUrl"), "Save evidence must join compact request/response parts by requestId and bind them to the attempt source context")
assert(source.includes("new URL(requestUrl).origin === new URL(sourceFrameUrl).origin") && source.includes("responseUrl === postSaveFrameUrl"), "Save evidence must reject cross-origin background XHR/fetch and bind document responses to the observed destination frame")
assert(source.includes("requestFrameId === attempt.sourceFrameId") && source.includes("requestLoaderId === attempt.sourceLoaderId") && source.includes("responseIdentityMatchesRequest") && source.includes("postSaveObservation?.loaderId === requestLoaderId"), "Save evidence must bind request context while treating response frame/loader IDs as optional consistency checks")
assert(opencodeSource.includes('required: ["requestId", "status", "url", "resourceType", "observedAt"],'), "Network.responseReceived evidence must not require optional frameId/loaderId fields")
assert(source.includes("actionStartedAt") && source.includes("eventsDrainedAt") && source.includes("eventsDrainedAt - actionStartedAt <= 2 * 60_000"), "Save evidence must be bounded to the one real save-action event window")
assert(source.includes("postSaveObservedAt <= responseObservedAt") && source.includes("postSaveObservation?.currentUrl !== currentUrl"), "Save verification must require a fresh observation of the actual post-save page/frame destination")
assert(source.includes("same-frame ordinary/redirected document POST") && source.includes("compactEvidenceOnly") && source.includes("additionalProperties: false"), "Save evidence schema and verifier must support iframe/document redirects while rejecting unlisted sensitive network fields")
assert(source.includes("fillInput+Tab+readback") && source.includes("FIELD_OBSERVATION_REQUIRED"), "Field and select verification must bind real interaction/readback to the latest observation")
assert(source.includes("requireNumericTaskSpaceId"), "Browser audits must require the real numeric ego-browser task-space id")
assert(source.includes("record_blocker") && source.includes("blockerDisposition"), "Native dialog blockers must record a resolved or handoff disposition")
assert(source.includes("handoffPending") && source.includes("BROWSER_HANDOFF_PENDING"), "A handed-off task space must not be automatically prepared or reclaimed")
assert(source.includes("listTaskSpaces") && source.includes("legacyTaskSpaceConfirmationRequiredAt"), "Legacy workspaces without a task-space id must require advisor confirmation")
assert(source.includes("await claimTaskSpace(taskSpaceId)"), "A consultant-selected user/inactive legacy task space must resume with the official claimTaskSpace API")
assert(source.includes("resumeProbePending") && source.includes("BROWSER_RESUME_PROBE_REQUIRED") && source.includes("taskSpacePresent"), "resume_ego must require a listTaskSpaces probe before takeOver after handoff")
assert(source.includes("TERRA_EGO_TASKSPACE_RECOVERY_REQUIRED"), "ego-browser wrapper must hard-block takeOver/create while resume probe or rebind confirmation is pending")
assert(source.includes("cuaEvidence") && source.includes("input.detail"), "retire/resume evidence must accept detail as well as evidence/text")
assert(source.includes("TASK_SPACE_RETIRE_CONFIRMATION_REQUIRED") && source.includes("replacement_creation_authorized") && source.includes("retiredTaskSpaces"), "A disappeared numeric task-space id must use an explicit two-phase retire-and-rebind audit")
assert(source.includes("browserCompletionGateError") && source.includes("BROWSER_COMPLETION_SAVE_PENDING") && source.includes("BROWSER_COMPLETION_HANDOFF_PENDING") && source.includes("BROWSER_COMPLETION_REQUIRED_FIELDS_REMAIN") && source.includes("BROWSER_COMPLETION_OBSERVATION_REQUIRED"), "Browser completion must gate pending saves/handoffs/required fields and require fresh exact page evidence")
assert(source.includes("BROWSER_TASK_ALREADY_COMPLETED") && source.includes("TERRA_EGO_COMPLETION_HELPER_FAILED:") && source.includes("completionFailures") && source.includes("BROWSER_TASK_FINALIZATION_FAILED") && source.includes("completionHelperFailedAt"), "A failed final helper call must atomically archive completion and terminally lock the current browser session")
assert(
  source.includes("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE") &&
    source.includes("TERRA_EGO_UNSAFE_PAGE_RELOAD") &&
    source.includes("TERRA_EGO_SCRIPTED_SUBMIT_DENIED") &&
    source.includes("TERRA_EGO_SAVE_MUST_USE_OBSERVE_PAGE_ACTION") &&
    source.includes("TERRA_EGO_NATIVE_ALERT_CLICK_DENIED") &&
    source.includes("TERRA_EGO_ALERT_MUST_END_ROUND") &&
    source.includes('dialog\\\\.message"') &&
    !source.includes("dialog\\\\.message|kind:") &&
    source.includes("completeTaskSpace 只能使用可验证的字面量") &&
    source.includes("EGO_NODE_STDIN_COMPACT") &&
    source.includes('"$HELPER" "$@" <"$EGO_NODE_STDIN"') &&
    !opencodeSource.includes("/usr/bin/sandbox-exec") &&
    !opencodeSource.includes("NODE_OPTIONS=") &&
    !opencodeSource.includes("TERRA_EGO_NODE_PERMISSION_"),
  "The managed Ego wrapper must reject destructive closure, scripted submit, bare Save clicks, native-alert OK clicks, and same-round fill-after-dialog while preserving a direct pinned-helper execution path",
)
assert(
  opencodeSource.includes("TERRA_EGO_NODE_CAPABILITY_DENIED") &&
    opencodeSource.includes("exit 85") &&
    opencodeSource.includes("require[[:space:]]*") &&
    opencodeSource.includes("(fs|child_process") &&
    !opencodeSource.includes("grep -Eiq 'require'"),
  "The managed Ego wrapper must reject dangerous Node require/import patterns with exit 85 without bare require greps",
)
assert(
  opencodeSource.includes("if (ready)") &&
    opencodeSource.includes("materialReviewPrepareError") &&
    opencodeSource.includes("finalizePreparedSharedDossier(workspace, task)"),
  "Ready shared-dossier publish and finalize must gate on desktop material-review trust",
)
assert(opencodeSource.includes("managedEgoBrowserSkill") && opencodeSource.includes("Never reload an application page") && opencodeSource.includes("never close tabs programmatically") && opencodeSource.includes("Further filling requires the advisor to choose 重新填写"), "Generated Ego guidance must retain the locked upstream APIs while removing conflicting reload, close, and post-completion reuse instructions")
assert(opencodeSource.includes("READINESS_ATTEMPTS") && opencodeSource.includes('2>"$READINESS_STDERR"') && opencodeSource.includes("最后一次 taskspace list 退出码"), "The managed Ego wrapper must retry cold-start readiness and preserve the final real diagnostic")
assert(mainSource.includes('egoBrowserSingleLaunchSentinel: join(runtimeRoot, "single-launch.claim")') && opencodeSource.includes("SINGLE_LAUNCH_SENTINEL"), "The packaged GUI smoke must compile an atomic one-launch guard into its isolated wrapper")
assert(opencodeSource.includes("const testHelperAssignment = overrides?.egoBrowserTestHelperPath") && opencodeSource.includes(`: "TEST_HELPER_PATH=''"`), "The deterministic helper stub hook must be fixed at wrapper-generation time and empty for production generation")
assert(!applicationSource.includes("egoBrowserTestHelperPath") && !mainSource.includes("egoBrowserTestHelperPath") && !opencodeSource.includes("TERRA_EGO_BROWSER_TEST_HELPER"), "Production wrapper generation must leave TEST_HELPER_PATH empty and must not accept an environment override")
assert(packageVerifySource.includes("egoBrowserTestHelperPath") && packageVerifySource.includes("TERRA_EGO_BROWSER_TEST_HELPER"), "Package verification must enforce the compile-time-only helper stub boundary")
assert(source.includes('input.status === "阶段性完成" && progress.egoBrowser?.preparedAt && !progress.egoBrowser?.completedAt') && source.includes("BROWSER_COMPLETION_GATE_REQUIRED"), "application-agent_state must not bypass complete_ego_task with a historical verified save")
assert(source.includes('progress.egoBrowser?.completedAt ? "阶段性完成" : "正在填写申请平台"'), "Document regeneration must not mark a prepared browser task complete before complete_ego_task succeeds")
assert(
  source.includes("Only the helper's diagnostic stderr") &&
    source.slice(source.indexOf("Only the helper's diagnostic stderr"), source.indexOf("SCRIPT_FAILURE_CODE=")).includes('"$HELPER_STDERR"; then') &&
    !source.slice(source.indexOf("Only the helper's diagnostic stderr"), source.indexOf("SCRIPT_FAILURE_CODE=")).includes('"$HELPER_STDOUT"'),
  "Task-space control loss must never be inferred from browser cliLog/page stdout",
)
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
assert(applicationSource.includes("sharedWorkspacePath"), "Selection-list batch must persist the student shared dossier path")
assert(studentWorkspaceSource.includes('join(workspacePath, "schools")'), "Student workspace must contain school child workspaces")
assert(studentWorkspaceSource.includes("discoverApplicationTaskWorkspaces"), "Task discovery must support nested school workspaces")
assert(opencodeSource.includes("reusedSharedDossier"), "Later schools must skip repeated student dossier preparation")
assert(opencodeSource.includes("STUDENT_DOSSIER_NOT_READY"), "Later schools must wait for the shared dossier to be published")
assert(opencodeSource.includes("rawMaterialsSha256") && opencodeSource.includes("classifiedMaterialsSha256"), "Shared dossier integrity must include raw and classified material trees")
assert(opencodeSource.includes('"task=" + String(task.id'), "Every initial Ego task-space name must include the stable school task id")
assert(mainSource.includes("if (!found) return null"), "Missing school sessions must be reported so the renderer can start them with a real startup prompt")
assert(rendererSource.includes("?? await window.api.startApplicationAgentSession(latestTask, selectedModelId())"), "First entry into a later school must start its Agent and send the startup prompt")
assert(rendererSource.includes("startApplicationAgentSession(firstTask, selectedModelId())"), "Selection-list batch start must pass the selected model")
assert(rendererSource.includes("modelId: opencodeSession()?.modelID || selectedModelId()"), "Refill must reuse the live session model when available")
assert(rendererSource.includes("adoptOpenCodeSession"), "Renderer must sync the model selector when adopting a session")
assert(mainSource.includes("prepareApplicationAgentConfig(workspacePath, { modelId: resolved.optionID })"), "findApplicationAgentSession must rewrite workspace config with the session model")
assert(mainSource.includes("prepareApplicationAgentConfig(task.sessionDirectory, { modelId: resolved.optionID })"), "Resend/start paths must prepare workspace config with the resolved model")
assert(opencodeErrorSource.includes("exceeded limit on max bytes to request body") && opencodeErrorSource.includes("isRequestBodySizeLimit"), "Provider overflow detection must recognize request body size limits")
assert(opencodePromptSource.includes("BODY_SIZE_COMPACT_LIMIT") && opencodePromptSource.includes("isRequestBodySizeLimit"), "Prompt loop must cap body-size compaction retries")
assert(rendererSource.includes("shareSupplementAcrossSchools"), "Material review must explicitly distinguish school-only and student-wide supplements")
assert(rendererSource.includes("canEnterNextSchool"), "Batch navigation must prevent concurrent school execution before the shared dossier is ready")
assert(rendererSource.includes("下载无密码模板"), "Renderer must expose the selection-list template download")
assert(rendererSource.includes("创建 ${selectedSelectionRows().length} 个申请任务"), "Renderer must support multi-row task creation")
assert(!rendererSource.includes("申请平台密码"), "Renderer must not collect application platform passwords")
assert(applicationSource.includes("resumeStatus") && applicationSource.includes("task_control.json"), "Paused task projection must preserve the task's resumable status")
assert(rendererSource.includes("taskNeedsExplicitContinue") && rendererSource.includes("等待顾问接管浏览器"), "Browser-handoff tasks must expose the same explicit Continue action as paused tasks")
assert(rendererSource.includes("action=resume_ego") && rendererSource.includes("consultantConfirmed=true"), "Explicit browser-handoff continuation must instruct the Agent to record resume_ego confirmation")
assert(rendererSource.includes("不得在调用成功前运行 ego-browser"), "Browser-handoff continuation must not allow takeover before resume_ego succeeds")
assert(rendererSource.includes("taskSpacePresent") && rendererSource.includes("listTaskSpaces 探测"), "Browser-handoff continuation must require the two-phase resume list probe")

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
  assert(!existsSync(join(opencode, "bin/terra-dialog-guard")), "Workspace must not retain the retired native-dialog guard wrapper")
  assert(!tools.includes("export const native_dialog") && !tools.includes("application-agent_native_dialog") && !tools.includes("TERRA_EGO_NATIVE_DIALOG"), "Workspace tools must not expose the retired native Accessibility dialog sidecar")
  assert((statSync(join(opencode, "bin/ego-browser")).mode & 0o111) !== 0, "Workspace Terra ego-browser wrapper must be executable")
  assert(existsSync(join(opencode, "skills/ego-browser/SKILL.md")), "Workspace missing official ego-browser skill")
  assert(existsSync(join(opencode, "skills/ego-browser/TERRA_POLICY.md")), "Workspace missing separate Terra ego-browser policy")
  assert(existsSync(join(opencode, "skills/ego-browser/references/install.md")), "Workspace missing ego-browser install reference")
  const egoSkill = readFileSync(join(opencode, "skills/ego-browser/SKILL.md"), "utf8")
  assert(egoSkill.includes("PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs"), "Workspace ego-browser skill must use Terra pinned wrapper heredoc runtime")
  assert(egoSkill.includes("useOrCreateTaskSpace"), "Workspace ego-browser skill missing task spaces")
  for (const action of ["prepare_ego_task", "record_observation", "record_field_verified", "record_select_verified", "begin_save_attempt", "record_save_verified", "record_blocker", "record_browser_safety_stop", "resolve_browser_safety_stop"]) {
    assert(tools.includes(action), `Workspace ego-browser CUA coordination tool missing action: ${action}`)
  }
  assert(tools.includes("egoBrowser.safetyStop") || tools.includes("safetyStop"), "Workspace CUA tools must persist browser safetyStop on application_progress egoBrowser state")
  assert(tools.includes("TERRA_EGO_TASKSPACE_CONTAMINATED") && tools.includes("TERRA_EGO_ALERT_EVIDENCE_LOST"), "Workspace CUA tools must distinguish contamination and alert-evidence-lost markers")
  assert(tools.includes("BROWSER_SAFETY_DESKTOP_AUTHORIZATION_REQUIRED"), "Workspace CUA tools must reject model-only consultantConfirmed for alert_evidence_lost continue")
  assert(!tools.includes("browser_safety_stop.json"), "Workspace tools must not introduce a second browser safety truth file")
  const wrapperSource = readFileSync(join(opencode, "bin/ego-browser"), "utf8")
  assert(wrapperSource.includes("exit 82") && wrapperSource.includes("exit 83") && wrapperSource.includes("TERRA_EGO_TASKSPACE_CONTAMINATED") && wrapperSource.includes("TERRA_EGO_ALERT_EVIDENCE_LOST"), "Workspace wrapper must hard-stop both safety kinds with dedicated non-127 exit codes")
  assert(tools.includes("UNVERIFIED_SAVE_RECORDED"), "Workspace record_saved must require record_save_verified")
  assert(tools.includes("BLOCKED"), "Workspace risk tool missing BLOCKED response")
  assert(tools.includes("appendAudit"), "Workspace custom tools missing execution audit writer")
  assert(tools.includes("agent_execution_audit.json"), "Workspace custom tools missing execution audit file")
  assert(tools.includes("application_requirements.json"), "Workspace custom tools missing application requirements output")
}

console.log("Application Agent contract verification passed.")
console.log(`Skills: ${expectedSkills.length}, commands: ${expectedCommands.length}, tools: ${expectedTools.length}`)
