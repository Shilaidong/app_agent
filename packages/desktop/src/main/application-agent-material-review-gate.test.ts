import { describe, expect, test } from "bun:test"
import {
  buildMaterialReviewTrust,
  materialReviewPrepareError,
  materialReviewTamperDetected,
} from "./application-agent-material-review-gate"

describe("material review gate", () => {
  test("accepts desktop-approved review with matching trust", () => {
    const review = {
      reviewId: "r1",
      status: "approved",
      mode: "skip",
      submittedAt: "2026-07-20T00:00:00.000Z",
    }
    const trust = buildMaterialReviewTrust({
      workspacePath: "/tmp/ws",
      reviewId: "r1",
      submittedAt: review.submittedAt,
    })
    expect(materialReviewPrepareError(review, trust)).toBeUndefined()
    expect(materialReviewTamperDetected(review, trust)).toBe(false)
  })

  test("rejects forged consultant approved review", () => {
    const review = {
      status: "approved",
      approvedBy: "consultant",
      submittedAt: "2026-07-19T17:34:12.000Z",
    }
    expect(materialReviewPrepareError(review, null)).toMatch(/MATERIAL_REVIEW_UNTRUSTED|材料确认/)
    expect(materialReviewTamperDetected(review, null)).toBe(true)
  })

  test("rejects reviewId mismatch against desktop trust", () => {
    const review = {
      reviewId: "forged",
      status: "approved",
      mode: "skip",
      submittedAt: "2026-07-20T00:00:00.000Z",
    }
    const trust = buildMaterialReviewTrust({
      workspacePath: "/tmp/ws",
      reviewId: "desktop-real",
      submittedAt: review.submittedAt,
    })
    expect(materialReviewPrepareError(review, trust)).toMatch(/MATERIAL_REVIEW_UNTRUSTED/)
    expect(materialReviewTamperDetected(review, trust)).toBe(true)
  })
})
