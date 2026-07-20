import { describe, expect, test } from "bun:test"

import { parseMarkdown } from "./markdown"

describe("parseMarkdown", () => {
  test("renders links as external links that open in a new tab", async () => {
    const html = await parseMarkdown("[open](https://example.com)")

    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('class="external-link"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain(">open</a>")
    expect(html).not.toContain("title=")
  })

  test("keeps the link title attribute only when a title is present", async () => {
    const html = await parseMarkdown('[open](https://example.com "hover")')

    expect(html).toContain('title="hover"')
  })

  test("renders GFM tables as stacked cards with label/value fields", async () => {
    const html = await parseMarkdown("| 学校 | 专业 |\n|---|---|\n| HKU | MSBA |")

    expect(html).toContain('class="markdown-table-cards"')
    expect(html).toContain('class="markdown-table-card"')
    const fields = html.match(/class="markdown-table-field"/g) ?? []
    expect(fields.length).toBe(2)
    expect(html).toContain(">学校</span>")
    expect(html).toContain(">HKU</span>")
    expect(html).toContain(">专业</span>")
    expect(html).toContain(">MSBA</span>")
  })

  test("substitutes a dash for empty table cells", async () => {
    const html = await parseMarkdown("| 学校 | 专业 |\n|---|---|\n|  | MSBA |")

    expect(html).toContain(">-</span>")
  })

  test("labels headerless columns with a positional placeholder", async () => {
    const html = await parseMarkdown("|  | 专业 |\n|---|---|\n| HKU | MSBA |")

    expect(html).toContain(">字段 1</span>")
  })

  test("falls back to the header row when a table has no body rows", async () => {
    const html = await parseMarkdown("| 学校 | 专业 |\n|---|---|")

    expect(html).toContain('class="markdown-table-card"')
    const fields = html.match(/class="markdown-table-field"/g) ?? []
    expect(fields.length).toBe(2)
    // the header doubles as the single body row, so it appears as both label and value
    expect((html.match(/>学校</g) ?? []).length).toBe(2)
  })

  test("preserves inline formatting inside paragraphs", async () => {
    const html = await parseMarkdown("hello **world**")

    expect(html).toContain("<strong>world</strong>")
  })

  test("does not turn single newlines into line breaks", async () => {
    const html = await parseMarkdown("first\nsecond")

    expect(html).not.toContain("<br>")
    expect(html).toContain("first\nsecond")
  })
})
