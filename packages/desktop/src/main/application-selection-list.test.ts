import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import XLSX from "xlsx"
import { normalizeSelectionListRows, previewSelectionList } from "./application-selection-list"

const REQUIRED_HEADERS = ["学校名称", "专业名称", "专业链接", "截止日期", "申请平台链接", "申请平台账号", "备注"]
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function writeSelectionListWorkbook(rows: unknown[][], sheetName = "选校清单") {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName)
  const directory = await mkdtemp(join(tmpdir(), "terra-selection-list-"))
  temporaryDirectories.push(directory)
  const path = join(directory, "selection-list.xlsx")
  XLSX.writeFile(workbook, path)
  return path
}

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

  test("flags a deadline that is not yyyy-mm-dd as invalid", () => {
    const result = normalizeSelectionListRows([{ rowNumber: 2, school: "HKU", program: "MSBA", deadline: "2025/01/02" }])

    expect(result.rows[0].status).toBe("invalid")
    expect(result.rows[0].warnings).toContain("截止日期应为 yyyy-mm-dd")
  })

  test("treats a row with only an application platform link as ready", () => {
    const result = normalizeSelectionListRows([{ rowNumber: 2, school: "HKU", program: "MSBA", applicationUrl: "https://apply" }])

    expect(result.rows[0].status).toBe("ready")
    expect(result.rows[0].warnings).toEqual([])
  })
})

describe("previewSelectionList", () => {
  test("parses a workbook into a ready row with the file name and source path", async () => {
    const path = await writeSelectionListWorkbook([
      REQUIRED_HEADERS,
      ["HKU", "MSBA", "https://program", "2025-01-02", "https://apply", "student01", "备注"],
    ])

    const preview = await previewSelectionList(path)

    expect(preview.sourcePath).toBe(path)
    expect(preview.sourceName).toBe("selection-list.xlsx")
    expect(preview.warnings).toEqual([])
    expect(preview.rows).toEqual([
      {
        rowNumber: 2,
        school: "HKU",
        program: "MSBA",
        programUrl: "https://program",
        deadline: "2025-01-02",
        applicationUrl: "https://apply",
        platformUsername: "student01",
        notes: "备注",
        status: "ready",
        warnings: [],
      },
    ])
  })

  test("rejects a workbook missing required columns", async () => {
    const path = await writeSelectionListWorkbook([["学校名称", "专业名称"], ["HKU", "MSBA"]])

    await expect(previewSelectionList(path)).rejects.toThrow("选校清单缺少以下列")
  })

  test("rejects the legacy template that still carries a password column", async () => {
    const path = await writeSelectionListWorkbook([[...REQUIRED_HEADERS, "申请平台密码"], []])

    await expect(previewSelectionList(path)).rejects.toThrow("检测到旧版“申请平台密码”列")
  })
})
