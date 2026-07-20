import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { readJson, writeJsonAtomic } from "./json-store"

export type BrowserSafetyStopSummary = {
  kind: "cleanup_failed" | "alert_evidence_lost"
  taskSpaceId: string
  active: boolean
  decisionId: string
  recordedAt: string
  observationRequired?: boolean
  resolution?: string
  resumeAuthorizedAt?: string
}

export async function authorizeBrowserSafetyContinue(
  workspacePath: string,
  input: { decisionId: string; taskSpaceId: string },
) {
  const decisionId = input.decisionId.trim()
  const taskSpaceId = input.taskSpaceId.trim()
  if (!decisionId || !taskSpaceId) throw new Error("浏览器安全继续授权缺少 decisionId 或 taskSpaceId。")
  const progressPath = join(workspacePath, "03_state/application_progress.json")
  const progress = await readJson<Record<string, any>>(progressPath, {})
  const stop = progress?.egoBrowser?.safetyStop
  if (!stop || typeof stop !== "object") throw new Error("当前学校没有可授权的浏览器安全停止状态。")
  if (stop.kind !== "alert_evidence_lost") {
    throw new Error("污染的 task space 不能继续当前空间，只能点击“重新填写”创建新空间。")
  }
  if (stop.active !== true) throw new Error("当前浏览器安全停止已不在 active 状态，无需再次授权。")
  if (String(stop.taskSpaceId || "") !== taskSpaceId) throw new Error("taskSpaceId 与当前安全停止记录不匹配。")
  if (String(stop.decisionId || "") !== decisionId) throw new Error("decisionId 与当前安全停止记录不匹配。")
  if (stop.decisionConsumedAt) throw new Error("该安全决策已被消费，不能重复授权。")
  const authorizedAt = new Date().toISOString()
  progress.egoBrowser = {
    ...(progress.egoBrowser || {}),
    taskSpaceId,
    safetyStop: {
      ...stop,
      desktopAuthorization: {
        decisionId,
        taskSpaceId,
        authorizedAt,
        authorizedBy: "consultant_desktop_continue",
      },
      active: false,
      observationRequired: true,
      resolution: "consultant_continue_same_space",
      resolvedAt: authorizedAt,
      resumeAuthorizedAt: authorizedAt,
      resumeAuthorizedBy: "consultant_desktop_continue",
      decisionConsumedAt: authorizedAt,
    },
  }
  await writeJsonAtomic(progressPath, progress)
  await appendAgentLog(workspacePath, `顾问在桌面授权 alert_evidence_lost 同空间继续：taskSpaceId=${taskSpaceId} decisionId=${decisionId}。下一回合只能先观察。`)
  return {
    decisionId,
    taskSpaceId,
    authorizedAt,
    safetyStop: progress.egoBrowser.safetyStop as BrowserSafetyStopSummary & Record<string, unknown>,
  }
}

export function browserSafetyStopSummary(progress: unknown): BrowserSafetyStopSummary | undefined {
  if (!progress || typeof progress !== "object") return undefined
  const egoBrowser = (progress as { egoBrowser?: Record<string, unknown> }).egoBrowser
  const stop = egoBrowser?.safetyStop
  if (!stop || typeof stop !== "object") return undefined
  const record = stop as Record<string, unknown>
  const kind = record.kind === "cleanup_failed" || record.kind === "alert_evidence_lost" ? record.kind : ""
  const taskSpaceId = typeof record.taskSpaceId === "string" && record.taskSpaceId.trim() ? record.taskSpaceId.trim() : ""
  const decisionId = typeof record.decisionId === "string" && record.decisionId.trim() ? record.decisionId.trim() : ""
  const recordedAt = typeof record.recordedAt === "string" && record.recordedAt.trim() ? record.recordedAt.trim() : ""
  if (!kind || !taskSpaceId || !decisionId || !recordedAt) return undefined
  if (record.active !== true && record.observationRequired !== true) return undefined
  return {
    kind,
    taskSpaceId,
    active: record.active === true,
    decisionId,
    recordedAt,
    observationRequired: record.observationRequired === true,
    resolution: typeof record.resolution === "string" ? record.resolution : undefined,
    resumeAuthorizedAt: typeof record.resumeAuthorizedAt === "string" ? record.resumeAuthorizedAt : undefined,
  }
}

async function appendAgentLog(workspacePath: string, message: string) {
  const file = join(workspacePath, "04_logs/agent_log.md")
  const current = await readFile(file, "utf8").catch(() => "# Agent 日志\n\n")
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, current + "- " + new Date().toISOString() + " " + message + "\n", "utf8")
}
