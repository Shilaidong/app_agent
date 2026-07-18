import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ApplicationTask } from "./application-agent"
import {
  type ApplicationRefillAttempt,
  applicationRefillSessionTitle,
  completeApplicationRefillState,
  inspectApplicationRefillState,
  markApplicationRefillPromptSentState,
  prepareApplicationRefillState,
  validateApplicationRefillArtifacts,
} from "./application-agent-refill"
import { buildApplicationAgentRefillPrompt, writeOpenCodeConfig } from "./application-agent-opencode"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("application refill state", () => {
  test("validates reusable artifacts and refuses to mutate an unapproved workspace", async () => {
    const fixture = await createFixture()

    expect(await validateApplicationRefillArtifacts(fixture.workspacePath, fixture.task)).toEqual(fixture.originalProgress)
    await writeJson(join(fixture.workspacePath, "03_state/material_review.json"), { status: "pending" })

    await expect(
      prepareApplicationRefillState({
        workspacePath: fixture.workspacePath,
        task: fixture.task,
        requestID: "request-not-approved",
      }),
    ).rejects.toThrow("材料尚未由顾问确认")
    expect(await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).toEqual(fixture.originalProgress)
    expect(await Bun.file(join(fixture.workspacePath, "03_state/filling_attempts.json")).exists()).toBe(false)
  })

  test("archives old progress once and keeps a repeated request idempotent", async () => {
    const fixture = await createFixture()
    const first = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-one",
      sourceSessionID: "old-session",
    })

    expect(first.created).toBe(true)
    expect(first.attempt.ordinal).toBe(1)
    expect(first.attempt.sourceSessionID).toBe("old-session")
    expect(await readJson(join(fixture.workspacePath, first.attempt.progressArchivePath))).toEqual(fixture.originalProgress)
    expect(await Bun.file(join(fixture.workspacePath, "00_original_backup/passport.pdf")).text()).toBe("original-passport")
    expect(await Bun.file(join(fixture.workspacePath, "01_classified_materials/academic/transcript.pdf")).text()).toBe("classified-transcript")
    expect(await Bun.file(join(fixture.workspacePath, "02_generated/student_profile.md")).text()).toBe("# Student profile\n\nVerified profile.\n")

    const activeProgress = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    expect(activeProgress.refillAttempt).toMatchObject({
      id: first.attempt.id,
      ordinal: 1,
      requestID: "request-one",
      sourceSessionID: "old-session",
    })
    expect(activeProgress.egoBrowser).toMatchObject({
      taskSpaceName: first.attempt.taskSpaceName,
      refillAttemptId: first.attempt.id,
      freshTaskSpaceAuthorizedBy: "consultant_refill_click",
      awaitingFreshTaskSpaceId: true,
    })
    expect(activeProgress.egoBrowser?.taskSpaceId).toBeUndefined()
    expect(activeProgress.savedPages).toEqual([])

    await writeJson(join(fixture.workspacePath, "03_state/application_progress.json"), {
      ...activeProgress,
      retryProbe: "must-survive-idempotent-retry",
    })
    const repeated = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: " request-one ",
      sourceSessionID: "different-session-is-ignored-for-same-request",
    })

    expect(repeated).toEqual({ attempt: first.attempt, created: false })
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).retryProbe).toBe(
      "must-survive-idempotent-retry",
    )
    expect(await readJson(join(fixture.workspacePath, "03_state/filling_attempts.json"))).toEqual([first.attempt])
  })

  test("archives each attempt independently and a stale retry cannot replace the latest attempt", async () => {
    const fixture = await createFixture()
    const first = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-one",
    })
    const firstBound = (await completeApplicationRefillState(fixture.workspacePath, first.attempt.id, "session-one")).attempt
    expect(await inspectApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-two",
    })).toEqual(firstBound)
    const firstCompleted = (await markApplicationRefillPromptSentState(
      fixture.workspacePath,
      first.attempt.id,
      "session-one",
    )).attempt
    const firstExecutionProgress = {
      ...(await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))),
      currentPage: "Education",
      savedPages: ["Personal information"],
      egoBrowser: {
        taskSpaceName: first.attempt.taskSpaceName,
        taskSpaceId: "101",
        refillAttemptId: first.attempt.id,
      },
    }
    await writeJson(join(fixture.workspacePath, "03_state/application_progress.json"), firstExecutionProgress)

    const second = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-two",
    })

    expect(second.created).toBe(true)
    expect(second.attempt.ordinal).toBe(2)
    expect(second.attempt.id).not.toBe(first.attempt.id)
    expect(second.attempt.taskSpaceName).not.toBe(first.attempt.taskSpaceName)
    expect(await readJson(join(fixture.workspacePath, second.attempt.progressArchivePath))).toEqual(firstExecutionProgress)
    expect(await readJson(join(fixture.workspacePath, first.attempt.progressArchivePath))).toEqual(fixture.originalProgress)
    expect(await readJson(join(fixture.workspacePath, "03_state/filling_attempts.json"))).toEqual([
      firstCompleted,
      second.attempt,
    ])
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).refillAttempt?.id).toBe(
      second.attempt.id,
    )

    await expect(
      prepareApplicationRefillState({
        workspacePath: fixture.workspacePath,
        task: fixture.task,
        requestID: "request-one",
      }),
    ).rejects.toThrow("已被更新的填写会话取代")
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).refillAttempt?.id).toBe(
      second.attempt.id,
    )
  })

  test("recovers one unfinished attempt even when the renderer lost its original request id", async () => {
    const fixture = await createFixture()
    const first = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-before-restart",
      sourceSessionID: "old-session",
    })

    expect(await inspectApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "new-renderer-request",
    })).toEqual(first.attempt)
    expect(await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "new-renderer-request",
      sourceSessionID: "must-not-replace-persisted-source",
    })).toEqual({ attempt: first.attempt, created: false })
    expect(await readJson(join(fixture.workspacePath, "03_state/filling_attempts.json"))).toEqual([first.attempt])
  })

  test("waits for supplemental content to be applied before a clean filling session can start", async () => {
    const fixture = await createFixture()
    await writeJson(join(fixture.workspacePath, "03_state/material_review.json"), {
      status: "approved",
      mode: "note",
      note: "New verified detail",
      submittedAt: new Date(Date.now() + 60_000).toISOString(),
    })

    await expect(validateApplicationRefillArtifacts(fixture.workspacePath, fixture.task)).rejects.toThrow(
      "补充的文件或文字尚未同步",
    )
    await writeJson(join(fixture.workspacePath, "03_state/material_review.json"), {
      status: "approved",
      mode: "note",
      note: "New verified detail",
      submittedAt: new Date(Date.now() + 60_000).toISOString(),
      preparationCompleteAt: new Date().toISOString(),
    })
    expect(await validateApplicationRefillArtifacts(fixture.workspacePath, fixture.task)).toEqual(fixture.originalProgress)
  })

  test("does not require an OCR refresh when a supplemental folder has no scanned files", async () => {
    const fixture = await createFixture()
    const supplementalFolder = join(fixture.workspacePath, "06_new_materials/supplement-docx")
    await mkdir(supplementalFolder, { recursive: true })
    await Bun.write(join(supplementalFolder, "verified-note.docx"), "fixture document")
    await writeJson(join(fixture.workspacePath, "03_state/material_review.json"), {
      status: "approved",
      mode: "supplement_folder",
      supplementalFolder,
      submittedAt: "2000-01-01T00:00:00.000Z",
    })

    expect(await validateApplicationRefillArtifacts(fixture.workspacePath, fixture.task)).toEqual(fixture.originalProgress)
    await Bun.write(join(supplementalFolder, "scan.pdf"), "fixture scan")
    await expect(validateApplicationRefillArtifacts(fixture.workspacePath, fixture.task)).rejects.toThrow(
      "补充的文件或文字尚未同步",
    )
  })

  test("isolates refill state for schools that share one selection-list batch", async () => {
    const sharedMaterialsPath = await makeTemporaryDirectory("terra-refill-shared-")
    await Bun.write(join(sharedMaterialsPath, "shared.pdf"), "shared-student-material")
    const firstFixture = await createFixture({
      school: "University A",
      program: "Programme A",
      batchId: "batch-42",
      batchOrder: 1,
      sourceFolder: sharedMaterialsPath,
    })
    const secondFixture = await createFixture({
      school: "University B",
      program: "Programme B",
      batchId: "batch-42",
      batchOrder: 2,
      sourceFolder: sharedMaterialsPath,
    })

    const [first, second] = await Promise.all([
      prepareApplicationRefillState({
        workspacePath: firstFixture.workspacePath,
        task: firstFixture.task,
        requestID: "batch-school-one",
      }),
      prepareApplicationRefillState({
        workspacePath: secondFixture.workspacePath,
        task: secondFixture.task,
        requestID: "batch-school-two",
      }),
    ])

    expect(first.attempt).toMatchObject({ batchId: "batch-42", batchOrder: 1, workspacePath: firstFixture.workspacePath })
    expect(second.attempt).toMatchObject({ batchId: "batch-42", batchOrder: 2, workspacePath: secondFixture.workspacePath })
    expect(first.attempt.taskSpaceName).toContain("University A")
    expect(second.attempt.taskSpaceName).toContain("University B")
    expect(first.attempt.taskSpaceName).not.toBe(second.attempt.taskSpaceName)
    expect(await readJson(join(firstFixture.workspacePath, "03_state/filling_attempts.json"))).toEqual([first.attempt])
    expect(await readJson(join(secondFixture.workspacePath, "03_state/filling_attempts.json"))).toEqual([second.attempt])
    expect((await readJson(join(firstFixture.workspacePath, "03_state/application_progress.json"))).refillAttempt?.batchOrder).toBe(1)
    expect((await readJson(join(secondFixture.workspacePath, "03_state/application_progress.json"))).refillAttempt?.batchOrder).toBe(2)
    expect(await Bun.file(join(sharedMaterialsPath, "shared.pdf")).text()).toBe("shared-student-material")
  })

  test("binds one OpenCode session exactly once and never replaces it", async () => {
    const fixture = await createFixture()
    const prepared = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-complete",
    })

    const completed = await completeApplicationRefillState(fixture.workspacePath, prepared.attempt.id, "session-new")
    expect(completed.changed).toBe(true)
    expect(completed.attempt).toMatchObject({ status: "session_created", sessionID: "session-new" })
    expect((await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).refillAttempt?.sessionID).toBe(
      "session-new",
    )

    const repeated = await completeApplicationRefillState(fixture.workspacePath, prepared.attempt.id, " session-new ")
    expect(repeated.changed).toBe(false)
    expect(repeated.attempt).toEqual(completed.attempt)
    await expect(
      completeApplicationRefillState(fixture.workspacePath, prepared.attempt.id, "another-session"),
    ).rejects.toThrow("已绑定另一个 OpenCode 对话")
    expect((await readJson<ApplicationRefillAttempt[]>(join(fixture.workspacePath, "03_state/filling_attempts.json")))[0]).toEqual(
      completed.attempt,
    )

    const progress = await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))
    await writeJson(join(fixture.workspacePath, "03_state/application_progress.json"), {
      ...progress,
      recoveryProbe: "must-survive-session-binding-repair",
      refillAttempt: { ...progress.refillAttempt, sessionID: undefined },
    })
    expect(await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-complete",
    })).toEqual({ attempt: completed.attempt, created: false })
    expect(await readJson(join(fixture.workspacePath, "03_state/application_progress.json"))).toMatchObject({
      recoveryProbe: "must-survive-session-binding-repair",
      refillAttempt: { id: completed.attempt.id, sessionID: "session-new" },
    })
  })

  test("builds a fill-only prompt from the archived attempt without restarting preparation", async () => {
    const fixture = await createFixture({ batchId: "batch-prompt", batchOrder: 3 })
    fixture.task.input.sharedWorkspacePath = "/tmp/terra-student/shared"
    const prepared = await prepareApplicationRefillState({
      workspacePath: fixture.workspacePath,
      task: fixture.task,
      requestID: "request-prompt",
      sourceSessionID: "contaminated-old-session",
    })

    const prompt = buildApplicationAgentRefillPrompt(fixture.task, prepared.attempt)

    expect(applicationRefillSessionTitle(fixture.task, prepared.attempt)).toContain(`[refill:${prepared.attempt.id}]`)
    expect(prompt).toContain(prepared.attempt.progressArchivePath)
    expect(prompt).toContain(prepared.attempt.taskSpaceName)
    expect(prompt).toContain("prepare_ego_task")
    expect(prompt).toContain("不要读取旧聊天记录")
    expect(prompt).toContain("read 被权限规则拒绝时立即报告系统权限异常并停止")
    expect(prompt).toContain("严禁改用 bash、cat、sed、Python、子代理或 skill 绕过")
    expect(prompt).toContain("严禁调用 application-agent_workspace、application-agent_materials、application-agent_requirements 或 application-agent_documents")
    expect(prompt).toContain("严禁重新初始化工作区、复制材料、OCR、分类")
    expect(prompt).toContain("重新生成 student_profile.md")
    expect(prompt).toContain("最终提交、付款、不可逆推荐信邀请")
    expect(prompt).toContain("只处理当前学校，不要并发启动批次内其他学校")
    expect(prompt).toContain("学生共享资料库：/tmp/terra-student/shared")
    expect(prompt).toContain("它在本会话中严格只读")
    expect(prompt).not.toContain("请现在只执行“启动阶段”")
    expect(prompt).not.toContain("初始化目标申请工作区、同步状态")
  })

  test("writes a refill-agent config that can only mutate browser execution state through approved tools", async () => {
    const workspacePath = await makeTemporaryDirectory("terra-refill-config-")

    await writeOpenCodeConfig(workspacePath)

    const config = await readJson<OpenCodeConfig>(join(workspacePath, ".opencode/opencode.json"))
    const agent = config.agent["application-refill-agent"]
    expect(agent.prompt).toBe("{file:./prompts/application-refill-agent.md}")
    expect(agent.permission.webfetch).toBe("deny")
    expect(agent.permission.websearch).toBe("deny")
    expect(agent.permission.grep).toBe("deny")
    expect(agent.permission.read["*"]).toBe("deny")
    expect(agent.permission.read["02_generated/student_profile.md"]).toBe("allow")
    expect(agent.permission.read["03_state/application_progress.json"]).toBe("allow")
    expect(agent.permission.read["03_state/agent_execution_audit.json"]).toBe("allow")
    expect(agent.permission.read["03_state/filling_attempts/**"]).toBeUndefined()
    expect(agent.permission.bash["*"]).toBe("deny")
    expect(agent.permission.bash['PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs*']).toBe("allow")
    expect(agent.permission.bash["ego-browser nodejs*"]).toBe("allow")
    expect(agent.permission.bash["*>*"]).toBe("deny")
    expect(agent.permission.edit["00_original_backup/**"]).toBe("deny")
    expect(agent.permission.edit["*"]).toBe("deny")
    expect(agent.permission.task).toBe("deny")
    expect(agent.permission.edit["01_classified_materials/**"]).toBe("deny")
    expect(agent.permission.edit["02_generated/student_profile.md"]).toBe("deny")
    expect(agent.permission.edit["03_state/application_progress.json"]).toBe("deny")
    expect(agent.permission["application-agent_materials"]).toBe("deny")
    expect(agent.permission["application-agent_state"]).toBe("deny")
    expect(agent.permission["application-agent_requirements"]).toBe("deny")
    expect(await Bun.file(join(workspacePath, ".opencode/prompts/application-refill-agent.md")).exists()).toBe(true)
    const refillAgentMarkdown = await Bun.file(join(workspacePath, ".opencode/agents/application-refill-agent.md")).text()
    const applicationAgentMarkdown = await Bun.file(join(workspacePath, ".opencode/agents/application-agent.md")).text()
    expect(refillAgentMarkdown).toContain('read:\n    "*": deny')
    expect(refillAgentMarkdown).toContain("grep: deny")
    expect(refillAgentMarkdown).toContain('"02_generated/student_profile.md": allow')
    expect(refillAgentMarkdown).toContain('"03_state/agent_execution_audit.json": allow')
    expect(applicationAgentMarkdown).toContain('read:\n    "*": allow')
    expect(applicationAgentMarkdown).toContain("grep: allow")
    const tools = await Bun.file(join(workspacePath, ".opencode/tools/application-agent.ts")).text()
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(tools)).not.toThrow()
    expect(tools).toContain("REFILL_SESSION_MISMATCH")
    expect(tools).toContain("REFILL_TASK_SPACE_OBSERVED_NAME_MISMATCH")
    expect(tools).toContain("freshTaskSpaceCreationIssuedForSessionID")
  })

  test("allows exact read-only access to a student shared dossier from a nested school workspace", async () => {
    const root = await makeTemporaryDirectory("terra-shared-config-")
    const sharedWorkspacePath = join(root, "student", "shared")
    const workspacePath = join(root, "student", "schools", "01-hku")
    await Promise.all([
      mkdir(sharedWorkspacePath, { recursive: true }),
      mkdir(workspacePath, { recursive: true }),
    ])

    await writeOpenCodeConfig(workspacePath, { sharedWorkspacePath })

    const config = await readJson<OpenCodeConfig>(join(workspacePath, ".opencode/opencode.json"))
    const sharedReadPattern = "../../shared/**"
    const sharedExternalPattern = `${sharedWorkspacePath}/**`
    const refill = config.agent["application-refill-agent"].permission
    const primary = config.agent["application-agent"].permission
    expect(refill.read[sharedReadPattern]).toBe("allow")
    expect(refill.edit[sharedReadPattern]).toBe("deny")
    expect(refill.external_directory).toEqual({ "*": "deny", [sharedExternalPattern]: "allow" })
    expect(primary.edit[sharedReadPattern]).toBe("deny")
    expect(primary.external_directory).toEqual({ "*": "deny", [sharedExternalPattern]: "allow" })
    expect(primary.bash["*"]).toBe("deny")
    expect(primary.bash['PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs*']).toBe("allow")
    expect(primary.bash["*>*"]).toBe("deny")

    const refillAgentMarkdown = await Bun.file(join(workspacePath, ".opencode/agents/application-refill-agent.md")).text()
    expect(refillAgentMarkdown).toContain(`"${sharedReadPattern}": allow`)
    expect(refillAgentMarkdown).toContain(`"${sharedReadPattern}": deny`)
    expect(refillAgentMarkdown).toContain(`"${sharedExternalPattern}": allow`)
    const tools = await Bun.file(join(workspacePath, ".opencode/tools/application-agent.ts")).text()
    expect(tools).toContain("STUDENT_DOSSIER_NOT_READY")
    expect(tools).toContain("reusedSharedDossier")
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(tools)).not.toThrow()
  })
})

