import { describe, expect, test } from "bun:test"
import type { ApplicationTask } from "../preload/types"
import { deriveComposerRuntimeState, groupedTasks, taskGroupKey } from "./application-agent-view-model"

describe("application task grouping", () => {
  test("groups schools by student workspace and keeps batch order", () => {
    const firstBatch = "/tmp/terra/student-a"
    const secondBatch = "/tmp/terra/student-b"
    const groups = groupedTasks([
      task("张三", "CUHK", 2, firstBatch),
      task("张三", "HKU", 1, firstBatch),
      task("张三", "NUS", 1, secondBatch),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.find((group) => group.key === firstBatch)?.items.map((item) => item.input.school)).toEqual([
      "HKU",
      "CUHK",
    ])
    expect(groups.find((group) => group.key === secondBatch)?.items.map((item) => item.input.school)).toEqual([
      "NUS",
    ])
  })

  test("keeps legacy flat tasks grouped without guessing a parent folder", () => {
    const first = task("  张三 ", "HKU")
    const second = task("张三", "CUHK")

    expect(taskGroupKey(first)).toBe("legacy:张三")
    expect(groupedTasks([first, second])).toHaveLength(1)
  })
})

describe("composer runtime chip", () => {
  test("prioritizes safety stop over working status", () => {
    const current = task("张三", "HKU")
    current.status = "正在填写申请平台"
    current.browserSafetyStop = {
      kind: "cleanup_failed",
      taskSpaceId: "1",
      active: true,
      decisionId: "d1",
      recordedAt: new Date().toISOString(),
    }
    expect(deriveComposerRuntimeState({ task: current }).kind).toBe("safety_stop")
  })

  test("shows OCR detail while reading files", () => {
    const current = task("张三", "HKU")
    current.status = "正在读取文件"
    current.ocr = {
      phase: "running",
      current: 3,
      total: 22,
      startedAt: new Date().toISOString(),
      avgSeconds: 35,
      etaAt: new Date().toISOString(),
    }
    const state = deriveComposerRuntimeState({ task: current })
    expect(state.kind).toBe("working")
    expect(state.detail).toContain("OCR 3/22")
  })

  test("exposes browser handoff waiting state", () => {
    const current = task("张三", "HKU")
    current.status = "等待顾问接管浏览器"
    current.browserHandoffPending = true
    expect(deriveComposerRuntimeState({ task: current }).kind).toBe("browser_handoff")
  })
})

function task(
  studentName: string,
  school: string,
  batchOrder?: number,
  batchWorkspacePath?: string,
): ApplicationTask {
  const now = new Date().toISOString()
  return {
    id: `${studentName}-${school}-${batchWorkspacePath || "legacy"}`,
    slug: school.toLowerCase(),
    workspacePath: `${batchWorkspacePath || "/tmp/legacy"}/${school}`,
    sessionDirectory: `${batchWorkspacePath || "/tmp/legacy"}/${school}`,
    createdAt: now,
    updatedAt: now,
    status: "已创建",
    input: {
      studentName,
      sourceFolder: "/tmp/materials",
      school,
      program: "Programme",
      applicationType: "硕士",
      batchId: batchWorkspacePath ? batchWorkspacePath.split("/").at(-1) : undefined,
      batchWorkspacePath,
      batchOrder,
    },
    counts: { totalFiles: 0, missingInformation: 0, missingMaterials: 0, uncertainItems: 0 },
    generatedFiles: [],
    progress: [],
  }
}
