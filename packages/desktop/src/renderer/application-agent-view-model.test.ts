import { describe, expect, test } from "bun:test"
import type { ApplicationAgentChatItem, ApplicationTask } from "../preload/types"
import {
  createContinueProgressNotice,
  deriveComposerRuntimeState,
  groupAgentMessages,
  groupedTasks,
  isReasoningAgentMessage,
  isRecoverableModelStreamError,
  isTechnicalAgentMessage,
  pruneLocalAgentNotices,
  taskGroupKey,
  technicalGroupIsRunning,
} from "./application-agent-view-model"

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

describe("agent chat display grouping", () => {
  test("keeps OpenCode Agent and reasoning outside technical folds", () => {
    const messages: ApplicationAgentChatItem[] = [
      { id: "a", role: "assistant", title: "OpenCode Agent", body: "已登录，继续填表" },
      { id: "r", role: "assistant", title: "Agent 思考过程", body: "先 resume_ego" },
      { id: "t1", role: "tool", title: "正在执行：bash", body: "listTaskSpaces", status: "running" },
      { id: "t2", role: "tool", title: "已完成：application-agent_cua", body: "resume_ego", status: "completed" },
    ]
    expect(isTechnicalAgentMessage(messages[0]!)).toBe(false)
    expect(isReasoningAgentMessage(messages[1]!)).toBe(true)
    expect(isTechnicalAgentMessage(messages[1]!)).toBe(false)
    const grouped = groupAgentMessages(messages)
    expect(grouped.map((item) => item.kind)).toEqual(["message", "message", "technical-group"])
    expect(grouped[2]?.kind === "technical-group" && grouped[2].id).toBe("technical:t1")
    expect(grouped[2]?.kind === "technical-group" && technicalGroupIsRunning(grouped[2].messages)).toBe(true)
    // Appending another tool keeps the same group id so the chat row does not remount/flash.
    const grown = groupAgentMessages([
      ...messages,
      { id: "t3", role: "tool", title: "已完成：bash", body: "done", status: "completed" },
    ])
    expect(grown.at(-1)?.id).toBe("technical:t1")
  })

  test("prunes local continue notices after later live activity", () => {
    const notice = createContinueProgressNotice("question-reply")
    notice.time = Date.now() - 3000
    const live: ApplicationAgentChatItem[] = [
      { id: "tool", role: "tool", title: "正在执行：bash", body: "...", status: "running", time: Date.now() },
    ]
    expect(pruneLocalAgentNotices([notice], live)).toEqual([])
    expect(createContinueProgressNotice("continue-task").title).toContain("正在恢复")
  })

  test("detects terminated stream errors for one-shot auto-recover", () => {
    expect(
      isRecoverableModelStreamError({
        id: "e1",
        role: "system",
        title: "OpenCode 异常",
        body: "模型流式连接中断（terminated）。系统会自动重试…",
        status: "error",
      }),
    ).toBe(true)
    expect(
      isRecoverableModelStreamError({
        id: "e2",
        role: "system",
        title: "OpenCode 异常",
        body: "UnknownError",
        status: "error",
      }),
    ).toBe(false)
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
