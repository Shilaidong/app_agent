import { afterEach, describe, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeOpenCodeConfig } from "./application-agent-opencode"
import { createStudentWorkspace } from "./application-student-workspace"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("shared student dossier tools", () => {
  test("publishes once and makes later school preparation read-only", async () => {
    const root = await temporaryDirectory()
    const layout = await createStudentWorkspace(join(root, "张三-申请批次"))
    const ownerWorkspace = join(layout.schoolsPath, "01-hku")
    const readerWorkspace = join(layout.schoolsPath, "02-cuhk")
    await Promise.all([
      schoolFixture(ownerWorkspace, layout.sharedWorkspacePath, "owner-task", 1),
      schoolFixture(readerWorkspace, layout.sharedWorkspacePath, "reader-task", 2),
      writeJson(layout.sharedDossierStatePath, {
        status: "preparing",
        version: 0,
        ownerTaskId: "owner-task",
      }),
      writeJson(join(layout.workspacePath, "03_state", "batch_state.json"), {
        id: "batch-one",
        workspaceLayoutVersion: 2,
        studentName: "张三",
        sharedWorkspacePath: layout.sharedWorkspacePath,
      }),
    ])

    const ownerTools = await generatedTools(ownerWorkspace, layout.sharedWorkspacePath)
    const ownerInitialization = JSON.parse(await ownerTools.workspace.execute(
      { input: { action: "initialize" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    ))
    expect(ownerInitialization).toMatchObject({ ownerPreparation: true, reusedSharedDossier: false })

    await Promise.all([
      Bun.write(join(ownerWorkspace, "02_generated/student_profile.md"), "# 张三 学生核心档案\n\n- 本科：测试大学\n"),
      writeJson(join(ownerWorkspace, "03_state/materials_index.json"), [
        {
          fileName: "transcript.pdf",
          classifiedPath: join(layout.sharedClassifiedPath, "academic", "transcript.pdf"),
          category: "academic",
        },
      ]),
      writeJson(join(ownerWorkspace, "03_state/missing_items.json"), []),
    ])
    await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    )
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({
      status: "prepared",
      ownerTaskId: "owner-task",
    })

    const reviewId = "desktop-review-owner"
    const submittedAt = new Date().toISOString()
    await writeJson(join(ownerWorkspace, "03_state/material_review.json"), {
      reviewId,
      status: "approved",
      mode: "skip",
      submittedAt,
      preparationCompleteAt: submittedAt,
    })
    await writeJson(join(ownerWorkspace, "03_state/.desktop_material_review_trust.json"), {
      reviewId,
      approvedBy: "desktop_submitApplicationMaterialReview",
      submittedAt,
      workspacePath: ownerWorkspace,
      writtenAt: submittedAt,
    })
    await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    )
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({
      status: "ready",
      ownerTaskId: "owner-task",
    })
    expect(await ownerTools.cua.execute(
      { input: { action: "prepare_ego_task" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    )).toContain("task=owner-task")

    await writeJson(join(ownerWorkspace, "03_state/material_review.json"), {
      status: "approved",
      approvedBy: "consultant",
      submittedAt: "2026-07-19T17:34:12.000Z",
    })
    await expect(
      ownerTools.cua.execute(
        { input: { action: "prepare_ego_task", taskSpaceId: "1" } },
        { directory: ownerWorkspace, agent: "application-agent" },
      ),
    ).rejects.toThrow(/MATERIAL_REVIEW_UNTRUSTED|材料确认/)

    const readerTools = await generatedTools(readerWorkspace, layout.sharedWorkspacePath)
    const readerInitialization = JSON.parse(await readerTools.workspace.execute(
      { input: { action: "initialize" } },
      { directory: readerWorkspace, agent: "application-agent" },
    ))
    expect(readerInitialization).toMatchObject({ reusedSharedDossier: true, ownerPreparation: false })
    expect(await Bun.file(join(readerWorkspace, "02_generated/student_profile.md")).text()).toContain("测试大学")
    expect(await readJson(join(readerWorkspace, "03_state/materials_index.json"))).toHaveLength(1)
    expect(await readerTools.materials.execute(
      { input: { action: "classify" } },
      { directory: readerWorkspace, agent: "application-agent" },
    )).toContain('"preparationLocked": true')
    expect(await Bun.file(join(readerWorkspace, "00_original_backup/transcript.pdf")).exists()).toBe(false)
    expect(await Bun.file(join(readerWorkspace, "01_classified_materials/academic/transcript.pdf")).exists()).toBe(false)

    const readerStatePath = join(readerWorkspace, "03_state", "task_state.json")
    const readerState = await readJson(readerStatePath)
    await writeJson(readerStatePath, {
      ...readerState,
      input: { ...readerState.input, sharedWorkspacePath: root },
    })
    await expect(readerTools.workspace.execute(
      { input: { action: "initialize" } },
      { directory: readerWorkspace, agent: "application-agent" },
    )).rejects.toThrow("STUDENT_DOSSIER_PATH_MISMATCH")
    await writeJson(readerStatePath, readerState)

    await Bun.write(join(layout.sharedMaterialsPath, "tampered-passport.pdf"), "tampered after publication")
    await expect(readerTools.workspace.execute(
      { input: { action: "initialize" } },
      { directory: readerWorkspace, agent: "application-agent" },
    )).rejects.toThrow("STUDENT_DOSSIER_HASH_MISMATCH")
  })

  test("keeps school-only supplements local and publishes explicitly shared supplements exactly once", async () => {
    const root = await temporaryDirectory()
    const layout = await createStudentWorkspace(join(root, "李四-申请批次"))
    const ownerWorkspace = join(layout.schoolsPath, "01-hku")
    const secondWorkspace = join(layout.schoolsPath, "02-cuhk")
    const thirdWorkspace = join(layout.schoolsPath, "03-nus")
    await Promise.all([
      schoolFixture(ownerWorkspace, layout.sharedWorkspacePath, "owner-two", 1),
      schoolFixture(secondWorkspace, layout.sharedWorkspacePath, "reader-two", 2),
      schoolFixture(thirdWorkspace, layout.sharedWorkspacePath, "reader-three", 3),
      writeJson(join(layout.workspacePath, "03_state", "batch_state.json"), {
        id: "batch-one",
        workspaceLayoutVersion: 2,
        studentName: "张三",
        sharedWorkspacePath: layout.sharedWorkspacePath,
      }),
      writeJson(layout.sharedDossierStatePath, { status: "preparing", version: 0, ownerTaskId: "owner-two" }),
    ])
    const ownerTools = await generatedTools(ownerWorkspace, layout.sharedWorkspacePath)
    await Promise.all([
      Bun.write(join(ownerWorkspace, "02_generated/student_profile.md"), "# 张三 学生核心档案\n"),
      writeJson(join(ownerWorkspace, "03_state/materials_index.json"), []),
      writeJson(join(ownerWorkspace, "03_state/missing_items.json"), []),
    ])
    await ownerTools.documents.execute({ input: { action: "generate_all" } }, { directory: ownerWorkspace, agent: "application-agent" })
    const prepared = await readJson(layout.sharedDossierStatePath)
    await writeJson(layout.sharedDossierStatePath, {
      ...prepared,
      status: "ready",
      publishedAt: new Date().toISOString(),
    })

    const secondTools = await generatedTools(secondWorkspace, layout.sharedWorkspacePath)
    await secondTools.workspace.execute({ input: { action: "initialize" } }, { directory: secondWorkspace, agent: "application-agent" })
    const localSupplement = join(secondWorkspace, "06_new_materials", "school-only")
    await mkdir(localSupplement, { recursive: true })
    const schoolFile = join(localSupplement, "hku-only-essay.docx")
    await Bun.write(schoolFile, "school-only material")
    const schoolHash = sha256("school-only material")
    await writeJson(join(secondWorkspace, "03_state/material_review.json"), {
      reviewId: "school-review",
      status: "approved",
      mode: "supplement_folder",
      scope: "school",
      supplementalFolder: localSupplement,
      sourceManifest: [{ path: schoolFile, sha256: schoolHash }],
      submittedAt: new Date().toISOString(),
    })
    await secondTools.materials.execute({ input: { action: "classify" } }, { directory: secondWorkspace, agent: "application-agent" })
    await secondTools.materials.execute({ input: { action: "classify" } }, { directory: secondWorkspace, agent: "application-agent" })
    expect(await readJson(join(secondWorkspace, "03_state/school_materials_overlay.json"))).toHaveLength(1)
    expect(await readJson(join(secondWorkspace, "03_state/materials_index.json"))).toHaveLength(1)
    expect(await readJson(layout.sharedMaterialsIndexPath)).toHaveLength(0)
    expect(await readJson(join(secondWorkspace, "03_state/material_review.json"))).toMatchObject({ appliedAt: expect.any(String) })
    await Bun.write(join(secondWorkspace, "02_generated/student_profile.md"), "# 本校保留的文字补充\n")
    await secondTools.workspace.execute({ input: { action: "initialize" } }, { directory: secondWorkspace, agent: "application-agent" })
    expect(await Bun.file(join(secondWorkspace, "02_generated/student_profile.md")).text()).toContain("本校保留")

    const sharedSupplement = join(layout.sharedMaterialsPath, "supplement-from-cuhk")
    await mkdir(sharedSupplement, { recursive: true })
    const sharedFile = join(sharedSupplement, "new-transcript.docx")
    await Bun.write(sharedFile, "student-wide material")
    const sharedHash = sha256("student-wide material")
    const sharedProfileCandidatePath = join(secondWorkspace, "02_generated", "shared_profile_candidate.md")
    await Bun.write(sharedProfileCandidatePath, await Bun.file(layout.sharedProfilePath).text())
    const ready = await readJson(layout.sharedDossierStatePath)
    await writeJson(layout.sharedDossierStatePath, {
      ...ready,
      status: "preparing",
      ownerTaskId: "reader-two",
      publishedAt: "",
    })
    const studentReviewSubmittedAt = new Date().toISOString()
    await writeJson(join(secondWorkspace, "03_state/material_review.json"), {
      reviewId: "student-review",
      status: "approved",
      mode: "supplement_folder",
      scope: "student",
      supplementalFolder: sharedSupplement,
      sourceManifest: [{ path: sharedFile, sha256: sharedHash }],
      sharedProfileCandidatePath,
      submittedAt: studentReviewSubmittedAt,
    })
    await writeJson(join(secondWorkspace, "03_state/.desktop_material_review_trust.json"), {
      reviewId: "student-review",
      approvedBy: "desktop_submitApplicationMaterialReview",
      submittedAt: studentReviewSubmittedAt,
      workspacePath: secondWorkspace,
      writtenAt: studentReviewSubmittedAt,
    })
    await secondTools.materials.execute({ input: { action: "classify" } }, { directory: secondWorkspace, agent: "application-agent" })
    await secondTools.materials.execute({ input: { action: "classify" } }, { directory: secondWorkspace, agent: "application-agent" })
    await secondTools.documents.execute({ input: { action: "generate_all" } }, { directory: secondWorkspace, agent: "application-agent" })
    expect(await readJson(layout.sharedMaterialsIndexPath)).toHaveLength(1)
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({ status: "ready", ownerTaskId: "reader-two" })
    expect(await Bun.file(layout.sharedProfilePath).text()).not.toContain("本校保留")

    const thirdTools = await generatedTools(thirdWorkspace, layout.sharedWorkspacePath)
    expect(JSON.parse(await thirdTools.workspace.execute(
      { input: { action: "initialize" } },
      { directory: thirdWorkspace, agent: "application-agent" },
    ))).toMatchObject({ reusedSharedDossier: true })
    expect(await readJson(join(thirdWorkspace, "03_state/materials_index.json"))).toHaveLength(1)

    const noteCandidate = join(thirdWorkspace, "02_generated", "shared_profile_candidate.md")
    const noteCandidateText = await Bun.file(layout.sharedProfilePath).text()
    await Bun.write(noteCandidate, noteCandidateText)
    const latestReady = await readJson(layout.sharedDossierStatePath)
    await writeJson(layout.sharedDossierStatePath, {
      ...latestReady,
      status: "preparing",
      ownerTaskId: "reader-three",
      publishedAt: "",
    })
    const noteSubmittedAt = new Date().toISOString()
    await writeJson(join(thirdWorkspace, "03_state/material_review.json"), {
      reviewId: "student-note",
      status: "approved",
      mode: "note",
      scope: "student",
      note: "新增通用事实",
      sharedProfileCandidatePath: noteCandidate,
      sharedProfileSha256Before: sha256(noteCandidateText),
      profileSha256Before: sha256(await Bun.file(join(thirdWorkspace, "02_generated", "student_profile.md")).text()),
      submittedAt: noteSubmittedAt,
    })
    await writeJson(join(thirdWorkspace, "03_state/.desktop_material_review_trust.json"), {
      reviewId: "student-note",
      approvedBy: "desktop_submitApplicationMaterialReview",
      submittedAt: noteSubmittedAt,
      workspacePath: thirdWorkspace,
      writtenAt: noteSubmittedAt,
    })
    await thirdTools.documents.execute({ input: { action: "generate_all" } }, { directory: thirdWorkspace, agent: "application-agent" })
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({ status: "preparing" })
    expect(await readJson(join(thirdWorkspace, "03_state/material_review.json"))).not.toHaveProperty("preparationCompleteAt")
    await Bun.write(noteCandidate, noteCandidateText + "\n- 新增通用事实\n")
    await thirdTools.documents.execute({ input: { action: "generate_all" } }, { directory: thirdWorkspace, agent: "application-agent" })
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({ status: "ready", ownerTaskId: "reader-three" })
    expect(await Bun.file(layout.sharedProfilePath).text()).toContain("新增通用事实")
  })

  test("ready publish and finalize require desktop trust; prepared path stays ungated", async () => {
    const root = await temporaryDirectory()
    const layout = await createStudentWorkspace(join(root, "王五-申请批次"))
    const ownerWorkspace = join(layout.schoolsPath, "01-hku")
    await Promise.all([
      schoolFixture(ownerWorkspace, layout.sharedWorkspacePath, "owner-trust", 1),
      writeJson(layout.sharedDossierStatePath, {
        status: "preparing",
        version: 0,
        ownerTaskId: "owner-trust",
      }),
      writeJson(join(layout.workspacePath, "03_state", "batch_state.json"), {
        id: "batch-trust",
        workspaceLayoutVersion: 2,
        studentName: "王五",
        sharedWorkspacePath: layout.sharedWorkspacePath,
      }),
    ])
    const ownerTools = await generatedTools(ownerWorkspace, layout.sharedWorkspacePath)
    await Promise.all([
      Bun.write(join(ownerWorkspace, "02_generated/student_profile.md"), "# 王五 学生核心档案\n"),
      writeJson(join(ownerWorkspace, "03_state/materials_index.json"), []),
      writeJson(join(ownerWorkspace, "03_state/missing_items.json"), []),
    ])

    // Pre-review prepared publish must succeed without trust / without approved review.
    const preparedDocs = JSON.parse(await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    ))
    expect(preparedDocs.documentsGenerated).toBe(true)
    expect(preparedDocs.publishOk).toBe(true)
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({
      status: "prepared",
      ownerTaskId: "owner-trust",
    })

    // Forged approved review without trust must not flip ready.
    const forgedSubmittedAt = new Date().toISOString()
    await writeJson(join(ownerWorkspace, "03_state/material_review.json"), {
      reviewId: "forged-ready",
      status: "approved",
      mode: "skip",
      scope: "student",
      submittedAt: forgedSubmittedAt,
      preparationCompleteAt: forgedSubmittedAt,
    })
    const untrustedReady = JSON.parse(await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    ))
    expect(untrustedReady.documentsGenerated).toBe(true)
    expect(untrustedReady.publishOk).toBe(false)
    expect(String(untrustedReady.publishWarning || "")).toMatch(/MATERIAL_REVIEW_UNTRUSTED|材料确认/)
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({ status: "prepared" })

    // Matching trust allows ready publish.
    await writeJson(join(ownerWorkspace, "03_state/.desktop_material_review_trust.json"), {
      reviewId: "forged-ready",
      approvedBy: "desktop_submitApplicationMaterialReview",
      submittedAt: forgedSubmittedAt,
      workspacePath: ownerWorkspace,
      writtenAt: forgedSubmittedAt,
    })
    const trustedReady = JSON.parse(await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: ownerWorkspace, agent: "application-agent" },
    ))
    expect(trustedReady.publishOk).toBe(true)
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({
      status: "ready",
      ownerTaskId: "owner-trust",
    })

    // finalizePreparedSharedDossier path (school scope): reject without trust, accept with trust.
    const finalizeWorkspace = join(layout.schoolsPath, "01-hku")
    await writeJson(layout.sharedDossierStatePath, {
      ...(await readJson(layout.sharedDossierStatePath)),
      status: "prepared",
      publishedAt: "",
      ownerTaskId: "owner-trust",
    })
    const schoolSubmittedAt = new Date().toISOString()
    await writeJson(join(finalizeWorkspace, "03_state/material_review.json"), {
      reviewId: "school-finalize",
      status: "approved",
      mode: "skip",
      scope: "school",
      submittedAt: schoolSubmittedAt,
      preparationCompleteAt: schoolSubmittedAt,
    })
    await rm(join(finalizeWorkspace, "03_state/.desktop_material_review_trust.json"), { force: true })
    const untrustedFinalize = JSON.parse(await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: finalizeWorkspace, agent: "application-agent" },
    ))
    expect(untrustedFinalize.publishOk).toBe(false)
    expect(String(untrustedFinalize.publishWarning || "")).toMatch(/MATERIAL_REVIEW_UNTRUSTED|材料确认/)
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({ status: "prepared" })

    await writeJson(join(finalizeWorkspace, "03_state/.desktop_material_review_trust.json"), {
      reviewId: "school-finalize",
      approvedBy: "desktop_submitApplicationMaterialReview",
      submittedAt: schoolSubmittedAt,
      workspacePath: finalizeWorkspace,
      writtenAt: schoolSubmittedAt,
    })
    const trustedFinalize = JSON.parse(await ownerTools.documents.execute(
      { input: { action: "generate_all" } },
      { directory: finalizeWorkspace, agent: "application-agent" },
    ))
    expect(trustedFinalize.publishOk).toBe(true)
    expect(await readJson(layout.sharedDossierStatePath)).toMatchObject({ status: "ready" })
  })

  test("owner school can write its local student_profile.md; shared path stays denied", async () => {
    const root = await temporaryDirectory()
    const layout = await createStudentWorkspace(join(root, "赵六-申请批次"))
    const ownerWorkspace = join(layout.schoolsPath, "01-cuhk")
    await schoolFixture(ownerWorkspace, layout.sharedWorkspacePath, "owner-profile", 1)
    await writeOpenCodeConfig(ownerWorkspace, { sharedWorkspacePath: layout.sharedWorkspacePath })
    const config = JSON.parse(await readFile(join(ownerWorkspace, ".opencode/opencode.json"), "utf8"))
    const edit = config.permission.edit
    // Shared absolute paths must stay denied so reader schools cannot forge the shared dossier.
    expect(edit[layout.sharedWorkspacePath.replaceAll("\\", "/") + "/02_generated/student_profile.md"]).toBe("deny")
    expect(edit[layout.sharedWorkspacePath.replaceAll("\\", "/") + "/03_state/materials_index.json"]).toBe("deny")
    // School-local copies must NOT be denied: the owner school generates student_profile.md locally.
    expect(edit["02_generated/student_profile.md"]).not.toBe("deny")
    expect(edit["**/02_generated/student_profile.md"]).not.toBe("deny")
    expect(edit["03_state/materials_index.json"]).not.toBe("deny")
  })
})

