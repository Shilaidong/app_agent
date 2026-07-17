import { existsSync, readFileSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { writeOpenCodeConfig } from "../src/main/application-agent-opencode"

const requestedWorkspace = process.env.APPLICATION_AGENT_WORKSPACE?.trim()
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
    "03_state/task_state.json",
    "03_state/application_progress.json",
    "03_state/cua_control.json",
    "03_state/task_control.json",
    "03_state/agent_execution_audit.json",
  ]) {
    assertNonEmptyFile(join(workspace, file))
  }
  assert(!existsSync(join(workspace, ".opencode/node_modules")), "Config refresh must replace stale OpenCode dependency artifacts.")
  assert(!existsSync(join(workspace, ".opencode/bin/terra-dialog-guard")), "Config refresh must remove the retired native dialog sidecar from old workspaces.")
  assert(readText(join(workspace, ".opencode/legacy-config.txt")) === "must survive a config refresh\n", "Config refresh must preserve unrelated advisor workspace files.")

  const wrapper = join(workspace, ".opencode/bin/ego-browser")
  assert((statSync(wrapper).mode & 0o111) !== 0, "Workspace ego-browser wrapper must be executable.")
  const wrapperSyntax = spawnSync("/bin/sh", ["-n", wrapper], { encoding: "utf8" })
  assert(wrapperSyntax.status === 0, `Workspace ego-browser wrapper must be valid POSIX shell: ${wrapperSyntax.stderr || "unknown syntax error"}`)
  const wrapperSource = readText(wrapper)
  assert(wrapperSource.includes("--no-default-browser-check"), "Workspace wrapper must suppress the default-browser prompt.")
  assert(wrapperSource.includes("--no-first-run"), "Workspace wrapper must suppress the Chromium first-run prompt.")
  assert(wrapperSource.includes("EXPECTED_VERSION='0.4.4.15'"), "Workspace wrapper must pin ego lite 0.4.4.15.")
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
  assert(wrapperSource.includes("页面动作是否已经执行无法确认"), "A post-readiness Ego service failure must preserve an unknown page outcome instead of implying no action occurred.")
  assert(wrapperSource.includes("TERRA_EGO_BROWSER_VERSION_CONFLICT"), "Workspace wrapper must make an incompatible external Ego service explicit.")
  assert(wrapperSource.includes("TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE"), "Workspace wrapper must leave an external compatible Ego Lite service untouched.")
  assert(wrapperSource.includes("exit 76"), "Workspace wrapper must report browser-service failures with a non-127 exit code.")
  assert(!wrapperSource.includes("cua_control.json"), "Legacy cua_control.stopped must never gate the ego-browser wrapper.")
  assert(!wrapperSource.includes("TERRA_EGO_NATIVE_DIALOG") && !wrapperSource.includes("AXApplicationDialog"), "Workspace wrapper must not contain the retired Accessibility dialog sidecar.")

  for (const skill of skills) {
    const body = readText(join(workspace, ".opencode/skills", skill, "SKILL.md"))
    assert(body.includes("执行步骤"), `Skill lacks executable SOP steps: ${skill}`)
    assert(body.includes("执行原则"), `Skill lacks execution principles: ${skill}`)
  }
  for (const command of commands) assertNonEmptyFile(join(workspace, ".opencode/commands", `${command}.md`))

  const egoSkill = readText(join(workspace, ".opencode/skills/ego-browser/SKILL.md"))
  assert(egoSkill.includes('PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs'), "ego-browser skill must use the Terra-Edu wrapper.")
  assert(egoSkill.includes("handOffTaskSpace"), "ego-browser skill must document consultant handoff.")
  assert(egoSkill.includes("Never call `takeOverTaskSpace` on your own"), "ego-browser skill must forbid automatic task-space takeover.")
  assert(egoSkill.includes("pageInfoTimeoutMs = 1500") && egoSkill.includes("settleMs = 2000"), "ego-browser skill must bound each pageInfo call and observe a post-action quiet window.")
  assert(egoSkill.includes("For every `confirm` or `prompt`") && egoSkill.includes("Do not choose an option or provide prompt text"), "ego-browser skill must hand off every confirm and prompt without guessing.")
  assert(egoSkill.includes("dialogUrl") && egoSkill.includes("dialogFrameId"), "ego-browser skill must keep iframe dialog identity separate from the top-level current URL.")
  assert(!egoSkill.includes("await openOrReuseTab('https://example.com'"), "ego-browser quick start must not bypass observePageAction during initial navigation.")
  const cuaSkill = readText(join(workspace, ".opencode/skills/cua-application-filling/SKILL.md"))
  assert(cuaSkill.includes("绝不自动抢回控制"), "CUA skill must forbid automatic task-space takeover.")
  assert(cuaSkill.includes("Page.handleJavaScriptDialog"), "CUA skill must guide native dialog handling.")
  assert(cuaSkill.includes("observePageAction") && cuaSkill.includes("先启动动作但不 await"), "CUA skill must observe iframe dialogs while the triggering action is still pending.")

  const prompt = readText(join(workspace, ".opencode/prompts/application-agent.md"))
  assert(prompt.includes("snapshotText"), "Generated prompt must require observation before continuing browser work.")
  assert(prompt.includes("handOffTaskSpace"), "Generated prompt must require consultant handoff when needed.")
  assert(!prompt.includes("申请平台密码："), "Generated prompt must not collect an application-platform password.")

  const tools = readText(join(workspace, ".opencode/tools/application-agent.ts"))
  for (const action of ["prepare_ego_task", "record_observation", "record_field_verified", "record_select_verified", "record_dynamic_form_verified", "record_save_verified", "record_blocker", "handoff_to_consultant"]) {
    assert(tools.includes(action), `Workspace CUA coordination tool missing action: ${action}`)
  }
  assert(tools.includes("UNVERIFIED_SAVE_RECORDED"), "record_saved must not be treated as a verified save.")
  assert(tools.includes("browserBackend = \"ego-browser\""), "Workspace CUA tool must record the ego-browser backend.")
  assert(!tools.includes("export const native_dialog") && !tools.includes("TERRA_EGO_NATIVE_DIALOG"), "Workspace tools must omit the retired native-dialog fallback.")

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

