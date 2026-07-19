import { existsSync, readFileSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { writeOpenCodeConfig } from "../src/main/application-agent-opencode"
import { readEgoRuntimeLock } from "./ego-runtime-lock"

const requestedWorkspace = process.env.APPLICATION_AGENT_WORKSPACE?.trim()
const desktopRoot = fileURLToPath(new URL("..", import.meta.url))
const egoRuntimeLock = await readEgoRuntimeLock()
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
const requiredDirectories = [
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
  ".opencode/bin",
  ".opencode/commands",
  ".opencode/prompts",
  ".opencode/skills",
  ".opencode/tools",
]

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readText(path: string) {
  assert(existsSync(path), `Missing file: ${path}`)
  return readFileSync(path, "utf8")
}

function readJson(path: string) {
  return JSON.parse(readText(path)) as unknown
}

function readRecord(path: string) {
  const value = readJson(path)
  assert(isRecord(value), `Expected JSON object: ${path}`)
  return value
}

function assertDirectory(path: string) {
  assert(existsSync(path) && statSync(path).isDirectory(), `Missing directory: ${path}`)
}

function assertNonEmptyFile(path: string) {
  assert(existsSync(path) && statSync(path).isFile(), `Missing file: ${path}`)
  assert(statSync(path).size > 0, `File is empty: ${path}`)
}

function hasRawPasswordLine(body: string) {
  return [...body.matchAll(/password[ \t]*[:：]([^\n\r]*)/gi)].some((match) => {
    const value = String(match[1] || "").trim()
    return value && !/^\[已输入\]$/i.test(value) && !/^\[redacted\]$/i.test(value) && !/^\*+$/.test(value)
  })
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8")
}

async function createFixture(workspace: string) {
  await Promise.all(requiredDirectories.filter((item) => !item.startsWith(".opencode")).map((item) => mkdir(join(workspace, item), { recursive: true })))
  await writeFile(join(workspace, "00_original_backup/fixture-id.pdf"), "fixture identity material\n", "utf8")
  await writeFile(join(workspace, "01_classified_materials/identity/fixture-id.pdf"), "fixture identity material\n", "utf8")
  await writeFile(join(workspace, "04_logs/agent_log.md"), "# Agent 日志\n\n- OCR、材料整理和学生档案已生成。\n", "utf8")
  await writeFile(join(workspace, "04_logs/cua_log.md"), "# 浏览器自动化日志\n\n- CUA 尚未开始真实申请平台操作。\n", "utf8")
  await writeFile(join(workspace, "02_generated/student_profile.md"), "# 验证学生\n\n申请学校：Fixture University\n申请项目：Verification MS\n\n材料来源：00_original_backup\n\n缺失信息：待顾问确认。\n", "utf8")
  await writeFile(join(workspace, "02_generated/info_collection_form.md"), "# 信息补充清单\n\n待确认信息：护照英文名。\n", "utf8")
  await writeFile(join(workspace, "02_generated/material_collection_form.md"), "# 材料补充清单\n\n当前没有需要补充的材料。\n", "utf8")
  await writeFile(join(workspace, "02_generated/task_summary.md"), "# 申请任务总结\n\n最终提交、付款和推荐信邀请由顾问人工处理。\n", "utf8")
  await writeFile(join(workspace, "02_generated/missing_materials.docx"), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),)
  await writeJson(join(workspace, "03_state/task_state.json"), {
    id: "fixture-task",
    status: "可继续申请",
    input: {
      studentName: "验证学生",
      school: "Fixture University",
      program: "Verification MS",
      applicationType: "硕士申请",
      sourceFolder: "/fixture/materials",
    },
  })
  await writeJson(join(workspace, "03_state/task_input.json"), {
    studentName: "验证学生",
    school: "Fixture University",
    program: "Verification MS",
    applicationType: "硕士申请",
    sourceFolder: "/fixture/materials",
  })
  await writeJson(join(workspace, "03_state/materials_index.json"), [
    {
      fileName: "fixture-id.pdf",
      classifiedPath: "01_classified_materials/identity/fixture-id.pdf",
      category: "identity",
      originalPath: "00_original_backup/fixture-id.pdf",
    },
  ])
  await writeJson(join(workspace, "03_state/missing_items.json"), [
    {
      id: "fixture-missing-name",
      name: "护照英文名",
      type: "information",
      status: "needs_confirmation",
      whyNeeded: "申请平台需要与护照一致的英文姓名。",
      prepareFrom: "请顾问向学生确认。",
      formatRequirement: "按护照填写。",
    },
  ])
  await writeJson(join(workspace, "03_state/application_progress.json"), {
    currentPage: "申请平台准备中",
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
    browserBackend: "ego-browser",
    egoBrowser: { taskSpaceId: "101", taskSpaceName: "Fixture task space" },
  })
  await writeJson(join(workspace, "03_state/application_requirements.json"), {
    sources: [],
    fieldRequirements: [],
    materialRequirements: [],
    uncertainRequirements: [],
    notes: "fixture",
  })
  await writeFile(join(workspace, "02_generated/application_requirements.md"), "# 申请要求摘要\n\nFixture requirement summary.\n", "utf8")
  await writeJson(join(workspace, "03_state/cua_control.json"), {
    stopped: true,
    stoppedAt: "2026-07-17T00:00:00.000Z",
    reason: "legacy workspace browser stop",
    recentActions: [],
    consecutiveFailures: 0,
  })
  await writeJson(join(workspace, "03_state/task_control.json"), {
    paused: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reason: "legacy workspace remains paused until the consultant explicitly resumes it",
  })
  await writeJson(join(workspace, "03_state/material_review.json"), { status: "approved", mode: "skip" })
  await writeJson(join(workspace, "03_state/agent_execution_audit.json"), [
    { tool: "application-agent_workspace", context: { directory: workspace } },
    { tool: "application-agent_materials", context: { directory: workspace } },
    { tool: "application-agent_state", context: { directory: workspace } },
  ])
  await mkdir(join(workspace, ".opencode/node_modules"), { recursive: true })
  await mkdir(join(workspace, ".opencode/bin"), { recursive: true })
  await writeFile(join(workspace, ".opencode/node_modules/stale-dependency.txt"), "must not survive a config refresh\n", "utf8")
  await writeFile(join(workspace, ".opencode/bin/terra-dialog-guard"), "obsolete native dialog sidecar\n", "utf8")
  await writeFile(join(workspace, ".opencode/legacy-config.txt"), "must survive a config refresh\n", "utf8")
  await writeOpenCodeConfig(workspace)
}

