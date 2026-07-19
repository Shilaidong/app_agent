import { join } from "node:path"

/** Written only by the desktop material-review IPC path; agent write/edit must not forge it. */
export const MATERIAL_REVIEW_TRUST_RELATIVE = "03_state/.desktop_material_review_trust.json"

export type MaterialReviewTrust = {
  reviewId: string
  approvedBy: "desktop_submitApplicationMaterialReview"
  submittedAt: string
  workspacePath: string
  writtenAt: string
}

export type MaterialReviewRecord = {
  status?: string
  reviewId?: string
  mode?: string
  submittedAt?: string
  preparationCompleteAt?: string
  scope?: string
  sourceManifest?: unknown
  approvedBy?: string
}

export function materialReviewTrustPath(workspacePath: string) {
  return join(workspacePath, "03_state", ".desktop_material_review_trust.json")
}

export function buildMaterialReviewTrust(input: {
  workspacePath: string
  reviewId: string
  submittedAt: string
}): MaterialReviewTrust {
  return {
    reviewId: input.reviewId,
    approvedBy: "desktop_submitApplicationMaterialReview",
    submittedAt: input.submittedAt,
    workspacePath: input.workspacePath,
    writtenAt: new Date().toISOString(),
  }
}

/** Gate for prepare_ego_task / browser start: must be desktop-approved and trusted. */
export function materialReviewPrepareError(
  review: MaterialReviewRecord | null | undefined,
  trust: MaterialReviewTrust | null | undefined,
): string | undefined {
  if (!review || review.status !== "approved") {
    return "材料确认或补充内容同步尚未完成。请停止，不要启动 ego-browser；等待 material_review.json 记录 preparationCompleteAt。"
  }
  if (!String(review.reviewId || "").trim() || !String(review.mode || "").trim() || !String(review.submittedAt || "").trim()) {
    return "MATERIAL_REVIEW_UNTRUSTED: material_review.json 缺少桌面审核 schema（reviewId/mode/submittedAt），疑似非桌面写入。"
  }
  if (!trust?.reviewId || trust.reviewId !== review.reviewId || trust.approvedBy !== "desktop_submitApplicationMaterialReview") {
    return "MATERIAL_REVIEW_UNTRUSTED: 材料审核未通过桌面授权记录校验。Agent 不得自行伪造 material_review.json；请顾问在材料确认面板重新确认。"
  }
  return undefined
}

/** True when an approved review on disk is not backed by desktop trust (forged or stale). */
export function materialReviewTamperDetected(
  review: MaterialReviewRecord | null | undefined,
  trust: MaterialReviewTrust | null | undefined,
) {
  if (!review || review.status !== "approved") return false
  return Boolean(materialReviewPrepareError(review, trust))
}
