import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { normalizeSelectionListRows, previewSelectionList } from "./application-selection-list"

describe("normalizeSelectionListRows", () => {
  test("skips legacy placeholders and keeps only selectable batch rows", () => {
    const result = normalizeSelectionListRows([
      { rowNumber: 2, school: "8", program: "8" },
      { rowNumber: 3, school: "George Washington University", program: "MS in Business Analytics", programUrl: "https://business.gwu.edu/msba" },
      { rowNumber: 4, school: "University of Chicago", program: "MS Analytics" },
      { rowNumber: 5, school: "", program: "MSCS" },
      { rowNumber: 6, school: "George Washington University", program: "MS in Business Analytics" },
    ])

    expect(result.rows.map((row) => row.rowNumber)).toEqual([3, 4, 5, 6])
    expect(result.rows.map((row) => row.status)).toEqual(["ready", "needs_research", "invalid", "duplicate"])
    expect(result.rows[1].warnings).toContain("未填写链接，Agent 会先核验项目与申请平台")
    expect(result.warnings).toEqual([
      "第 5 行：缺少学校名称",
      "第 6 行：与前一行的学校和专业重复；未填写链接，Agent 会先核验项目与申请平台",
    ])
  })

  test("reads the bundled passwordless template without creating fake rows", async () => {
    const preview = await previewSelectionList(join(import.meta.dir, "../../resources/templates/terra-edu-selection-list-template.xlsx"))

    expect(preview.rows).toEqual([])
    expect(preview.warnings).toEqual(["没有找到可创建申请任务的学校/专业行。"])
  })
})