async function schoolFixture(
  workspacePath: string,
  sharedWorkspacePath: string,
  id: string,
  batchOrder: number,
) {
  await Promise.all([
    mkdir(join(workspacePath, "02_generated"), { recursive: true }),
    mkdir(join(workspacePath, "03_state"), { recursive: true }),
    mkdir(join(workspacePath, "04_logs"), { recursive: true }),
  ])
  const input = {
    studentName: "张三",
    sourceFolder: join(sharedWorkspacePath, "00_original_backup"),
    school: batchOrder === 1 ? "HKU" : "CUHK",
    program: "Accounting",
    applicationType: "硕士",
    applicationUrl: "https://example.edu/apply",
    batchId: "batch-one",
    batchWorkspacePath: join(sharedWorkspacePath, ".."),
    sharedWorkspacePath,
    batchOrder,
  }
  await Promise.all([
    writeJson(join(workspacePath, "03_state/task_input.json"), input),
    writeJson(join(workspacePath, "03_state/task_state.json"), {
      id,
      slug: `${batchOrder}-school`,
      workspacePath,
      sessionDirectory: workspacePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "已创建",
      input,
      counts: { totalFiles: 0, missingInformation: 0, missingMaterials: 0, uncertainItems: 0 },
      generatedFiles: [],
      progress: [],
    }),
    writeJson(join(workspacePath, "03_state/task_control.json"), { paused: false }),
    writeJson(join(workspacePath, "03_state/application_progress.json"), {
      currentPage: "尚未进入申请平台",
      completedPages: [],
      savedPages: [],
      uploadedMaterials: [],
      failedActions: [],
      highRiskBlocks: [],
    }),
    writeJson(join(workspacePath, "03_state/application_requirements.json"), {}),
    writeJson(join(workspacePath, "03_state/agent_execution_audit.json"), []),
    Bun.write(join(workspacePath, "04_logs/agent_log.md"), "# Agent 日志\n\n"),
    Bun.write(join(workspacePath, "04_logs/cua_log.md"), "# CUA 日志\n\n"),
  ])
}

async function generatedTools(workspacePath: string, sharedWorkspacePath: string) {
  await writeOpenCodeConfig(workspacePath, { sharedWorkspacePath })
  return import(`${join(workspacePath, ".opencode/tools/application-agent.ts")}?test=${randomUUID()}`) as Promise<{
    workspace: GeneratedTool
    materials: GeneratedTool
    documents: GeneratedTool
    cua: GeneratedTool
  }>
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "terra-shared-dossier-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJson(path: string, value: unknown) {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson(path: string) {
  return Bun.file(path).json()
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

type GeneratedTool = {
  execute(
    args: { input?: Record<string, unknown> },
    context: { directory: string; agent: string },
  ): Promise<string>
}
