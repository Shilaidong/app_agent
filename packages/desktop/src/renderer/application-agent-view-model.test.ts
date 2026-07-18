import { describe, expect, test } from "bun:test"
import type { ApplicationTask } from "../preload/types"
import { groupedTasks, taskGroupKey } from "./application-agent-view-model"

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