function verifyWorkspace(workspace: string, expectPaused: boolean) {
  assertDirectory(workspace)
  for (const directory of requiredDirectories) assertDirectory(join(workspace, directory))

  for (const file of [
    ".opencode/opencode.json",
    ".opencode/agents/application-agent.md",
    ".opencode/prompts/application-agent.md",
    ".opencode/tools/application-agent.ts",
    ".opencode/bin/ego-browser",
    ".opencode/skills/ego-browser/TERRA_POLICY.md",
    "03_state/task_state.json",
    "03_state/application_progress.json",
    "03_state/cua_control.json",
    "03_state/task_control.json",
    "03_state/agent_execution_audit.json",
  ]) {
    assertNonEmptyFile(join(workspace, file))
  }
  assert(!existsSync(join(workspace, ".opencode/node_modules")), "Config refresh must replace stale OpenCode dependency artifacts.")
  assert(!existsSync(join(workspace, ".opencode/bin/terra-dialog-guard")), "Config refresh must delete an obsolete native-dialog guard wrapper.")
  assert(readText(join(workspace, ".opencode/legacy-config.txt")) === "must survive a config refresh\n", "Config refresh must preserve unrelated advisor workspace files.")

  const wrapper = join(workspace, ".opencode/bin/ego-browser")
  assert((statSync(wrapper).mode & 0o111) !== 0, "Workspace ego-browser wrapper must be executable.")
  const wrapperSyntax = spawnSync("/bin/sh", ["-n", wrapper], { encoding: "utf8" })
  assert(wrapperSyntax.status === 0, `Workspace ego-browser wrapper must be valid POSIX shell: ${wrapperSyntax.stderr || "unknown syntax error"}`)
  const wrapperSource = readText(wrapper)
  assert(
    !/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/u.test(wrapperSource),
    "Shell variables immediately followed by non-ASCII text must use braces so a UTF-8 shell cannot extend the variable name.",
  )
  assert(wrapperSource.includes("TEST_HELPER_PATH=''") && !wrapperSource.includes("TERRA_EGO_BROWSER_TEST_HELPER"), "A production workspace wrapper must compile the test helper path to an empty literal with no environment override.")
  assert(wrapperSource.includes("SINGLE_LAUNCH_SENTINEL=''") && !wrapperSource.includes("TERRA_EGO_SINGLE_LAUNCH"), "Ordinary production workspaces must not inherit the package-smoke one-launch sentinel through the environment.")
  assert(wrapperSource.includes("READINESS_ATTEMPTS=15"), "Ordinary production workspaces must retain the bounded 15-attempt cold-start readiness window.")
  assert(wrapperSource.includes("--no-default-browser-check"), "Workspace wrapper must suppress the default-browser prompt.")
  assert(wrapperSource.includes("--no-first-run"), "Workspace wrapper must suppress the Chromium first-run prompt.")
  assert(wrapperSource.includes("--password-store=basic") && wrapperSource.includes("--use-mock-keychain"), "Workspace wrapper must avoid blocking macOS ego keychain dialogs during managed launches.")
  assert(wrapperSource.includes('/usr/bin/open --env "HOME=$HOME" --env "CFFIXED_USER_HOME=$CFFIXED_USER_HOME"'), "Workspace wrapper must pass an isolated HOME and CFFIXED_USER_HOME into the actual cold-started Ego process.")
  assert(!wrapperSource.includes("NODE_OPTIONS=") && !wrapperSource.includes("--permission"), "Workspace wrapper must not inject service-wide Node flags into Ego Lite; those flags can prevent the browser service itself from starting.")
  assert(wrapperSource.includes(`EXPECTED_VERSION='${egoRuntimeLock.version}'`), "Workspace wrapper must derive the Ego Lite version from the runtime lock.")
  assert(wrapperSource.includes(`EXPECTED_HELPER_SHA256='${egoRuntimeLock.egoBrowserHelperSha256}'`), "Workspace wrapper must pin the runtime-lock helper hash.")
  assert(wrapperSource.includes(`EXPECTED_CDHASH='${egoRuntimeLock.cdHash}'`), "Workspace wrapper must pin the runtime-lock app CDHash.")
  assert(wrapperSource.includes("UPDATER_EXECUTABLE"), "Workspace wrapper must reject an enabled ego lite updater payload.")
  assert(wrapperSource.includes("EXPECTED_BUNDLE_ID='com.citrolabs.ego.lite'") && wrapperSource.includes("EXPECTED_TEAM_ID='JGQLC6YQYJ'") && wrapperSource.includes("Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)"), "Workspace wrapper must require Citro's official Ego Lite identity.")
  assert(wrapperSource.includes("Versions/$EXPECTED_VERSION/Helpers/ego-browser"), "Workspace wrapper must prefer the helper matching its pinned version.")
  assert(wrapperSource.includes('RUNTIME_ROOT="$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"'), "Workspace wrapper must isolate mutable Ego runtime files outside the signed Terra app.")
  assert(wrapperSource.includes('/usr/bin/ditto "$APP_PATH" "$STAGED_APP"'), "Workspace wrapper must launch a copy of the signed Ego source instead of the source itself.")
  assert(wrapperSource.includes('/usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/"'), "Workspace wrapper must avoid relaunching its managed Ego runtime on every browser round.")
  assert(wrapperSource.includes("com.citrolabs.ego.lite.ego-browser") && wrapperSource.includes("/bin/launchctl print"), "Workspace wrapper must check external Ego state without invoking the helper.")
  assert(!wrapperSource.includes("existing_service_status"), "Workspace wrapper must not invoke ego-browser during external-service preflight.")
  assert(wrapperSource.includes('"$HELPER" taskspace list'), "Workspace wrapper must use a read-only Ego readiness handshake before browser work.")
  assert(wrapperSource.includes("helper_status=$?"), "Workspace wrapper must translate a service conflict that happens after readiness into an explicit marker.")
  assert(wrapperSource.includes("HELPER_STDOUT") && wrapperSource.includes("HELPER_STDERR") && wrapperSource.includes("/bin/cat"), "Workspace wrapper must capture and replay all helper output.")
  assert(wrapperSource.includes("TERRA_EGO_SCRIPT_FAILED") && wrapperSource.includes("exit 79"), "Workspace wrapper must surface a hidden nonzero nodejs exit even when the helper exits zero.")
  assert(wrapperSource.includes("TERRA_EGO_TASKSPACE_CONTROL_LOST") && wrapperSource.includes("exit 80"), "Workspace wrapper must surface user/inactive control loss as nonzero.")
  const controlLossParser = wrapperSource.split("\n").find((line) => line.includes("^Error: (user is controlling")) || ""
  assert(controlLossParser.includes('"$HELPER_STDERR"') && !controlLossParser.includes('"$HELPER_STDOUT"'), "Task-space control loss must be parsed only from helper stderr, never from cliLog/page stdout.")
  assert(controlLossParser.includes("^Error: (") && !controlLossParser.includes("user.*control"), "Task-space control loss must use anchored Ego Error lines instead of broad page-text matching.")
  assert(wrapperSource.includes("页面动作是否已经执行无法确认"), "A post-readiness Ego service failure must preserve an unknown page outcome instead of implying no action occurred.")
  assert(wrapperSource.includes("TERRA_EGO_BROWSER_VERSION_CONFLICT"), "Workspace wrapper must make an incompatible external Ego service explicit.")
  assert(wrapperSource.includes("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE"), "Workspace wrapper must leave an external compatible Ego Lite service untouched.")
  assert(wrapperSource.includes("exit 76"), "Workspace wrapper must report browser-service failures with a non-127 exit code.")
  assert(wrapperSource.includes("TERRA_EGO_TASKSPACE_CONTAMINATED") && wrapperSource.includes("exit 82"), "Workspace wrapper must hard-stop contaminated task spaces with a dedicated non-127 exit code.")
  assert(wrapperSource.includes("TERRA_EGO_ALERT_EVIDENCE_LOST") && wrapperSource.includes("exit 83"), "Workspace wrapper must hard-stop lost alert evidence with a dedicated non-127 exit code distinct from contamination.")
  assert(wrapperSource.includes("BROWSER_SAFETY_OBSERVATION_REQUIRED") && wrapperSource.includes("exit 84"), "Workspace wrapper must block write/control commands while safety observation is required.")
  assert(wrapperSource.includes('safetyStop') && wrapperSource.includes("application_progress.json"), "Workspace wrapper must read the single progress.egoBrowser.safetyStop field rather than a second safety JSON.")
  assert(!wrapperSource.includes("browser_safety_stop.json"), "Workspace wrapper must not introduce a second browser safety truth file.")
  assert(!wrapperSource.includes("cua_control.json"), "Legacy cua_control.stopped must never gate the ego-browser wrapper.")
  assert(wrapperSource.includes("EGO_CONFIG") && wrapperSource.includes("prepare_ego_first_run") && wrapperSource.includes("not_first_run"), "Workspace wrapper must atomically suppress Ego first-run without overwriting existing config.")
  assert(wrapperSource.includes("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE") && wrapperSource.includes("EGO_NODE_STDIN_COMPACT"), "Workspace wrapper must inspect nodejs stdin before launching Ego.")
  assert(wrapperSource.includes("completeTaskSpace 只能使用可验证的字面量") && wrapperSource.includes("keep[[:space:]]*:[[:space:]]*true"), "Workspace wrapper must allow only a mechanically verified literal keep:true completion call.")
  assert(wrapperSource.includes("TERRA_EGO_UNSAFE_PAGE_RELOAD") && wrapperSource.includes("grep -Eiq 'closeTab'") && wrapperSource.includes("grep -Eiq 'reload'"), "Workspace wrapper must reject automatic reloads and every direct or aliased programmatic tab close before Ego starts.")
  assert(wrapperSource.includes('"$HELPER" "$@" <"$EGO_NODE_STDIN"'), "Workspace wrapper must forward the model-authored nodejs source directly to the pinned Ego helper.")
  assert(!wrapperSource.includes("/usr/bin/sandbox-exec") && !wrapperSource.includes("TERRA_EGO_NODE_PERMISSION_"), "Workspace wrapper must not add a sandbox or permission broker around Ego's independent browser service.")

  const config = readRecord(join(workspace, ".opencode/opencode.json"))
  assert(isRecord(config.permission) && isRecord(config.permission.read) && config.permission.read["*"] === "allow", "Top-level OpenCode permission must preserve ordinary read access.")
  assert(isRecord(config.permission.edit), "Top-level OpenCode permission must define edit protection.")
  assert(isRecord(config.agent) && isRecord(config.agent["application-agent"]), "Generated config must include the ordinary application-agent.")
  const applicationAgent = config.agent["application-agent"]
  assert(isRecord(applicationAgent.permission) && isRecord(applicationAgent.permission.read) && applicationAgent.permission.read["*"] === "allow", "Ordinary application-agent must retain read access to authoritative state.")
  assert(isRecord(applicationAgent.permission.edit), "Ordinary application-agent must define edit protection.")
  const applicationAgentMarkdown = readText(join(workspace, ".opencode/agents/application-agent.md"))
  for (const protectedPath of [".opencode/**", "03_state/application_progress.json", "03_state/task_state.json", "03_state/task_control.json", "03_state/agent_execution_audit.json", "03_state/material_review.json", "03_state/task_input.json"]) {
    assert(config.permission.edit[protectedPath] === "deny", `Top-level permission.edit must protect ${protectedPath}.`)
    assert(applicationAgent.permission.edit[protectedPath] === "deny", `Ordinary application-agent permission.edit must protect ${protectedPath}.`)
    assert(applicationAgentMarkdown.includes(`    "${protectedPath}": deny`), `Agent Markdown permission.edit must protect ${protectedPath}.`)
  }

  for (const skill of skills) {
    const body = readText(join(workspace, ".opencode/skills", skill, "SKILL.md"))
    assert(body.includes("执行步骤"), `Skill lacks executable SOP steps: ${skill}`)
    assert(body.includes("执行原则"), `Skill lacks execution principles: ${skill}`)
  }
  for (const command of commands) assertNonEmptyFile(join(workspace, ".opencode/commands", `${command}.md`))

  const egoSkill = readText(join(workspace, ".opencode/skills/ego-browser/SKILL.md"))
  const terraPolicy = readText(join(workspace, ".opencode/skills/ego-browser/TERRA_POLICY.md"))
  assert(egoSkill.includes(`version: "${egoRuntimeLock.officialSkill.version}"`) && egoSkill.includes(`date: "${egoRuntimeLock.officialSkill.date}"`), "Generated ego-browser skill must retain the locked Current framework Skill identity.")
  assert(!egoSkill.includes("Default to `{ keep: false }`") && !egoSkill.includes("Try switching to the real tab, reloading") && !egoSkill.includes("close them as you go") && !egoSkill.includes("work after `completeTaskSpace(..., { keep: true })` — resume the original task space"), "Generated ego-browser skill must remove upstream close/reload/post-completion guidance that conflicts with managed application safety.")
  assert(egoSkill.includes("blocked by the managed Terra-Edu wrapper before Ego starts") && egoSkill.includes("Never reload an application page") && egoSkill.includes("never close tabs programmatically") && egoSkill.includes("Further filling requires the advisor to choose 重新填写"), "Generated ego-browser skill must replace unsafe upstream guidance with the managed keep-true/no-reload/no-close/terminal-completion contract.")
  assert(!egoSkill.includes("await openOrReuseTab('https://example.com'") && egoSkill.includes("navigateInitialPageCapturingAlerts") && egoSkill.includes("Page.addScriptToEvaluateOnNewDocument") && egoSkill.includes("Runtime.addBinding") && egoSkill.includes("never intercepts confirm, prompt, or beforeunload"), "Generated Ego guidance must keep initial navigation on the selected target and capture information-only load alerts through direct Ego CDP without guessing interactive dialogs.")
  assert(!egoSkill.includes("cliLog(await snapshotText())") && egoSkill.includes("const first = await pageInfo()") && egoSkill.includes("taskSpaceId: task.id, first") && egoSkill.includes("End this first round after persisting task.id"), "Generated Ego quick start must create and observe the blank task space, persist its numeric ID, and end without snapshotting or navigating.")
  assert(egoSkill.includes("Closing all tabs in a task space is equivalent to closing that task space."), "Generated ego-browser skill must retain the Current framework task-space closing semantics.")
  assert(terraPolicy.includes('PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs'), "Terra policy must require the managed workspace wrapper.")
  assert(egoSkill.includes("handOffTaskSpace"), "ego-browser skill must document consultant handoff.")
  assert(egoSkill.includes("Never call `takeOverTaskSpace` on your own"), "ego-browser skill must forbid automatic task-space takeover.")
  assert(egoSkill.includes("pageInfoTimeoutMs = 1500") && egoSkill.includes("settleMs = 2000"), "ego-browser skill must bound each pageInfo call and observe a post-action quiet window.")
  assert(egoSkill.indexOf("const actionPromise = Promise.resolve()") < egoSkill.indexOf("Promise.resolve().then(() => pageInfo())"), "ego-browser skill must start the action before concurrently polling pageInfo.")
  assert(egoSkill.includes("return { kind: 'dialog', info: lastInfo, actionPromise }"), "ego-browser skill must expose an iframe dialog while the triggering action remains pending.")
  assert(terraPolicy.includes("所有 confirm 或 prompt") && terraPolicy.includes("不得由 Agent 猜测"), "Terra policy must hand off every confirm and prompt without guessing.")
  assert(terraPolicy.includes("dialogUrl") && terraPolicy.includes("dialogFrameId"), "Terra policy must keep iframe dialog identity separate from the top-level current URL.")
  assert(terraPolicy.includes("pageInfo() 返回 dialog") && terraPolicy.includes("Page.handleJavaScriptDialog") && terraPolicy.includes("iframe 原生 alert 会阻塞触发它的 click/save Promise"), "Terra policy must use direct Ego pageInfo/CDP handling for iframe dialogs.")
  assert(terraPolicy.includes("结果只是“未决”，不是已经失败") && terraPolicy.includes("此时不得调用 application-agent_cua record_failure、不得交接顾问") && terraPolicy.includes("若属于 observePageAction unknown，必须严格按上一条立即结束") && terraPolicy.includes("只有该新观察明确证明动作失败或需要人工处理后，才可记录失败或交接"), "Terra policy must treat unknown actions as pending until a separate pageInfo-only observation proves failure or handoff is necessary.")
  assert(terraPolicy.includes("helper 回合退出时自动消掉仍未处理的弹窗") && terraPolicy.includes("只在初次导航期间临时替换无选择分支的 window.alert") && terraPolicy.includes("它绝不替换 confirm、prompt 或 beforeunload"), "Terra policy must reflect the observed load-alert detach behavior and limit interception to information-only initial alerts.")
  assert(terraPolicy.includes("captureScreenshot('05_screenshots/<unique-name>.png')") && terraPolicy.includes("OpenCode `read` on that exact") && terraPolicy.includes("image/png"), "Terra policy must require explicit workspace screenshots followed by exact OpenCode image reads.")
  assert(terraPolicy.includes("fillInput+Tab+readback") && terraPolicy.includes("click+snapshot+click-option+reobserve") && terraPolicy.includes("Vue internals"), "Terra policy must require real generic interactions and ban framework-internal writes.")
  assert(terraPolicy.includes("completeTaskSpace(taskSpaceId, { keep: true })") && terraPolicy.includes("一律不得使用 keep:false"), "Terra policy must preserve completed Ego windows instead of exercising the crashing native close path.")
  const cuaSkill = readText(join(workspace, ".opencode/skills/cua-application-filling/SKILL.md"))
  assert(cuaSkill.includes("绝不自动抢回控制"), "CUA skill must forbid automatic task-space takeover.")
  assert(cuaSkill.includes("Page.handleJavaScriptDialog"), "CUA skill must guide native dialog handling.")
  assert(cuaSkill.includes("observePageAction") && cuaSkill.includes("先启动动作但不 await"), "CUA skill must observe iframe dialogs while the triggering action is still pending.")

  const prompt = readText(join(workspace, ".opencode/prompts/application-agent.md"))
  assert(prompt.includes("snapshotText"), "Generated prompt must require observation before continuing browser work.")
  assert(prompt.includes("handOffTaskSpace"), "Generated prompt must require consultant handoff when needed.")
  assert(!prompt.includes("申请平台密码："), "Generated prompt must not collect an application-platform password.")

  const tools = readText(join(workspace, ".opencode/tools/application-agent.ts"))
  for (const action of ["prepare_ego_task", "retire_and_rebind_ego_task", "record_observation", "record_field_verified", "record_select_verified", "record_dynamic_form_verified", "begin_save_attempt", "record_save_verified", "record_blocker", "handoff_to_consultant", "complete_ego_task"]) {
    assert(tools.includes(action), `Workspace CUA coordination tool missing action: ${action}`)
  }
  assert(tools.includes("UNVERIFIED_SAVE_RECORDED"), "record_saved must not be treated as a verified save.")
  assert(tools.includes("browserBackend = \"ego-browser\""), "Workspace CUA tool must record the ego-browser backend.")
  assert(!tools.includes("export const native_dialog") && !tools.includes("application-agent_native_dialog") && !tools.includes("TERRA_EGO_NATIVE_DIALOG"), "Workspace tools must not expose the retired native Accessibility dialog sidecar.")
  assert(tools.includes("serverConfirmed: true") && tools.includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "Workspace CUA must require structured server-confirmed saves.")
  const refillAgent = readText(join(workspace, ".opencode/agents/application-refill-agent.md"))
  assert(refillAgent.includes('"05_screenshots/**": allow'), "Refill agent must be allowed to read its explicit workspace screenshots.")
  assert(refillAgent.includes("model: opencode-go/qwen3.7-plus"), "Refill agent must use Qwen 3.7 Plus.")

  const task = readRecord(join(workspace, "03_state/task_state.json"))
  const input = task.input
  assert(isRecord(input), "task_state.json must include task.input.")
  const school = typeof input.school === "string" ? input.school : ""
  const program = typeof input.program === "string" ? input.program : ""
  const profile = readText(join(workspace, "02_generated/student_profile.md"))
  assert(school && profile.includes(school), "student_profile.md must identify its task school.")
  assert(program && profile.includes(program), "student_profile.md must identify its task program.")

  const progress = readRecord(join(workspace, "03_state/application_progress.json"))
  for (const key of ["completedPages", "savedPages", "uploadedMaterials", "failedActions", "highRiskBlocks"]) {
    assert(Array.isArray(progress[key]), `application_progress.json.${key} must be an array.`)
  }
  assert(progress.browserBackend === "ego-browser", "application_progress.json must record ego-browser as its backend.")

  const cuaControl = readRecord(join(workspace, "03_state/cua_control.json"))
  const taskControl = readRecord(join(workspace, "03_state/task_control.json"))
  if (expectPaused) {
    assert(cuaControl.stopped === true, "A paused legacy workspace must retain its stopped browser control state after config refresh.")
    assert(cuaControl.reason === "legacy workspace browser stop", "Config refresh must preserve the browser-stop reason.")
    assert(taskControl.paused === true, "A paused legacy workspace must remain paused after config refresh.")
    assert(taskControl.reason === "legacy workspace remains paused until the consultant explicitly resumes it", "Config refresh must preserve the paused-task reason.")
    const pausedWrapper = spawnSync(wrapper, [], { cwd: workspace, encoding: "utf8" })
    assert(pausedWrapper.status === 75, "Paused workspace wrapper must stop before it can launch ego lite.")
    assert(pausedWrapper.stderr.includes("TERRA_EGO_TASK_PAUSED"), "Paused workspace wrapper must report the explicit paused-task sentinel.")
  } else {
    assert(typeof cuaControl.stopped === "boolean", "cua_control.json must include stopped.")
    assert(typeof taskControl.paused === "boolean", "task_control.json must include paused.")
  }
  const materials = readJson(join(workspace, "03_state/materials_index.json"))
  assert(Array.isArray(materials) && materials.length > 0, "materials_index.json must contain classified records.")
  for (const item of materials) {
    assert(isRecord(item), "Material index entries must be objects.")
    assert(typeof item.classifiedPath === "string", "Material index entry lacks classifiedPath.")
    assert(existsSync(join(workspace, item.classifiedPath)), `Classified file missing on disk: ${item.classifiedPath}`)
  }

  for (const file of ["02_generated/missing_materials.docx", "02_generated/task_summary.md", "04_logs/agent_log.md", "04_logs/cua_log.md"]) {
    assertNonEmptyFile(join(workspace, file))
  }
  const docx = readFileSync(join(workspace, "02_generated/missing_materials.docx"))
  assert(docx[0] === 0x50 && docx[1] === 0x4b, "missing_materials.docx must be a ZIP/DOCX package.")
  assert(readText(join(workspace, "02_generated/task_summary.md")).includes("最终提交"), "task_summary.md must retain high-risk manual reminders.")

  const audit = readJson(join(workspace, "03_state/agent_execution_audit.json"))
  assert(Array.isArray(audit), "agent_execution_audit.json must be an array.")
  for (const file of [
    "03_state/task_state.json",
    "03_state/task_input.json",
    "03_state/application_progress.json",
    "03_state/missing_items.json",
    "03_state/materials_index.json",
    "03_state/cua_control.json",
    "03_state/task_control.json",
    "03_state/material_review.json",
    "02_generated/student_profile.md",
    "02_generated/task_summary.md",
  ]) {
    const body = readText(join(workspace, file))
    assert(!/sk-[A-Za-z0-9_-]{20,}/.test(body), `Potential API key leaked into workspace text file: ${file}`)
    assert(!hasRawPasswordLine(body), `Potential raw password leaked into workspace text file: ${file}`)
  }
}

