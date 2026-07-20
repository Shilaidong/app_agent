import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { authorizeBrowserSafetyContinue } from "./application-agent-browser-safety"
import { prepareApplicationRefillState } from "./application-agent-refill"
import { writeOpenCodeConfig } from "./application-agent-opencode"

type FixtureTask = {
  id: string
  workspacePath: string
  input: {
    studentName: string
    sourceFolder: string
    school: string
    program: string
    applicationType: string
    applicationUrl: string
  }
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("ego-browser nodejs capability blacklist", () => {
  test("rejects require/import of fs and child_process with exit 85", async () => {
    const fixture = await createSafetyFixture()
    await writeOpenCodeConfig(fixture.workspacePath)

    for (const script of [
      "const fs = require('fs')\nfs.writeFileSync('03_state/x.json', '{}')\n",
      'const cp = require("child_process")\n',
      "const fs = require(\"node:fs\")\n",
      "const mod = await import('fs')\n",
      'const mod = await import("child_process")\n',
      "process.binding('fs')\n",
      "const r = module.constructor._load\n",
      "const f = Function('return require')()('fs')\n",
      "const fs = require(`fs`)\n",
      "const mod = await import(`child_process`)\n",
    ]) {
      const result = await runWrapper(fixture.workspacePath, script)
      expect(result.status).toBe(85)
      expect(result.stderr).toContain("TERRA_EGO_NODE_CAPABILITY_DENIED")
    }
  })

  test("does not false-positive on required field form text", async () => {
    const fixture = await createSafetyFixture()
    const helper = join(fixture.workspacePath, "ego-browser-helper-stub")
    await writeFile(
      helper,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "taskspace" ] && [ "\${2:-}" = "list" ]; then
  printf '%s\\n' '[]'
  exit 0
fi
[ "\${1:-}" = "nodejs" ] || exit 64
printf '%s\\n' 'STUB_OK'
exit 0
`,
      "utf8",
    )
    await chmod(helper, 0o755)
    await writeOpenCodeConfig(fixture.workspacePath, {
      egoBrowserTestHelperPath: helper,
      egoBrowserReadinessAttempts: 2,
    })

    for (const script of [
      "const label = 'This is a required field'\ncliLog(label)\n",
      "const requiredFields = ['email', 'phone']\ncliLog(JSON.stringify(requiredFields))\n",
      "// requiredFields must not be empty; required field validation\nawait pageInfo()\n",
      "const msg = 'Please complete all required fields before save'\n",
      // R1: Function( + "required" must not match require[^[:alnum:]_]
      'const f = new Function("return 1"); const t = "all required fields"\n',
    ]) {
      const result = await runWrapper(fixture.workspacePath, script)
      expect(result.status).not.toBe(85)
      expect(result.stderr).not.toContain("TERRA_EGO_NODE_CAPABILITY_DENIED")
      expect(result.status).toBe(0)
    }
  })
})

describe("browser safety stop hard gates", () => {
  test("cleanup_failed is structured, blocks CUA and wrapper, and cannot be resolved or resumed", async () => {
    const fixture = await createSafetyFixture()
    const tools = await generatedTools(fixture.workspacePath)

    const recorded = JSON.parse(await tools.cua.execute(
      {
        input: {
          action: "record_browser_safety_stop",
          safetyKind: "cleanup_failed",
          taskSpaceId: "42",
          detail: "removeBinding failed",
          safetyEvidence: { cleanupError: "removeBinding failed", capturedAlerts: [] },
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    ))

    expect(recorded.marker).toBe("TERRA_EGO_TASKSPACE_CONTAMINATED")
    expect(recorded.safetyStop).toMatchObject({
      kind: "cleanup_failed",
      taskSpaceId: "42",
      active: true,
    })
    expect(String(recorded.safetyStop.decisionId || "")).toBeTruthy()

    const progress = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(progress.egoBrowser.safetyStop).toMatchObject({
      kind: "cleanup_failed",
      taskSpaceId: "42",
      active: true,
      decisionId: recorded.safetyStop.decisionId,
    })

    for (const action of [
      "begin_save_attempt",
      "record_save_verified",
      "complete_ego_task",
      "record_field_verified",
      "record_observation",
      "resume_ego",
      "prepare_ego_task",
    ]) {
      const blocked = await tools.cua.execute(
        { input: { action, taskSpaceId: "42", consultantConfirmed: true, confirmed: true } },
        { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
      )
      expect(blocked).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")
    }

    const resolveRejected = await tools.cua.execute(
      {
        input: {
          action: "resolve_browser_safety_stop",
          safetyKind: "cleanup_failed",
          taskSpaceId: "42",
          decisionId: recorded.safetyStop.decisionId,
          safetyResolution: "consultant_continue_same_space",
          consultantConfirmed: true,
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(resolveRejected).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")

    const rebindRejected = await tools.cua.execute(
      {
        input: {
          action: "retire_and_rebind_ego_task",
          taskSpaceId: "42",
          missingTaskSpaceConfirmed: true,
          consultantConfirmed: true,
          rebindMode: "existing",
          replacementTaskSpaceId: "42",
          evidence: "space still listed",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(rebindRejected).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")

    // record_failure must not clear safetyStop
    await tools.cua.execute(
      { input: { action: "record_failure", taskSpaceId: "42", detail: "unrelated failure" } },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).egoBrowser.safetyStop.active).toBe(true)

    // record_blocker resolved must not clear safetyStop
    const blocker = await tools.cua.execute(
      {
        input: {
          action: "record_blocker",
          taskSpaceId: "42",
          currentUrl: "https://example.edu/apply",
          pageTitle: "Apply",
          evidence: "alert text",
          blockerDisposition: "resolved",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(blocker).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).egoBrowser.safetyStop.active).toBe(true)

    // ordinary continue/resume task only clears paused and must not clear safetyStop
    await writeJson(join(fixture.workspacePath, "03_state/task_control.json"), {
      paused: false,
      reason: "顾问在任务工作台点击了继续任务。",
      updatedAt: new Date().toISOString(),
    })
    expect((await readJson(join(fixture.workspacePath, "03_state/task_control.json"))).paused).toBe(false)
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).egoBrowser.safetyStop.active).toBe(true)

    // new agent/session cannot bypass
    const otherSession = await tools.cua.execute(
      { input: { action: "begin_save_attempt", taskSpaceId: "42" } },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-b" },
    )
    expect(otherSession).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")

    const wrapper = await runWrapper(fixture.workspacePath, "console.log('hello')")
    expect(wrapper.status).toBe(82)
    expect(wrapper.status).not.toBe(127)
    expect(wrapper.stderr).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")
  })

  test("alert_evidence_lost requires desktop authorization and first observation before normal filling", async () => {
    const fixture = await createSafetyFixture()
    const tools = await generatedTools(fixture.workspacePath)

    const viaFailure = await tools.cua.execute(
      {
        input: {
          action: "record_failure",
          taskSpaceId: "77",
          detail: "TERRA_EGO_ALERT_EVIDENCE_LOST: drainEvents failed after cleanup",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(viaFailure).toContain("TERRA_EGO_ALERT_EVIDENCE_LOST")
    const progressAfterRecord = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(progressAfterRecord.egoBrowser.safetyStop).toMatchObject({
      kind: "alert_evidence_lost",
      taskSpaceId: "77",
      active: true,
    })
    const decisionId = progressAfterRecord.egoBrowser.safetyStop.decisionId

    const forged = await tools.cua.execute(
      {
        input: {
          action: "resolve_browser_safety_stop",
          taskSpaceId: "77",
          decisionId,
          safetyResolution: "consultant_continue_same_space",
          consultantConfirmed: true,
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(forged).toContain("BROWSER_SAFETY_DESKTOP_AUTHORIZATION_REQUIRED")
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).egoBrowser.safetyStop.active).toBe(true)

    const wrongDecision = await tools.cua.execute(
      {
        input: {
          action: "resolve_browser_safety_stop",
          taskSpaceId: "77",
          decisionId: "not-the-decision",
          safetyResolution: "consultant_continue_same_space",
          consultantConfirmed: true,
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(wrongDecision).toContain("BROWSER_SAFETY_DECISION_MISMATCH")

    const wrongSpace = await tools.cua.execute(
      {
        input: {
          action: "resolve_browser_safety_stop",
          taskSpaceId: "99",
          decisionId,
          safetyResolution: "consultant_continue_same_space",
          consultantConfirmed: true,
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(wrongSpace).toContain("BROWSER_TASK_SPACE_MISMATCH")

    const wrapperActive = await runWrapper(fixture.workspacePath, "console.log(await pageInfo())")
    expect(wrapperActive.status).toBe(83)
    expect(wrapperActive.stderr).toContain("TERRA_EGO_ALERT_EVIDENCE_LOST")

    await authorizeBrowserSafetyContinue(fixture.workspacePath, { decisionId, taskSpaceId: "77" })
    const authorized = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(authorized.egoBrowser.safetyStop).toMatchObject({
      kind: "alert_evidence_lost",
      taskSpaceId: "77",
      active: false,
      observationRequired: true,
      resolution: "consultant_continue_same_space",
      resumeAuthorizedBy: "consultant_desktop_continue",
    })

    const fillBlocked = await tools.cua.execute(
      {
        input: {
          action: "record_field_verified",
          taskSpaceId: "77",
          currentUrl: "https://example.edu/apply",
          pageTitle: "Apply",
          fieldLabel: "Name",
          evidence: "visible",
          interactionMethod: "fillInput+Tab+readback",
          readbackValue: "Ada",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(fillBlocked).toContain("BROWSER_SAFETY_OBSERVATION_REQUIRED")

    const saveBlocked = await tools.cua.execute(
      { input: { action: "begin_save_attempt", taskSpaceId: "77", currentUrl: "https://example.edu/apply", pageTitle: "Apply", evidence: "x" } },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(saveBlocked).toContain("BROWSER_SAFETY_OBSERVATION_REQUIRED")

    const completeBlocked = await tools.cua.execute(
      {
        input: {
          action: "complete_ego_task",
          taskSpaceId: "77",
          currentUrl: "https://example.edu/apply",
          pageTitle: "Apply",
          frameId: "f1",
          loaderId: "l1",
          frameUrl: "https://example.edu/apply",
          evidence: "done",
          confirmed: true,
          completionDisposition: "automation_complete",
          remainingRequiredFields: [],
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(completeBlocked).toContain("BROWSER_SAFETY_OBSERVATION_REQUIRED")

    const wrapperWrite = await runWrapper(fixture.workspacePath, "await fillInput('@name', 'Ada')")
    expect(wrapperWrite.status).toBe(84)
    expect(wrapperWrite.stderr).toContain("BROWSER_SAFETY_OBSERVATION_REQUIRED")

    const observed = await tools.cua.execute(
      {
        input: {
          action: "record_observation",
          taskSpaceId: "77",
          currentUrl: "https://example.edu/apply",
          pageTitle: "Apply",
          frameId: "frame-1",
          loaderId: "loader-1",
          frameUrl: "https://example.edu/apply",
          evidence: "fresh observation after consultant continue",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    )
    expect(observed).toContain("页面观察已记录")
    const afterObservation = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(afterObservation.egoBrowser.safetyStop.observationRequired).toBe(false)
    expect(afterObservation.egoBrowser.safetyStop.active).toBe(false)
    expect(afterObservation.egoBrowser.safetyStop.observationClearedAt).toBeTruthy()
  })

  test("refill archives contaminated progress and binds a fresh task space without active stop", async () => {
    const fixture = await createSafetyFixture({ withRefillArtifacts: true })
    const tools = await generatedTools(fixture.workspacePath)
    const recorded = JSON.parse(await tools.cua.execute(
      {
        input: {
          action: "record_browser_safety_stop",
          safetyKind: "cleanup_failed",
          taskSpaceId: "42",
          detail: "cleanup failed",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "session-a" },
    ))
    expect(recorded.safetyStop.taskSpaceId).toBe("42")
    const before = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(before.egoBrowser.safetyStop.active).toBe(true)

    const refill = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "refill-safety-1",
      sourceSessionID: "session-a",
    })
    expect(refill.created).toBe(true)
    const archived = await readJson(join(fixture.workspacePath, refill.attempt.progressArchivePath))
    expect(archived.egoBrowser.safetyStop).toMatchObject({
      kind: "cleanup_failed",
      taskSpaceId: "42",
      active: true,
    })
    const fresh = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(fresh.egoBrowser.safetyStop).toBeUndefined()
    expect(fresh.egoBrowser.taskSpaceId).toBeUndefined()
    expect(fresh.egoBrowser.awaitingFreshTaskSpaceId).toBe(true)
    expect(fresh.egoBrowser.taskSpaceName).toBe(refill.attempt.taskSpaceName)
    expect(fresh.egoBrowser.taskSpaceName).not.toBe(before.egoBrowser.taskSpaceName)
  })

  test("safety stop is school-local and writeOpenCodeConfig does not clear it", async () => {
    const root = await temporaryDirectory()
    const schoolA = join(root, "school-a")
    const schoolB = join(root, "school-b")
    await seedWorkspace(schoolA, { taskSpaceId: "11" })
    await seedWorkspace(schoolB, { taskSpaceId: "22" })
    const toolsA = await generatedTools(schoolA)
    await toolsA.cua.execute(
      {
        input: {
          action: "record_browser_safety_stop",
          safetyKind: "cleanup_failed",
          taskSpaceId: "11",
          detail: "contaminated a",
        },
      },
      { directory: schoolA, agent: "application-agent", sessionID: "a" },
    )
    expect((await readJson(join(schoolA, "03_state/application_progress.json"))).egoBrowser.safetyStop.active).toBe(true)
    expect((await readJson(join(schoolB, "03_state/application_progress.json"))).egoBrowser?.safetyStop).toBeUndefined()

    await writeOpenCodeConfig(schoolA)
    expect((await readJson(join(schoolA, "03_state/application_progress.json"))).egoBrowser.safetyStop.active).toBe(true)

    const toolsB = await generatedTools(schoolB)
    const ok = await toolsB.cua.execute(
      {
        input: {
          action: "record_observation",
          taskSpaceId: "22",
          currentUrl: "https://example.edu/b",
          pageTitle: "B",
          frameId: "f",
          loaderId: "l",
          frameUrl: "https://example.edu/b",
          evidence: "school b observation",
        },
      },
      { directory: schoolB, agent: "application-agent", sessionID: "b" },
    )
    expect(ok).toContain("页面观察已记录")
  })

  test("old workspaces without safetyStop remain compatible and protocol markers stay consistent", async () => {
    const fixture = await createSafetyFixture()
    const tools = await generatedTools(fixture.workspacePath)
    const progress = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(progress.egoBrowser.safetyStop).toBeUndefined()
    const observed = await tools.cua.execute(
      {
        input: {
          action: "record_observation",
          taskSpaceId: "42",
          currentUrl: "https://example.edu/apply",
          pageTitle: "Apply",
          frameId: "f1",
          loaderId: "l1",
          frameUrl: "https://example.edu/apply",
          evidence: "legacy workspace observation",
        },
      },
      { directory: fixture.workspacePath, agent: "application-agent", sessionID: "legacy" },
    )
    expect(observed).toContain("页面观察已记录")

    const wrapperSource = await Bun.file(join(fixture.workspacePath, ".opencode/bin/ego-browser")).text()
    expect(wrapperSource).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")
    expect(wrapperSource).toContain("TERRA_EGO_ALERT_EVIDENCE_LOST")
    expect(wrapperSource).toContain("exit 82")
    expect(wrapperSource).toContain("exit 83")
    expect(wrapperSource).toContain("exit 84")

    const policy = await Bun.file(join(fixture.workspacePath, ".opencode/skills/ego-browser/TERRA_POLICY.md")).text()
    expect(policy).toContain("record_browser_safety_stop")
    expect(policy).toContain("TERRA_EGO_TASKSPACE_CONTAMINATED")
    expect(policy).toContain("TERRA_EGO_ALERT_EVIDENCE_LOST")

    const toolsFile = await Bun.file(join(fixture.workspacePath, ".opencode/tools/application-agent.ts")).text()
    expect(toolsFile).toContain("record_browser_safety_stop")
    expect(toolsFile).toContain("resolve_browser_safety_stop")
    expect(toolsFile).toContain("egoBrowser.safetyStop")
    expect(toolsFile).not.toContain("browser_safety_stop.json")
  })
})

async function createSafetyFixture(options?: { withRefillArtifacts?: boolean }) {
  const workspacePath = await temporaryDirectory()
  await seedWorkspace(workspacePath, { taskSpaceId: "42", withRefillArtifacts: options?.withRefillArtifacts })
  const task = await readJson(join(workspacePath, "03_state/task_state.json")) as FixtureTask
  return { workspacePath, task }
}

async function seedWorkspace(workspacePath: string, options?: { taskSpaceId?: string; withRefillArtifacts?: boolean }) {
  await Promise.all([
    mkdir(join(workspacePath, "00_original_backup"), { recursive: true }),
    mkdir(join(workspacePath, "01_classified_materials/academic"), { recursive: true }),
    mkdir(join(workspacePath, "02_generated"), { recursive: true }),
    mkdir(join(workspacePath, "03_state"), { recursive: true }),
    mkdir(join(workspacePath, "04_logs"), { recursive: true }),
    mkdir(join(workspacePath, "05_screenshots"), { recursive: true }),
  ])
  const input = {
    studentName: "Safety Student",
    sourceFolder: join(workspacePath, "00_original_backup"),
    school: "Example U",
    program: "MSc",
    applicationType: "硕士",
    applicationUrl: "https://example.edu/apply",
  }
  const taskSpaceId = options?.taskSpaceId || "42"
  await Promise.all([
    writeJson(join(workspacePath, "03_state/task_input.json"), input),
    writeJson(join(workspacePath, "03_state/task_state.json"), {
      id: "task-" + taskSpaceId,
      slug: "safety-" + taskSpaceId,
      workspacePath,
      sessionDirectory: workspacePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "正在填写申请平台",
      input,
      counts: { totalFiles: 1, missingInformation: 0, missingMaterials: 0, uncertainItems: 0 },
      generatedFiles: [],
      progress: [],
    }),
    writeJson(join(workspacePath, "03_state/task_control.json"), { paused: false }),
    writeJson(join(workspacePath, "03_state/application_progress.json"), {
      currentPage: "Apply",
      currentUrl: "https://example.edu/apply",
      completedPages: [],
      savedPages: [],
      uploadedMaterials: [],
      failedActions: [],
      highRiskBlocks: [],
      browserBackend: "ego-browser",
      egoBrowser: {
        taskSpaceId,
        taskSpaceName: "Terra-Edu / Safety Student / Example U / MSc",
        preparedAt: new Date().toISOString(),
        backend: "ego-browser",
      },
    }),
    writeJson(join(workspacePath, "03_state/application_requirements.json"), { sources: [], fieldRequirements: [], materialRequirements: [], uncertainRequirements: [], notes: "" }),
    writeJson(join(workspacePath, "03_state/missing_items.json"), []),
    writeJson(join(workspacePath, "03_state/agent_execution_audit.json"), []),
    writeJson(join(workspacePath, "03_state/material_review.json"), {
      reviewId: "desktop-safety-review",
      status: "approved",
      mode: "skip",
      submittedAt: new Date().toISOString(),
      preparationCompleteAt: new Date().toISOString(),
    }),
    writeJson(join(workspacePath, "03_state/.desktop_material_review_trust.json"), {
      reviewId: "desktop-safety-review",
      approvedBy: "desktop_submitApplicationMaterialReview",
      submittedAt: new Date().toISOString(),
      workspacePath,
      writtenAt: new Date().toISOString(),
    }),
    Bun.write(join(workspacePath, "04_logs/agent_log.md"), "# Agent 日志\n\n"),
    Bun.write(join(workspacePath, "04_logs/cua_log.md"), "# CUA 日志\n\n"),
    Bun.write(join(workspacePath, "02_generated/student_profile.md"), "# Safety Student profile\n\nVerified.\n"),
  ])
  if (options?.withRefillArtifacts) {
    await Promise.all([
      Bun.write(join(workspacePath, "00_original_backup/passport.pdf"), "passport"),
      Bun.write(join(workspacePath, "01_classified_materials/academic/transcript.pdf"), "transcript"),
      writeJson(join(workspacePath, "03_state/materials_index.json"), [
        {
          fileName: "transcript.pdf",
          classifiedPath: join(workspacePath, "01_classified_materials/academic/transcript.pdf"),
          category: "academic",
        },
      ]),
    ])
  }
}

async function generatedTools(workspacePath: string) {
  await writeOpenCodeConfig(workspacePath)
  // Install a fake helper so wrapper integrity checks fail only after safety gates when needed.
  // Safety gates run before helper validation for active stop.
  return import(`${join(workspacePath, ".opencode/tools/application-agent.ts")}?test=${randomUUID()}`) as Promise<{
    cua: {
      execute(
        args: { input?: Record<string, unknown> },
        context: { directory: string; agent: string; sessionID?: string },
      ): Promise<string>
    }
  }>
}

async function runWrapper(workspacePath: string, script: string) {
  const wrapper = join(workspacePath, ".opencode/bin/ego-browser")
  // Provide a dummy executable path env used by tests if present; safety gate should fire first.
  const result = spawnSync(wrapper, ["nodejs"], {
    cwd: workspacePath,
    input: script + "\n",
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(workspacePath, ".opencode/bin")}:${process.env.PATH || ""}`,
    },
  })
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  }
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "terra-browser-safety-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {})
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function readJson(path: string) {
  return Bun.file(path).json()
}