type GeneratedCuaTool = {
  cua: {
    execute: (args: { input: Record<string, unknown> }, ctx: { directory: string }) => Promise<unknown>
  }
}

async function verifyCuaStateTransitions(workspace: string) {
  await writeJson(join(workspace, "03_state/task_control.json"), {
    paused: false,
    updatedAt: new Date().toISOString(),
    reason: "deterministic CUA transition verification",
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
    egoBrowser: { taskSpaceId: "101", taskSpaceName: "Fixture task space", backend: "ego-browser" },
  })

  const generatedTools = (await import(pathToFileURL(join(workspace, ".opencode/tools/application-agent.ts")).href)) as GeneratedCuaTool
  const executeCua = (input: Record<string, unknown>) => generatedTools.cua.execute({ input }, { directory: workspace })
  const url = "https://fixture.example/application"
  const title = "Fixture application form"

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
    evidence: "Initial pageInfo and snapshot show the fixture form.",
  })
  assert(String(firstObservation).includes("页面观察已记录"), "record_observation must accept an observed numeric task space.")

  const saveWithoutDynamicCheck = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The fixture form displays a saved banner.",
    confirmed: true,
  })
  assert(String(saveWithoutDynamicCheck).includes("UNVERIFIED_DYNAMIC_FORM"), "A save must be rejected until the latest dynamic form check passes.")

  const dynamicCheck = await executeCua({
    action: "record_dynamic_form_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Fresh rescan found no visible empty required fields.",
    remainingRequiredFields: [],
  })
  assert(String(dynamicCheck).includes("动态表单已复查通过"), "A matching fresh observation with no required fields must pass the dynamic form gate.")

  const saveWithoutPostSaveObservation = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The fixture form displays a saved banner.",
    confirmed: true,
  })
  assert(String(saveWithoutPostSaveObservation).includes("UNVERIFIED_POST_SAVE_OBSERVATION"), "A save must be rejected until there is a newer post-save observation.")

  await new Promise((resolve) => setTimeout(resolve, 5))
  const postSaveObservation = await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "Fresh pageInfo and snapshot show the fixture saved banner.",
  })
  assert(String(postSaveObservation).includes("页面观察已记录"), "The post-save observation must be accepted before recording a save.")

  const verifiedSave = await executeCua({
    action: "record_save_verified",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
    evidence: "The fixture form displays a saved banner after the action.",
    confirmed: true,
  })
  assert(String(verifiedSave).includes("页面已记录为 ego-browser 验证保存"), "A save must be recorded only after the dynamic check and post-save observation.")
  const verifiedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(Array.isArray(verifiedProgress.savedPages) && verifiedProgress.savedPages.length === 1, "Verified save must add exactly one saved page.")

  await new Promise((resolve) => setTimeout(resolve, 5))
  await executeCua({
    action: "record_observation",
    taskSpaceId: "101",
    currentUrl: url,
    pageTitle: title,
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
    evidence: "First pageInfo observation after the explicitly authorized takeOverTaskSpace call.",
  })
  assert(String(resumedObservation).includes("页面观察已记录"), "The first post-takeover observation must complete the two-phase resume.")
  const resumedProgress = readRecord(join(workspace, "03_state/application_progress.json"))
  assert(resumedProgress.egoBrowser?.handoffPending === false && resumedProgress.egoBrowser?.takeoverPending === false, "Only a successful post-takeover observation may clear the handoff gate.")
  assert(typeof resumedProgress.egoBrowser?.resumedAt === "string", "Completed takeover must record its real resumedAt timestamp.")

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
  assert(String(freshDirectNavigation).includes("openOrReuseTab"), "Only the direct-Ego second round may navigate to the school URL.")
  assert(String(freshDirectNavigation).includes("observePageAction(() => openOrReuseTab"), "Initial school navigation must use the bounded direct-Ego dialog observer.")
  assert(!String(freshDirectNavigation).includes("await openOrReuseTab"), "Initial school navigation must never wait on a potentially dialog-blocked action before observing it.")
  assert(String(freshDirectNavigation).includes("pageInfoTimeoutMs = 1500") && String(freshDirectNavigation).includes("settleMs = 2000"), "Generated initial navigation must keep pageInfo bounded and observe a post-action quiet window.")
  assert(String(freshDirectNavigation).includes("actionTimeoutMs: 30000"), "Initial school navigation must remain bounded while allowing a normal slow page load.")
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
  assert(String(legacyConfirmed).includes('takeOverTaskSpace("202")'), "A consultant-selected legacy task space must resume only with takeOverTaskSpace.")
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
