import { basename } from "node:path"
import * as XLSX from "xlsx"

const REQUIRED_HEADERS = ["学校名称", "专业名称", "专业链接", "截止日期", "申请平台链接", "申请平台账号", "备注"] as const

export type SelectionListRowStatus = "ready" | "needs_research" | "invalid" | "duplicate"

export type SelectionListRow = {
  rowNumber: number
  school: string
  program: string
  programUrl?: string
  deadline?: string
  applicationUrl?: string
  platformUsername?: string
  notes?: string
  status: SelectionListRowStatus
  warnings: string[]
}

export type SelectionListPreview = {
  sourcePath: string
  sourceName: string
  rows: SelectionListRow[]
  warnings: string[]
}

export type SelectionListRawRow = Omit<SelectionListRow, "status" | "warnings">

export async function previewSelectionList(sourcePath: string): Promise<SelectionListPreview> {
  const workbook = XLSX.readFile(sourcePath, { cellDates: true, raw: false })
  const worksheet = workbook.Sheets["选校清单"] ?? workbook.Sheets[workbook.SheetNames[0] || ""]
  if (!worksheet) throw new Error("选校清单中没有可读取的工作表。")

  const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" })
  const headers = values[0]?.map(cellText) ?? []
  if (headers.includes("申请平台密码")) {
    throw new Error("检测到旧版“申请平台密码”列。请下载并使用最新版无密码模板后再导入。")
  }

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header))
  if (missingHeaders.length > 0) {
    throw new Error(`选校清单缺少以下列：${missingHeaders.join("、")}。请使用应用内下载的模板。`)
  }

  const headerColumn = new Map(headers.map((header, index) => [header, index]))
  const rawRows = values.slice(1).map((row, index) => {
    const rowNumber = index + 2
    return {
      rowNumber,
      school: cellText(row[headerColumn.get("学校名称")!]),
      program: cellText(row[headerColumn.get("专业名称")!]),
      programUrl: optionalText(row[headerColumn.get("专业链接")!]),
      deadline: optionalText(row[headerColumn.get("截止日期")!]),
      applicationUrl: optionalText(row[headerColumn.get("申请平台链接")!]),
      platformUsername: optionalText(row[headerColumn.get("申请平台账号")!]),
      notes: optionalText(row[headerColumn.get("备注")!]),
    }
  })

  return {
    sourcePath,
    sourceName: basename(sourcePath),
    ...normalizeSelectionListRows(rawRows),
  }
}

export function normalizeSelectionListRows(rawRows: SelectionListRawRow[]): Pick<SelectionListPreview, "rows" | "warnings"> {
  const warnings: string[] = []
  const seen = new Set<string>()
  const rows = rawRows.flatMap((row) => {
    const values = [row.school, row.program, row.programUrl, row.deadline, row.applicationUrl, row.platformUsername, row.notes]
    if (values.every((value) => !value || isLegacyPlaceholder(value))) return []

    const rowWarnings: string[] = []
    if (!row.school) rowWarnings.push("缺少学校名称")
    if (!row.program) rowWarnings.push("缺少专业名称")
    if (row.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(row.deadline)) rowWarnings.push("截止日期应为 yyyy-mm-dd")
    const key = `${row.school.trim().toLocaleLowerCase()}\u0000${row.program.trim().toLocaleLowerCase()}`
    const duplicate = Boolean(row.school && row.program && seen.has(key))
    if (row.school && row.program) seen.add(key)
    if (duplicate) rowWarnings.push("与前一行的学校和专业重复")
    if (row.school && row.program && !row.programUrl && !row.applicationUrl) rowWarnings.push("未填写链接，Agent 会先核验项目与申请平台")

    const status: SelectionListRowStatus = rowWarnings.some((warning) => warning.startsWith("缺少") || warning.startsWith("截止日期"))
      ? "invalid"
      : duplicate
        ? "duplicate"
        : row.programUrl || row.applicationUrl
          ? "ready"
          : "needs_research"

    if (status === "invalid" || status === "duplicate") warnings.push(`第 ${row.rowNumber} 行：${rowWarnings.join("；")}`)
    return [{ ...row, status, warnings: rowWarnings }]
  })

  if (rows.length === 0) warnings.push("没有找到可创建申请任务的学校/专业行。")
  return { rows, warnings }
}

function optionalText(value: unknown) {
  const text = cellText(value)
  return text && !isLegacyPlaceholder(text) ? text : undefined
}

function cellText(value: unknown) {
  if (value instanceof Date) return formatDate(value)
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim()
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text.trim()
    if (typeof value.result === "string" || typeof value.result === "number" || typeof value.result === "boolean") return String(value.result).trim()
    if (value.result instanceof Date) return formatDate(value.result)
  }
  return ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function isLegacyPlaceholder(value: string) {
  return value === "8" || value === "1900-01-08"
}