async function verifyDirectNodeHelperContract(root: string) {
  if (process.platform !== "darwin") return
  const workspace = join(root, "node-helper-sandbox-workspace")
  const helper = join(root, "ego-browser-helper-stub")
  const readinessLog = join(root, "ego-browser-readiness.log")
  await mkdir(join(workspace, "03_state"), { recursive: true })
  await mkdir(join(workspace, "00_original_backup"), { recursive: true })
  await writeFile(join(workspace, "00_original_backup/upload-readable.txt"), "sandbox upload read fixture\n", "utf8")
  await writeFile(
    helper,
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "taskspace" ] && [ "\${2:-}" = "list" ]; then
  printf '%s\\n' readiness >> '${readinessLog.replaceAll("'", "'\\''")}'
  [ "\${TERRA_TEST_EGO_READINESS_STATUS:-0}" -eq 0 ] || exit "\${TERRA_TEST_EGO_READINESS_STATUS}"
  printf '%s\\n' '[]'
  exit 0
fi
[ "\${1:-}" = "nodejs" ] || exit 64
SOURCE=$(/bin/cat)
case "$SOURCE" in
  *USER_READ_MARKER*) printf 'WORKSPACE_READ_OK:'; /bin/cat '${join(workspace, "00_original_backup/upload-readable.txt").replaceAll("'", "'\\''")}' ;;