async function createFixture(overrides: {
  school?: string
  program?: string
  batchId?: string
  batchOrder?: number
  sourceFolder?: string
} = {}) {
  const workspacePath = await makeTemporaryDirectory("terra-refill-workspace-")
  await Promise.all([
    mkdir(join(workspacePath, "00_original_backup"), { recursive: true }),
    mkdir(join(workspacePath, "01_classified_materials/academic"), { recursive: true }),
    mkdir(join(workspacePath, "02_generated"), { recursive: true }),
    mkdir(join(workspacePath, "03_state"), { recursive: true }),
  ])
  const task: ApplicationTask = {
    id: `task-${overrides.batchOrder || 1}`,
    slug: "fixture-task",
    workspacePath,
    sessionDirectory: workspacePath,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    status: "正在填写申请平台",
    input: {
      studentName: "Test Student",
      sourceFolder: overrides.sourceFolder || workspacePath,
      school: overrides.school || "Test University",
      program: overrides.program || "Test Programme",
      applicationType: "Master",
      applicationUrl: "https://apply.example.edu/form",
      batchId: overrides.batchId,
      batchOrder: overrides.batchOrder,
    },
    counts: {
      totalFiles: 2,
      missingInformation: 0,
      missingMaterials: 0,
      uncertainItems: 0,
    },
    generatedFiles: [],
    progress: [],
  }
  const originalProgress = {
    currentPage: "Personal information",
    currentUrl: "https://apply.example.edu/form/personal",
    completedPages: ["Account"],
    savedPages: ["Account"],
    uploadedMaterials: [],
    failedActions: [{ at: "2026-07-18T00:01:00.000Z", action: "save", reason: "fixture failure" }],
    highRiskBlocks: [],
    browserBackend: "ego-browser",
    egoBrowser: { taskSpaceId: "77", taskSpaceName: "old contaminated space" },
  }
  await Promise.all([
    Bun.write(join(workspacePath, "00_original_backup/passport.pdf"), "original-passport"),
    Bun.write(join(workspacePath, "01_classified_materials/academic/transcript.pdf"), "classified-transcript"),
    Bun.write(join(workspacePath, "02_generated/student_profile.md"), "# Student profile\n\nVerified profile.\n"),
    writeJson(join(workspacePath, "03_state/task_state.json"), task),
    writeJson(join(workspacePath, "03_state/materials_index.json"), [
      { fileName: "passport.pdf", backupPath: "00_original_backup/passport.pdf", category: "identity" },
      { fileName: "transcript.pdf", classifiedPath: "01_classified_materials/academic/transcript.pdf", category: "academic" },
    ]),
    writeJson(join(workspacePath, "03_state/application_requirements.json"), {
      sources: ["https://apply.example.edu/requirements"],
      fieldRequirements: [],
    }),
    writeJson(join(workspacePath, "03_state/missing_items.json"), []),
    writeJson(join(workspacePath, "03_state/application_progress.json"), originalProgress),
    writeJson(join(workspacePath, "03_state/material_review.json"), {
      status: "approved",
      mode: "skip",
      submittedAt: "2026-07-18T00:02:00.000Z",
    }),
  ])
  return { workspacePath, task, originalProgress }
}

async function makeTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJson(path: string, value: unknown) {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

type TestProgress = Record<string, unknown> & {
  retryProbe?: string
  savedPages?: unknown[]
  refillAttempt?: {
    id?: string
    batchOrder?: number
    sessionID?: string
  }
  egoBrowser?: {
    taskSpaceId?: string
  }
}

type OpenCodeConfig = {
  agent: Record<
    string,
    {
      prompt: string
      permission: {
        webfetch: string
        websearch: string
        grep: string
        read: Record<string, string>
        bash: Record<string, string>
        edit: Record<string, string>
        [key: string]: unknown
      }
    }
  >
}

async function readJson<T = TestProgress>(path: string): Promise<T> {
  return Bun.file(path).json()
}
