import { describe, expect, test } from "bun:test"
import { parseMarkdown } from "./markdown"

describe("parseMarkdown sanitization", () => {
  test("strips javascript: link hrefs", async () => {
    const html = await parseMarkdown("[click](javascript:alert(1))")
    expect(html).toContain('href="#"')
    expect(html).not.toContain("javascript:")
  })

  test("strips javascript: link hrefs case-insensitively", async () => {
    const html = await parseMarkdown("[x](JAVASCRIPT:alert(1))")
    expect(html.toLowerCase()).not.toContain("javascript:")
  })

  test("escapes raw HTML instead of passing it through", async () => {
    const html = await parseMarkdown("<img src=x onerror=alert(1)>")
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  test("escapes raw script tags", async () => {
    const html = await parseMarkdown("<script>alert(1)</script>")
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  test("neutralizes attribute injection via link title", async () => {
    const html = await parseMarkdown('[t](http://ok.com "a\\" onmouseover=alert(1) x=")')
    // the injected quote must be escaped so it cannot break out of the title attribute
    expect(html).not.toContain('" onmouseover=alert(1)')
    expect(html).toContain("&quot; onmouseover=alert(1)")
  })

  test("sanitizes image src", async () => {
    const html = await parseMarkdown("![i](javascript:alert(1))")
    expect(html).not.toContain("javascript:")
  })

  test("preserves safe links and text", async () => {
    const html = await parseMarkdown("hello [ok](https://example.com)")
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain("hello")
  })
})