esac
case "$SOURCE" in
  *ORDINARY_HELPER_STUB_OK*)
    printf '%s\\n' 'ORDINARY_HELPER_STUB_OK'
    printf '%s\\n' 'STUB_COMPLETE_TASK_SPACE {"taskSpaceId":101,"options":{"keep":true}}'
    ;;
esac
`,
    "utf8",
  )
  await chmod(helper, 0o755)
  await writeOpenCodeConfig(workspace, { egoBrowserTestHelperPath: helper, egoBrowserReadinessAttempts: 2 })
  const wrapper = join(workspace, ".opencode/bin/ego-browser")
  const unavailableResult = spawnSync(wrapper, ["nodejs"], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, TERRA_TEST_EGO_READINESS_STATUS: "42" },
    input: `cliLog("READINESS_FAILURE_MUST_NOT_RUN")\n`,
  })
  assert(unavailableResult.status === 76, `A non-retryable readiness failure must use the browser-service exit code: ${unavailableResult.stderr}`)
  assert(unavailableResult.stderr.includes("taskspace list 退出码 42"), "A readiness failure next to Chinese punctuation must preserve the exact shell status without extending its variable name.")
  assert(!unavailableResult.stderr.includes("unbound variable"), "A localized wrapper message must never turn adjacent UTF-8 punctuation into part of a shell variable name.")
  assert(!unavailableResult.stdout.includes("READINESS_FAILURE_MUST_NOT_RUN"), "A failed readiness handshake must not execute browser code.")
  assert(readText(readinessLog).trim().split("\n").length === 2, "A non-conflict cold-start status must be retried until the configured readiness deadline instead of failing on its first transient response.")

  const readResult = spawnSync(wrapper, ["nodejs"], {
    cwd: workspace,
    encoding: "utf8",
    input: `cliLog("USER_READ_MARKER")\n`,
  })
  assert(readResult.status === 0 && readResult.stdout.includes("WORKSPACE_READ_OK:sandbox upload read fixture"), `The direct nodejs contract must retain workspace read access for uploads: ${readResult.stderr}`)

  const keepResult = spawnSync(wrapper, ["nodejs"], {
    cwd: workspace,
    encoding: "utf8",
    input: "console.log('ORDINARY_HELPER_STUB_OK')\nawait completeTaskSpace(101, { keep: true })\n",
  })
  assert(keepResult.status === 0 && keepResult.stdout.includes("ORDINARY_HELPER_STUB_OK"), `The direct wrapper must preserve ordinary helper execution: ${keepResult.stderr}`)
  assert(keepResult.stdout.includes('"taskSpaceId":101') && keepResult.stdout.includes('"keep":true'), "The required completeTaskSpace(..., { keep:true }) helper call must remain allowed.")

  const wrapperSource = readText(wrapper)
  assert(wrapperSource.includes('"$HELPER" "$@" <"$EGO_NODE_STDIN"'), "Every nodejs round must reach the pinned helper without a second execution backend.")
  assert(!wrapperSource.includes("NODE_OPTIONS=") && !wrapperSource.includes("/usr/bin/sandbox-exec"), "Direct Ego rounds must not inherit the removed service-wide permission experiment.")
}

type GeneratedCuaTool = {
  cua: {
    execute: (args: { input: Record<string, unknown> }, ctx: { directory: string }) => Promise<unknown>
  }
  state: {
    execute: (args: { input: Record<string, unknown> }, ctx: { directory: string }) => Promise<unknown>
  }
}

async function verifyCuaStateTransitions(workspace: string) {
  await writeJson(join(workspace, "03_state/task_control.json"), {
    paused: false,
    updatedAt: new Date().toISOString(),
    reason: "deterministic CUA transition verification",
  })
  const wrapper = join(workspace, ".opencode/bin/ego-browser")
  const destructiveCompletion = spawnSync(wrapper, ["nodejs"], {
    cwd: workspace,
    encoding: "utf8",
    input: "await completeTaskSpace(101, { keep: false })\n",
  })
  assert(destructiveCompletion.status === 81 && destructiveCompletion.stderr.includes("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE"), "Wrapper must reject completeTaskSpace keep:false before launching Ego.")
  ;[
    "await completeTaskSpace(101)\n",
    "await completeTaskSpace(101, {})\n",
    "const keep = false\nawait completeTaskSpace(101, { keep })\n",
    "const finish = completeTaskSpace\nawait finish(101, { keep: true })\n",
    "await globalThis['complete' + 'TaskSpace'](101, { keep: false })\n",
    "await completeTaskSpace(101, { keep: true })\nawait completeTaskSpace(102, { keep: false })\n",
  ].forEach((input) => {
    const result = spawnSync(wrapper, ["nodejs"], { cwd: workspace, encoding: "utf8", input })
    assert(result.status === 81 && result.stderr.includes("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE"), `Wrapper must reject every unverifiable completeTaskSpace form before launching Ego: ${input}`)
  })
  const destructiveTabLoop = spawnSync(wrapper, ["nodejs"], {
    cwd: workspace,
    encoding: "utf8",
    input: "const tabs = await listTabs()\nfor (const tab of tabs) await closeTab(tab.targetId)\n",
  })
  assert(destructiveTabLoop.status === 81 && destructiveTabLoop.stderr.includes("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE"), "Wrapper must reject a loop that closes every tab before launching Ego.")
  const destructiveSingleTab = spawnSync(wrapper, ["nodejs"], {
    cwd: workspace,
    encoding: "utf8",
    input: "await closeTab(123)\n",
  })
  assert(destructiveSingleTab.status === 81 && destructiveSingleTab.stderr.includes("TERRA_EGO_UNSAFE_TASKSPACE_CLOSE"), "Wrapper must reject even a single programmatic tab close so it cannot accidentally destroy the final application window.")
  ;[
    "await reload()\n",
    "const close = closeTab\nawait close(123)\n",
    "await cdp('Page.reload')\n",
    "const refresh = reload\nawait refresh()\n",
    "await js('location.reload()')\n",
  ].forEach((input) => {
    const result = spawnSync(wrapper, ["nodejs"], { cwd: workspace, encoding: "utf8", input })
    const expectedMarker = input.includes("closeTab") ? "TERRA_EGO_UNSAFE_TASKSPACE_CLOSE" : "TERRA_EGO_UNSAFE_PAGE_RELOAD"
    assert(result.status === 81 && result.stderr.includes(expectedMarker), `Wrapper must reject direct and aliased application-page destruction paths before launching Ego: ${input}`)
  })
  await writeJson(join(workspace, "03_state/material_review.json"), { status: "pending", mode: "skip" })
  const stoppedLegacyControlWrapper = spawnSync(join(workspace, ".opencode/bin/ego-browser"), [], { cwd: workspace, encoding: "utf8" })
  assert(stoppedLegacyControlWrapper.status === 127, "A pending material review must block before ego lite starts.")
  assert(stoppedLegacyControlWrapper.stderr.includes("material review is pending"), "cua_control.stopped must not gate a resumed task before the material-review check.")
  await writeJson(join(workspace, "03_state/material_review.json"), { status: "approved", mode: "skip" })
  await writeJson(join(workspace, "03_state/application_progress.json"), {
    currentPage: "Fixture application form",
    currentUrl: "https://fixture.example/application",
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
    browserBackend: "ego-browser",
    egoBrowser: { taskSpaceId: "101", taskSpaceName: "Fixture task space", backend: "ego-browser", preparedAt: new Date().toISOString() },
  })

  const generatedTools = (await import(pathToFileURL(join(workspace, ".opencode/tools/application-agent.ts")).href)) as GeneratedCuaTool
  const executeCua = (input: Record<string, unknown>) => generatedTools.cua.execute({ input }, { directory: workspace })
  const executeState = (input: Record<string, unknown>) => generatedTools.state.execute({ input }, { directory: workspace })
  const url = "https://fixture.example/application"
  const title = "Fixture application form"
  const mainFrameContext = { frameId: "fixture-main-frame", loaderId: "fixture-main-loader", frameUrl: url }

  const resolvedDialog = await executeCua({
    action: "record_blocker",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: JSON.stringify({
      dialog: {
        url: "https://fixture.example/frame",
        frameId: "fixture-frame",
        type: "alert",
        message: "Fixture validation alert\n- Date must use dd/mm/yyyy",
      },
    }),
    detail: "Direct Ego Page.handleJavaScriptDialog acknowledged the single-button validation alert.",
    blockerDisposition: "resolved",
  })
  assert(String(resolvedDialog).includes("已记录已解决"), "A directly handled Ego dialog must flow through resolved blocker recording.")
  const resolvedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(Array.isArray(resolvedProgress.blockedDialogs), "Resolved direct-Ego dialogs must be retained in the audit state.")
  assert(JSON.stringify(resolvedProgress.blockedDialogs).includes("Date must use dd/mm/yyyy"), "Resolved blocker evidence must preserve the complete validation message.")

  const resumeWithoutHandoff = await executeCua({ action: "resume_ego", taskSpaceId: "101", consultantConfirmed: true })
  assert(String(resumeWithoutHandoff).includes("BROWSER_HANDOFF_REQUIRED"), "resume_ego must reject a task space that was not handed off to the consultant.")

  const firstObservation = await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "Initial pageInfo and snapshot show the fixture form.",
  })
  assert(String(firstObservation).includes("页面观察已记录"), "record_observation must accept an observed numeric task space.")

  const rejectedDirectFieldWrite = await executeCua({
    action: "record_field_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    fieldLabel: "Given name",
    text: "Ada",
    expectedText: "Ada",
    evidence: "Fresh readback from the observed field.",
    interactionMethod: "direct DOM value setter",
    readbackValue: "Ada",
  })
  assert(String(rejectedDirectFieldWrite).includes("REAL_INTERACTION_REQUIRED"), "Field verification must reject direct DOM writes.")

  const verifiedField = await executeCua({
    action: "record_field_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    fieldLabel: "Given name",
    text: "Ada",
    expectedText: "Ada",
    evidence: "fillInput, real Tab, and fresh observed readback.",
    interactionMethod: "fillInput+Tab+readback",
    readbackValue: "Ada",
  })
  assert(String(verifiedField).includes("字段已记录"), "A field must verify only with matching context, real interaction, and readback.")

  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "Fresh reobservation after the select rerender shows the chosen option.",
  })
  const verifiedSelect = await executeCua({
    action: "record_select_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    fieldLabel: "Study mode",
    optionLabel: "Full time",
    evidence: "Click, new option snapshot, real option click, and reobservation.",
    interactionMethod: "click+snapshot+click-option+reobserve",
    readbackValue: "Full time",
  })
  assert(String(verifiedSelect).includes("选项已记录"), "A select must verify only after open/snapshot/option-click/reobserve with matching readback.")

  const beginWithoutDynamicCheck = await executeCua({
    action: "begin_save_attempt",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Attempted begin before a fresh dynamic check.",
  })
  assert(String(beginWithoutDynamicCheck).includes("UNVERIFIED_DYNAMIC_FORM"), "A save attempt must be rejected until the latest dynamic form check passes.")

  const dynamicCheck = await executeCua({
    action: "record_dynamic_form_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Fresh rescan found no visible empty required fields.",
    remainingRequiredFields: [],
  })
  assert(String(dynamicCheck).includes("动态表单已复查通过"), "A matching fresh observation with no required fields must pass the dynamic form gate.")

  const begunSave = await executeCua({
    action: "begin_save_attempt",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Fresh dynamic check authorizes one real save interaction.",
  })
  const saveAttemptId = String((JSON.parse(String(begunSave)) as Record<string, unknown>).saveAttemptId || "")
  assert(saveAttemptId, "begin_save_attempt must return a durable saveAttemptId.")

  const saveWithoutNetwork = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The fixture form displays a saved banner.",
    readbackValue: "Saved",
    saveAttemptId,
    confirmed: true,
  })
  assert(String(saveWithoutNetwork).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "A page banner without structured network evidence must not verify a save.")

  const saveActionStartedAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const saveRequestObservedAt = new Date().toISOString()
  const saveResponseObservedAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const saveEventsDrainedAt = new Date().toISOString()
  const saveNetworkContext = {
    taskSpaceId: "101",
    sourceUrl: url,
    sourceTitle: title,
    sourceFrameId: mainFrameContext.frameId,
    sourceLoaderId: mainFrameContext.loaderId,
    sourceFrameUrl: mainFrameContext.frameUrl,
    actionStartedAt: saveActionStartedAt,
    eventsDrainedAt: saveEventsDrainedAt,
  }
  const rejectedGetEvidence = {
    ...saveNetworkContext,
    request: {
      requestId: "fixture-get-request",
      method: "GET",
      url: "https://fixture.example/application/status",
      observedAt: saveRequestObservedAt,
      frameId: mainFrameContext.frameId,
      loaderId: mainFrameContext.loaderId,
    },
    response: {
      requestId: "fixture-get-request",
      status: 200,
      resourceType: "fetch",
      url: "https://fixture.example/application/status",
      observedAt: saveResponseObservedAt,
      frameId: mainFrameContext.frameId,
      loaderId: mainFrameContext.loaderId,
    },
  }
  const saveWithGet = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "GET status request plus saved banner.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: rejectedGetEvidence,
    confirmed: true,
  })
  assert(String(saveWithGet).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "GET evidence must never verify a save.")

  const saveWithMismatchedRequestIds = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A response whose requestId does not match its request event.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: { ...rejectedGetEvidence.request, requestId: "fixture-save-request", method: "POST" },
      response: { ...rejectedGetEvidence.response, requestId: "different-response-request" },
    },
    confirmed: true,
  })
  assert(String(saveWithMismatchedRequestIds).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "Request and response evidence must have the same non-empty requestId.")

  const saveWithSensitiveNetworkFields = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A nominally matched response that also carries forbidden request metadata.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: { ...rejectedGetEvidence.request, requestId: "fixture-sensitive-request", method: "POST", headers: { authorization: "forbidden" } },
      response: { ...rejectedGetEvidence.response, requestId: "fixture-sensitive-request" },
    },
    confirmed: true,
  })
  assert(String(saveWithSensitiveNetworkFields).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "CUA must reject network evidence containing headers/body or other unlisted sensitive fields.")

  const saveWithCrossOriginFetchPair = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "An unrelated cross-origin response was paired with the save-time request.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: { ...rejectedGetEvidence.request, requestId: "fixture-cross-origin-request", method: "POST" },
      response: { ...rejectedGetEvidence.response, requestId: "fixture-cross-origin-request", url: "https://analytics.example/events" },
    },
    confirmed: true,
  })
  assert(String(saveWithCrossOriginFetchPair).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "XHR/fetch request and response evidence must share one origin.")

  const saveWithCrossOriginBackgroundPair = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A cross-origin analytics POST used the same form frame and loader during the click window.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: {
        ...rejectedGetEvidence.request,
        requestId: "fixture-cross-origin-background",
        method: "POST",
        url: "https://analytics.example/events",
      },
      response: {
        ...rejectedGetEvidence.response,
        requestId: "fixture-cross-origin-background",
        url: "https://analytics.example/events",
      },
    },
    confirmed: true,
  })
  assert(String(saveWithCrossOriginBackgroundPair).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "A same-frame/loader XHR pair must still be rejected when its origin differs from the source form frame.")

  const saveWithBackgroundPost = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A same-origin background POST occurred inside the click window but from another frame and loader.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: {
        ...rejectedGetEvidence.request,
        requestId: "fixture-background-request",
        method: "POST",
        frameId: "analytics-frame",
        loaderId: "analytics-loader",
      },
      response: {
        ...rejectedGetEvidence.response,
        requestId: "fixture-background-request",
        frameId: "analytics-frame",
        loaderId: "analytics-loader",
      },
    },
    confirmed: true,
  })
  assert(String(saveWithBackgroundPost).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "A background POST in the save window must not verify when its frame/loader differ from the frozen form context.")

  const saveWithResponseIdentityMismatch = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The request uses the form context but optional response IDs contradict that request.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: { ...rejectedGetEvidence.request, requestId: "fixture-response-context-mismatch", method: "POST" },
      response: {
        ...rejectedGetEvidence.response,
        requestId: "fixture-response-context-mismatch",
        frameId: "other-response-frame",
        loaderId: "other-response-loader",
      },
    },
    confirmed: true,
  })
  assert(String(saveWithResponseIdentityMismatch).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "Optional response frame/loader IDs must be rejected when they contradict the same requestId's request context.")

  const saveWithPreActionPost = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A same-frame POST was observed immediately before the actual save click.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence: {
      ...rejectedGetEvidence,
      request: {
        ...rejectedGetEvidence.request,
        requestId: "fixture-pre-action-request",
        method: "POST",
        observedAt: new Date(Date.parse(saveActionStartedAt) - 1).toISOString(),
      },
      response: {
        ...rejectedGetEvidence.response,
        requestId: "fixture-pre-action-request",
      },
    },
    confirmed: true,
  })
  assert(String(saveWithPreActionPost).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "A same-frame/loader POST observed outside the save-action window must be rejected as background traffic.")

  const networkEvidence = {
    ...saveNetworkContext,
    request: {
      requestId: "fixture-save-request",
      method: "POST",
      url: "https://fixture.example/application/save",
      observedAt: saveRequestObservedAt,
      frameId: mainFrameContext.frameId,
      loaderId: mainFrameContext.loaderId,
    },
    response: {
      requestId: "fixture-save-request",
      status: 200,
      resourceType: "fetch",
      url: "https://fixture.example/application/save",
      observedAt: saveResponseObservedAt,
    },
  }
  const saveWithoutPostSaveObservation = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The server responded but no newer page readback exists.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence,
    confirmed: true,
  })
  assert(String(saveWithoutPostSaveObservation).includes("UNVERIFIED_POST_SAVE_OBSERVATION"), "A server response still requires a newer post-save observation/readback.")

  await new Promise((resolve) => setTimeout(resolve, 5))
  const postSaveObservation = await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "Fresh pageInfo and snapshot show the fixture saved banner.",
  })
  assert(String(postSaveObservation).includes("页面观察已记录"), "The post-save observation must be accepted before recording a save.")

  const verifiedSave = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The fixture form displays a saved banner after the action.",
    readbackValue: "Saved",
    saveAttemptId,
    networkEvidence,
    confirmed: true,
  })
  assert(String(verifiedSave).includes("页面已记录为 ego-browser 验证保存"), "A save must be recorded only after the dynamic check and post-save observation.")
  const verifiedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(Array.isArray(verifiedProgress.savedPages) && verifiedProgress.savedPages.length === 1, "Verified save must add exactly one saved page.")
  assert(verifiedProgress.savedPages[0]?.serverConfirmed === true, "Verified save must persist serverConfirmed:true.")
  assert(verifiedProgress.savedPages[0]?.url === url, "A same-page save must retain the freshly observed page as its destination.")
  assert(verifiedProgress.savedPages[0]?.networkEvidence?.request?.requestId === verifiedProgress.savedPages[0]?.networkEvidence?.response?.requestId, "Persisted same-page save evidence must keep the CUA-verified request/response pair.")
  const stateCompletionBypass = await executeState({
    status: "阶段性完成",
    message: "Attempt to bypass complete_ego_task with one historical verified save.",
  }).then(
    (value) => String(value),
    (error) => String(error),
  )
  assert(stateCompletionBypass.includes("BROWSER_COMPLETION_GATE_REQUIRED"), "application-agent_state must not bypass complete_ego_task merely because one historical verified save exists.")

  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "Fresh source-page observation before an ordinary same-frame document POST.",
  })
  await executeCua({
    action: "record_dynamic_form_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The main-frame form has no visible empty required fields.",
    remainingRequiredFields: [],
  })
  const begunDocumentSave = await executeCua({
    action: "begin_save_attempt",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Fresh source context authorizes one ordinary document save.",
  })
  const documentSaveAttemptId = String((JSON.parse(String(begunDocumentSave)) as Record<string, unknown>).saveAttemptId || "")
  assert(documentSaveAttemptId, "An ordinary document save must preserve its source frame context under a durable ID.")
  const documentActionStartedAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const documentRequestObservedAt = new Date().toISOString()
  const documentResponseObservedAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const documentEventsDrainedAt = new Date().toISOString()
  const documentLoaderId = "fixture-main-document-loader"
  const documentNetworkEvidence = {
    taskSpaceId: "101",
    sourceUrl: url,
    sourceTitle: title,
    sourceFrameId: mainFrameContext.frameId,
    sourceLoaderId: mainFrameContext.loaderId,
    sourceFrameUrl: mainFrameContext.frameUrl,
    actionStartedAt: documentActionStartedAt,
    eventsDrainedAt: documentEventsDrainedAt,
    request: {
      requestId: "fixture-document-request",
      method: "POST",
      url,
      observedAt: documentRequestObservedAt,
      frameId: mainFrameContext.frameId,
      loaderId: documentLoaderId,
    },
    response: {
      requestId: "fixture-document-request",
      status: 200,
      resourceType: "document",
      url,
      observedAt: documentResponseObservedAt,
    },
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: mainFrameContext.frameId,
    loaderId: documentLoaderId,
    frameUrl: url,
    evidence: "Fresh main-frame observation after the ordinary document POST.",
  })
  const verifiedDocumentSave = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The ordinary same-frame document POST returned 2xx and the new loader was observed.",
    readbackValue: "Saved",
    saveAttemptId: documentSaveAttemptId,
    networkEvidence: documentNetworkEvidence,
    confirmed: true,
  })
  assert(String(verifiedDocumentSave).includes("页面已记录为 ego-browser 验证保存"), "A non-redirected 2xx document POST in the same frame must be accepted with its new loader.")

  const iframeSourceContext = {
    frameId: "fixture-iframe",
    loaderId: "fixture-iframe-source-loader",
    frameUrl: "https://fixture.example/embedded/application",
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...iframeSourceContext,
    evidence: "Fresh top-level observation identifies the embedded application form frame before Save & Continue.",
  })
  await executeCua({
    action: "record_dynamic_form_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The embedded form has no visible empty required fields before Save & Continue.",
    remainingRequiredFields: [],
  })
  const begunRedirectSave = await executeCua({
    action: "begin_save_attempt",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Fresh iframe source context authorizes one real Save & Continue action.",
  })
  const redirectSaveAttemptId = String((JSON.parse(String(begunRedirectSave)) as Record<string, unknown>).saveAttemptId || "")
  assert(redirectSaveAttemptId, "An iframe Save & Continue attempt must preserve its source context under a durable ID.")
  const redirectActionStartedAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const redirectRequestObservedAt = new Date().toISOString()
  const redirectResponseObservedAt = new Date().toISOString()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const redirectEventsDrainedAt = new Date().toISOString()
  const iframeDestinationUrl = "https://fixture.example/embedded/review"
  const iframeDestinationLoaderId = "fixture-iframe-destination-loader"
  const redirectNetworkEvidence = {
    taskSpaceId: "101",
    sourceUrl: url,
    sourceTitle: title,
    sourceFrameId: iframeSourceContext.frameId,
    sourceLoaderId: iframeSourceContext.loaderId,
    sourceFrameUrl: iframeSourceContext.frameUrl,
    actionStartedAt: redirectActionStartedAt,
    eventsDrainedAt: redirectEventsDrainedAt,
    request: {
      requestId: "fixture-iframe-redirect-request",
      method: "POST",
      url: "https://fixture.example/embedded/continue",
      observedAt: redirectRequestObservedAt,
      frameId: iframeSourceContext.frameId,
      loaderId: iframeDestinationLoaderId,
    },
    response: {
      requestId: "fixture-iframe-redirect-request",
      status: 200,
      resourceType: "document",
      url: iframeDestinationUrl,
      observedAt: redirectResponseObservedAt,
      redirected: true,
    },
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: "Fresh top-level observation shows the embedded frame reached its post-save review destination.",
  })
  const redirectWithWrongDestination = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A document response that does not match the freshly observed iframe destination.",
    readbackValue: "Review application",
    saveAttemptId: redirectSaveAttemptId,
    networkEvidence: {
      ...redirectNetworkEvidence,
      response: { ...redirectNetworkEvidence.response, url: "https://fixture.example/embedded/unrelated" },
    },
    confirmed: true,
  })
  assert(String(redirectWithWrongDestination).includes("SERVER_SAVE_CONFIRMATION_REQUIRED"), "An iframe document redirect must match the stripped destination frame URL, not the unchanged top-level URL.")
  const verifiedRedirectSave = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The embedded Save & Continue reached a freshly observed iframe destination after a server-confirmed POST redirect.",
    readbackValue: "Review application",
    saveAttemptId: redirectSaveAttemptId,
    networkEvidence: redirectNetworkEvidence,
    confirmed: true,
  })
  assert(String(verifiedRedirectSave).includes("页面已记录为 ego-browser 验证保存"), "An iframe POST redirect must verify without requiring the top-level URL to change.")
  const redirectProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(redirectProgress.savedPages?.length === 3, "Fetch, ordinary document POST, and iframe redirect saves must all be retained.")
  assert(redirectProgress.savedPages[2]?.url === url, "An iframe redirect must retain the real unchanged top-level URL.")
  assert(redirectProgress.savedPages[2]?.networkEvidence?.sourceFrameId === iframeSourceContext.frameId && redirectProgress.savedPages[2]?.networkEvidence?.response?.url === iframeDestinationUrl, "An iframe redirect must retain its source frame identity and verified destination frame URL.")

  const staleCompletion = await executeCua({
    action: "complete_ego_task",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: "Fresh top-level observation shows the embedded frame reached its post-save review destination.",
    remainingRequiredFields: [],
    completionDisposition: "automation_complete",
    confirmed: true,
  })
  assert(String(staleCompletion).includes("BROWSER_COMPLETION_OBSERVATION_REQUIRED"), "Completion must require a new page/frame observation after the latest verified save, not reuse the save readback.")

  const completionEvidence = "Fresh completion-page observation shows all automatable sections are finished and the next action is manual."
  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: completionEvidence,
  })
  const completionWithRewrittenEvidence = await executeCua({
    action: "complete_ego_task",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: "A rewritten completion claim that was not the latest browser observation.",
    remainingRequiredFields: [],
    completionDisposition: "manual_boundary_reached",
    confirmed: true,
  })
  assert(String(completionWithRewrittenEvidence).includes("BROWSER_COMPLETION_OBSERVATION_REQUIRED"), "Completion evidence must be passed unchanged from the newest recorded browser observation.")
  const completionWithRequiredField = await executeCua({
    action: "complete_ego_task",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: completionEvidence,
    remainingRequiredFields: ["Degree title"],
    completionDisposition: "manual_boundary_reached",
    confirmed: true,
  })
  assert(String(completionWithRequiredField).includes("BROWSER_COMPLETION_REQUIRED_FIELDS_REMAIN"), "Completion must reject a latest-page scan with visible required fields.")

  await executeCua({
    action: "record_dynamic_form_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Completion fixture has no visible empty required fields before a deliberately pending save.",
    remainingRequiredFields: [],
  })
  await executeCua({
    action: "begin_save_attempt",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Create a real pending attempt for the completion gate regression.",
  })
  const completionWithPendingSave = await executeCua({
    action: "complete_ego_task",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: completionEvidence,
    remainingRequiredFields: [],
    completionDisposition: "manual_boundary_reached",
    confirmed: true,
  })
  assert(String(completionWithPendingSave).includes("BROWSER_COMPLETION_SAVE_PENDING"), "Completion must reject while a save attempt is pending.")
  await executeCua({
    action: "record_blocker",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "A known alert safely ended the deliberately pending completion save attempt.",
    detail: "Resolved deterministic completion-gate fixture.",
    blockerDisposition: "resolved",
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: completionEvidence,
  })
  const verifiedCompletion = await executeCua({
    action: "complete_ego_task",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    frameId: iframeSourceContext.frameId,
    loaderId: iframeDestinationLoaderId,
    frameUrl: iframeDestinationUrl,
    evidence: completionEvidence,
    remainingRequiredFields: [],
    completionDisposition: "manual_boundary_reached",
    confirmed: true,
    detail: "All automatable fields are saved; final submission remains manual.",
  })
  assert(String(verifiedCompletion).includes("页面/frame 观察"), "Completion must pass only with the fresh exact completion observation and no pending gates.")
  const stateAfterVerifiedCompletion = await executeState({
    status: "阶段性完成",
    message: "Completion state follows the successful complete_ego_task gate.",
  })
  assert(String(stateAfterVerifiedCompletion).includes("状态已更新：阶段性完成"), "application-agent_state may mark the browser stage complete only after complete_ego_task writes completedAt.")

  for (const action of ["record_observation", "record_blocker", "record_save_verified", "retire_and_rebind_ego_task", "resume_ego", "complete_ego_task"]) {
    const rejectedAfterCompletion = await executeCua({
      action,
      taskSpaceId: "101",
      currentUrl: url,
      pageTitle: title,
      ...mainFrameContext,
      evidence: "No browser mutation is allowed after the terminal completion gate.",
      detail: "Terminal-state negative fixture.",
    })
    assert(String(rejectedAfterCompletion).includes("BROWSER_TASK_ALREADY_COMPLETED"), `${action} must not mutate a browser task after complete_ego_task succeeds.`)
  }
  const ordinaryFailureAfterCompletion = await executeCua({
    action: "record_failure",
    taskSpaceId: "101",
    detail: "An unrelated later failure must not reopen the completed browser task.",
  })
  assert(String(ordinaryFailureAfterCompletion).includes("BROWSER_TASK_ALREADY_COMPLETED"), "An ordinary record_failure must not provide a generic escape from terminal completion.")
  const wrongTaskSpaceFinalizationFailure = await executeCua({
    action: "record_failure",
    taskSpaceId: "999",
    detail: "TERRA_EGO_COMPLETION_HELPER_FAILED: fixture helper failed for a different task space",
  })
  assert(String(wrongTaskSpaceFinalizationFailure).includes("BROWSER_TASK_ALREADY_COMPLETED"), "A final-helper failure may archive completion only for the exact completed task-space ID.")
  const finalizationFailure = await executeCua({
    action: "record_failure",
    taskSpaceId: "101",
    detail: "TERRA_EGO_COMPLETION_HELPER_FAILED: deterministic keep:true helper failure after complete_ego_task",
  })
  assert(String(finalizationFailure).includes("BROWSER_COMPLETION_FINALIZATION_FAILED_RECORDED"), "The one final keep:true helper failure must atomically archive and revoke the premature completion.")
  const progressAfterFinalizationFailure = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(isRecord(progressAfterFinalizationFailure.egoBrowser), "Finalization failure fixture must retain the Ego task-space identity.")
  assert(!progressAfterFinalizationFailure.egoBrowser.completedAt, "A failed final keep:true helper call must clear completedAt.")
  assert(!progressAfterFinalizationFailure.egoBrowser.completionDisposition && !progressAfterFinalizationFailure.egoBrowser.completionObservation, "A failed final helper call must clear all active completion proof.")
  assert(typeof progressAfterFinalizationFailure.egoBrowser.completionHelperFailedAt === "string", "A failed final helper call must persist a terminal finalization-failed lock.")
  assert(progressAfterFinalizationFailure.egoBrowser.completionHelperFailureDetail === "TERRA_EGO_COMPLETION_HELPER_FAILED: deterministic keep:true helper failure after complete_ego_task", "The terminal finalization lock must preserve the original helper failure detail.")
  assert(Array.isArray(progressAfterFinalizationFailure.completionFailures), "A failed final helper call must append a completion-failure archive.")
  const archivedFinalizationFailure = progressAfterFinalizationFailure.completionFailures.at(-1)
  assert(isRecord(archivedFinalizationFailure) && isRecord(archivedFinalizationFailure.archivedCompletion) && Boolean(archivedFinalizationFailure.archivedCompletion.completedAt), "A failed final helper call must preserve the revoked completion in an audit archive.")

  const lockedProgress = readText(join(workspace, "03_state/application_progress.json"))
  for (const lockedAction of [
    { action: "record_observation", taskSpaceId: "101", currentUrl: url, pageTitle: title, ...mainFrameContext, evidence: "No observation may resume a finalization-failed session." },
    { action: "record_save_verified", taskSpaceId: "101", currentUrl: url, pageTitle: title, evidence: "No save may resume a finalization-failed session." },
    { action: "retire_and_rebind_ego_task", taskSpaceId: "101", replacementTaskSpaceId: "606", rebindMode: "existing", missingTaskSpaceConfirmed: true, consultantConfirmed: true, evidence: "No rebind may resume a finalization-failed session." },
    { action: "complete_ego_task", taskSpaceId: "101", currentUrl: url, pageTitle: title, ...mainFrameContext, evidence: "No completion may resume a finalization-failed session.", remainingRequiredFields: [], completionDisposition: "manual_boundary_reached", confirmed: true },
  ]) {
    const rejectedAfterFinalizationFailure = await executeCua(lockedAction)
    assert(String(rejectedAfterFinalizationFailure).includes("BROWSER_TASK_FINALIZATION_FAILED"), `${lockedAction.action} must remain rejected after the final keep:true helper fails.`)
    assert(String(rejectedAfterFinalizationFailure).includes("重新填写"), "The terminal finalization error must direct the consultant to the only recovery path.")
    assert(readText(join(workspace, "03_state/application_progress.json")) === lockedProgress, `${lockedAction.action} must not mutate terminal finalization-failed progress.`)
  }

  // The remaining transition cases use a fresh progress fixture, mirroring the
  // explicit progress reset performed by a consultant-created refill session.
  await writeJson(join(workspace, "03_state/application_progress.json"), {
    currentPage: "Fixture application form",
    currentUrl: url,
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
    browserBackend: "ego-browser",
    egoBrowser: { taskSpaceId: "101", taskSpaceName: "Fixture task space", backend: "ego-browser", preparedAt: new Date().toISOString() },
  })

  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "Fresh observation immediately before the blocker fixture.",
  })
  await executeCua({
    action: "record_dynamic_form_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Dynamic form check is deliberately nonempty before blocker invalidation.",
    remainingRequiredFields: [],
  })
  const beforeBlockerProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(Array.isArray(beforeBlockerProgress.dynamicFormChecks) && beforeBlockerProgress.dynamicFormChecks.length === 1, "The blocker invalidation fixture must begin with a real dynamic-form check.")

  const handoffBlocker = await executeCua({
    action: "record_blocker",
    taskSpaceId: "101",
    currentUrl: url,
    dialogUrl: "https://fixture.example.test/embedded-validation-frame",
    dialogFrameId: "fixture-frame-101",
    pageTitle: title,
    evidence: "A confirm dialog has an unclear consequence.",
    detail: "Unknown confirm dialog requires advisor handling.",
    blockerDisposition: "handoff",
  })
  assert(String(handoffBlocker).includes("顾问接管"), "A handoff blocker must enter the advisor takeover state.")
  const completionDuringHandoff = await executeCua({
    action: "complete_ego_task",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "Completion must not proceed while browser control belongs to the consultant.",
    remainingRequiredFields: [],
    completionDisposition: "manual_boundary_reached",
    confirmed: true,
  })
  assert(String(completionDuringHandoff).includes("BROWSER_COMPLETION_HANDOFF_PENDING"), "Completion must reject any pending consultant handoff or takeover.")
  const blockedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(!("lastBrowserObservation" in blockedProgress), "A blocker must invalidate the browser observation captured before the dialog.")
  assert(blockedProgress.lastObservedAt === "", "A blocker must clear the prior browser observation timestamp.")
  assert(Array.isArray(blockedProgress.dynamicFormChecks) && blockedProgress.dynamicFormChecks.length === 0, "A blocker must invalidate dynamic-form checks captured before the dialog.")
  assert(blockedProgress.currentUrl === url, "An iframe dialog URL must never replace the top-level application URL.")
  assert(blockedProgress.blockedDialogs?.at(-1)?.dialogUrl === "https://fixture.example.test/embedded-validation-frame", "A blocker must preserve the iframe dialog URL separately.")
  assert(blockedProgress.blockedDialogs?.at(-1)?.dialogFrameId === "fixture-frame-101", "A blocker must preserve the iframe dialog frameId separately.")

  const prepareDuringHandoff = await executeCua({
    action: "prepare_ego_task",
    applicationUrl: url,
    taskSpaceId: "101",
    taskSpaceName: "Fixture task space",
  })
  assert(String(prepareDuringHandoff).includes("BROWSER_HANDOFF_PENDING"), "prepare_ego_task must not reopen or claim a handed-off task space.")

  const resumedHandoff = await executeCua({
    action: "resume_ego",
    taskSpaceId: "101",
    consultantConfirmed: true,
  })
  assert(String(resumedHandoff).includes('takeOverTaskSpace("101")'), "A consultant-confirmed handoff must resume only through the saved numeric task space.")
  assert(!String(resumedHandoff).includes("const task = await useOrCreateTaskSpace"), "A consultant-confirmed handoff must not silently recreate or claim a task space.")
  assert(String(resumedHandoff).includes("第一步只调用 pageInfo()"), "The first recovered browser round must be observation-only.")
  const authorizedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(authorizedProgress.egoBrowser?.handoffPending === true && authorizedProgress.egoBrowser?.takeoverPending === true, "Consultant authorization alone must not claim that browser takeover succeeded.")
  assert(!authorizedProgress.egoBrowser?.resumedAt, "A resume timestamp must not be written before takeOverTaskSpace and its first observation succeed.")

  const resumedObservation = await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "First pageInfo observation after the explicitly authorized takeOverTaskSpace call.",
  })
  assert(String(resumedObservation).includes("页面观察已记录"), "The first post-takeover observation must complete the two-phase resume.")
  const resumedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(resumedProgress.egoBrowser?.handoffPending === false && resumedProgress.egoBrowser?.takeoverPending === false, "Only a successful post-takeover observation may clear the handoff gate.")
  assert(typeof resumedProgress.egoBrowser?.resumedAt === "string", "Completed takeover must record its real resumedAt timestamp.")

  const missingTaskSpaceEvidence = "listTaskSpaces returned IDs 202 and 404; saved numeric ID 101 is absent."
  const missingTaskSpaceDetection = await executeCua({
    action: "retire_and_rebind_ego_task",
    taskSpaceId: "101",
    missingTaskSpaceConfirmed: true,
    evidence: missingTaskSpaceEvidence,
  })
  assert(String(missingTaskSpaceDetection).includes("TASK_SPACE_RETIRE_CONFIRMATION_REQUIRED"), "A disappeared numeric task space must first require an explicit consultant choice.")
  const detectedMissingProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(detectedMissingProgress.egoBrowser?.taskSpaceId === "101", "Detecting a missing task space must not silently replace or retire its saved ID.")
  const prepareDuringRebind = await executeCua({
    action: "prepare_ego_task",
    applicationUrl: url,
    taskSpaceName: "Fixture task space",
  })
  assert(String(prepareDuringRebind).includes("BROWSER_TASK_SPACE_REBIND_PENDING"), "Normal preparation must remain blocked while retire-and-rebind awaits the consultant.")
  const selectedExistingRebind = await executeCua({
    action: "retire_and_rebind_ego_task",
    taskSpaceId: "101",
    replacementTaskSpaceId: "404",
    rebindMode: "existing",
    missingTaskSpaceConfirmed: true,
    consultantConfirmed: true,
    taskSpaceObservedName: "Consultant-selected fixture space",
    taskSpaceOwnership: "agent",
    evidence: missingTaskSpaceEvidence,
  })
  assert(String(selectedExistingRebind).includes('const taskSpaceId = "404"') && String(selectedExistingRebind).includes("useOrCreateTaskSpace(taskSpaceId)"), "A consultant-selected agent-owned replacement must be bound explicitly and observed before work resumes.")
  const reboundBeforeObservation = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(reboundBeforeObservation.egoBrowser?.taskSpaceId === "404" && reboundBeforeObservation.egoBrowser?.rebindObservationPending === true, "Binding a replacement must preserve a first-observation gate.")
  assert(reboundBeforeObservation.retiredTaskSpaces?.at(-1)?.taskSpaceId === "101", "The disappeared ID must be retained in a durable retirement audit.")
  await executeCua({
    action: "record_observation",
    taskSpaceId: "404",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "First page/frame observation after consultant-selected replacement binding.",
  })
  assert(readRecord(join(workspace, "03_state/application_progress.json")).egoBrowser?.rebindObservationPending === false, "Only the replacement's first matching observation may complete rebind.")

  const secondMissingEvidence = "listTaskSpaces no longer contains replacement ID 404; the consultant wants a fresh replacement."
  await executeCua({
    action: "retire_and_rebind_ego_task",
    taskSpaceId: "404",
    missingTaskSpaceConfirmed: true,
    evidence: secondMissingEvidence,
  })
  const authorizeNewRebind = await executeCua({
    action: "retire_and_rebind_ego_task",
    taskSpaceId: "404",
    rebindMode: "new",
    missingTaskSpaceConfirmed: true,
    consultantConfirmed: true,
    evidence: secondMissingEvidence,
  })
  assert(String(authorizeNewRebind).includes("replacementTaskSpaceId") && String(authorizeNewRebind).includes("useOrCreateTaskSpace"), "A consultant-authorized new replacement must use a dedicated creation-only round.")
  const authorizedNewProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(authorizedNewProgress.egoBrowser?.taskSpaceId === "404", "Authorizing new-space creation must not replace the old ID until the exact created ID/name/ownership are returned.")
  const replacementTaskSpaceName = String(authorizedNewProgress.egoBrowser?.rebindPending?.replacementTaskSpaceName || "")
  const bindNewRebind = await executeCua({
    action: "retire_and_rebind_ego_task",
    taskSpaceId: "404",
    replacementTaskSpaceId: "505",
    rebindMode: "new",
    missingTaskSpaceConfirmed: true,
    consultantConfirmed: true,
    taskSpaceObservedName: replacementTaskSpaceName,
    taskSpaceOwnership: "agent",
    evidence: secondMissingEvidence,
  })
  assert(String(bindNewRebind).includes('const taskSpaceId = "505"'), "Only the exact newly created replacement returned by the authorized session may be bound.")
  await executeCua({
    action: "record_observation",
    taskSpaceId: "505",
    currentUrl: url,
    pageTitle: title,
    ...mainFrameContext,
    evidence: "First page/frame observation after binding the newly created replacement.",
  })
  const fullyReboundProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(fullyReboundProgress.egoBrowser?.taskSpaceId === "505" && fullyReboundProgress.egoBrowser?.rebindObservationPending === false, "The two-step new-space rebind must finish only after its first observation.")
  assert(fullyReboundProgress.retiredTaskSpaces?.length === 2, "Both disappeared numeric IDs must remain in the retirement audit.")

  await writeJson(join(workspace, "03_state/application_progress.json"), {
    currentPage: "申请平台准备中",
    currentUrl: url,
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
  })
  const freshTaskSpaceCreation = await executeCua({
    action: "prepare_ego_task",
    applicationUrl: url,
    taskSpaceName: "Fresh fixture task space",
  })
  assert(String(freshTaskSpaceCreation).includes("首轮只创建隔离 task space"), "A fresh application must create and persist the numeric task space before navigating.")
  assert(!String(freshTaskSpaceCreation).includes("openOrReuseTab"), "The initial task-space round must never open the school URL.")
  const freshDirectNavigation = await executeCua({
    action: "prepare_ego_task",
    applicationUrl: url,
    taskSpaceName: "Fresh fixture task space",
    taskSpaceId: "303",
  })
  assert(String(freshDirectNavigation).includes('useOrCreateTaskSpace(taskSpaceId)'), "The second fresh round must reuse the saved numeric task space.")
  assert(String(freshDirectNavigation).includes("const beforeNavigation = await pageInfo()"), "Initial school navigation must first check Ego pageInfo for an existing dialog.")
  assert(String(freshDirectNavigation).includes("gotoAndWait"), "Only the direct-Ego second round may navigate the selected blank tab to the school URL.")
  assert(String(freshDirectNavigation).includes("navigateInitialPageCapturingAlerts") && String(freshDirectNavigation).includes("Page.addScriptToEvaluateOnNewDocument") && String(freshDirectNavigation).includes("Runtime.addBinding"), "Initial school navigation must capture information-only load alerts on the same selected target through direct Ego CDP.")
  assert(!String(freshDirectNavigation).includes("openOrReuseTab"), "Initial school navigation must not create a second target whose load-time dialog would be invisible from the selected blank tab.")
  assert(String(freshDirectNavigation).includes("globalThis.alert=wrapped") && !String(freshDirectNavigation).includes("globalThis.confirm=") && !String(freshDirectNavigation).includes("globalThis.prompt="), "Initial navigation must auto-accept only alert while preserving advisor choice for confirm and prompt.")
  assert(String(freshDirectNavigation).includes("Page.handleJavaScriptDialog"), "Initial navigation must still handle a dialog that was already visible before navigation.")
  assert(String(freshDirectNavigation).includes("kind: 'dialog', dialog, capturedAlerts: navigation.capturedAlerts, cleanupError: navigation.cleanupError, infoError: navigation.infoError, handoff"), "Initial navigation must preserve the complete Ego dialog payload plus any already-captured load alerts and cleanup diagnostics.")
  assert(String(freshDirectNavigation).includes("kind: 'action', info, frameTree, snapshot, cleanupError: navigation.cleanupError, infoError: navigation.infoError"), "The successful action branch must still surface cleanup and observation diagnostics instead of dropping them.")
  assert(String(freshDirectNavigation).includes("kind: 'cleanup_failed', contaminated: true") && String(freshDirectNavigation).includes("TERRA_EGO_TASKSPACE_CONTAMINATED:"), "A failed injection cleanup must be reported as a contaminated hard stop with consultant-confirmed recovery, never as a successful round.")
  assert(String(freshDirectNavigation).includes("kind: 'alert_evidence_lost'") && String(freshDirectNavigation).includes("TERRA_EGO_ALERT_EVIDENCE_LOST:") && String(freshDirectNavigation).includes("topLevelAlerts: navigation.topLevelAlerts"), "Lost alert evidence must be reported as its own hard stop that preserves the top-level fallback for the consultant, distinct from contamination.")
  assert(String(freshDirectNavigation).includes("record_browser_safety_stop") && String(freshDirectNavigation).includes("safetyKind:cleanup_failed") && String(freshDirectNavigation).includes("safetyKind:alert_evidence_lost"), "Fresh navigation hard stops must instruct the structured safetyStop CUA action, not only free-text record_failure.")
  assert(String(freshDirectNavigation).includes("kind: 'alerts', alerts: navigation.alerts") && String(freshDirectNavigation).includes("如果输出 kind:alerts") && String(freshDirectNavigation).includes("record_blocker（blockerDisposition: resolved）"), "Initial navigation must return captured alert text and end the round with resolved audit guidance.")
  assert(String(freshDirectNavigation).includes("nextRound: 'pageInfo-only; do not retry navigation'"), "An indeterminate first navigation must end with an explicit pageInfo-only next round instead of a retry or refresh.")
  assert(String(freshDirectNavigation).includes("这是结果未决，不是失败") && String(freshDirectNavigation).includes("不得调用 record_failure、不得交接、不得重试导航或刷新") && String(freshDirectNavigation).includes("下一独立 heredoc 只复用同一 taskSpaceId 并调用 pageInfo"), "An indeterminate first navigation must explicitly defer failure or handoff until a separate pageInfo-only round proves the outcome.")
  assert(String(freshDirectNavigation).includes("timeout: 30, settle: 1"), "Generated initial navigation must keep its direct Ego navigation timeout bounded.")
  assert(readRecord(join(workspace, "03_state/application_progress.json")).egoBrowser?.taskSpaceId === "303", "The fresh task-space ID must be saved before navigation.")

  await writeJson(join(workspace, "03_state/application_progress.json"), {
    currentPage: "Legacy fixture application form",
    currentUrl: url,
    completedPages: [],
    savedPages: [],
    uploadedMaterials: [],
    failedActions: [],
    highRiskBlocks: [],
    browserBackend: "ego-browser",
    egoBrowser: {
      taskSpaceId: "Legacy fixture task space",
      taskSpaceName: "Legacy fixture task space",
      preparedAt: "2026-07-16T00:00:00.000Z",
      backend: "ego-browser",
      handoffPending: false,
    },
  })

  const legacyWithoutConfirmation = await executeCua({
    action: "prepare_ego_task",
    applicationUrl: url,
    taskSpaceName: "Legacy fixture task space",
  })
  assert(String(legacyWithoutConfirmation).includes("listTaskSpaces()"), "An old workspace with a missing or nonnumeric taskSpaceId must ask to list existing spaces.")
  assert(String(legacyWithoutConfirmation).includes("OpenCode question"), "An old workspace with a missing or nonnumeric taskSpaceId must require advisor confirmation instead of guessing.")

  const legacyConfirmed = await executeCua({
    action: "prepare_ego_task",
    applicationUrl: url,
    taskSpaceName: "Legacy fixture task space",
    taskSpaceId: "202",
    consultantConfirmed: true,
  })
  assert(String(legacyConfirmed).includes('await claimTaskSpace(taskSpaceId)') && String(legacyConfirmed).includes('const taskSpaceId = "202"'), "A consultant-selected user/inactive legacy task space must resume with claimTaskSpace and then observe.")
  assert(!String(legacyConfirmed).includes("useOrCreateTaskSpace"), "A consultant-selected legacy task space must not be silently claimed or recreated.")

  const serviceConflict = await executeCua({
    action: "record_failure",
    detail: "TERRA_EGO_BROWSER_VERSION_CONFLICT: fixture external Ego service is incompatible.",
  })
  assert(String(serviceConflict).includes("BROWSER_SERVICE_BLOCKED"), "An incompatible Ego service must become an explicit advisor-visible browser blocker.")
  assert(readRecord(join(workspace, "03_state/task_state.json")).status === "等待顾问接管浏览器", "An incompatible Ego service must not be misreported as a generic automation crash.")
}

const temporaryWorkspace = await mkdtemp(join(tmpdir(), "terra-edu-application-agent-e2e-"))
if (requestedWorkspace) assert(existsSync(requestedWorkspace), `APPLICATION_AGENT_WORKSPACE does not exist: ${requestedWorkspace}`)

try {
  await createFixture(temporaryWorkspace)
  verifyWorkspace(temporaryWorkspace, true)
  await verifyDirectNodeHelperContract(temporaryWorkspace)
  await verifyCuaStateTransitions(temporaryWorkspace)
  console.log("Application Agent E2E workspace verification passed.")
  console.log("Workspace: deterministic temporary fixture")
  if (requestedWorkspace) {
    verifyWorkspace(requestedWorkspace, false)
    console.log(`Additional diagnostic workspace: ${basename(requestedWorkspace)}`)
  }
} finally {
  await rm(temporaryWorkspace, { recursive: true, force: true })
}
