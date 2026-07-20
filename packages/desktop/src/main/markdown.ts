import { marked, type Token, type Tokens } from "marked"

const renderer = new marked.Renderer()

const tableCardsStyle = "display:flex;flex-direction:column;gap:8px;width:100%;max-width:100%;margin:0 0 10px;"
const tableCardStyle =
  "display:block;box-sizing:border-box;width:100%;min-width:0;border:1px solid rgba(46,50,48,.1);border-radius:8px;background:#fff;padding:9px 10px;"
const tableFieldStyle =
  "display:block;box-sizing:border-box;width:100%;min-width:0;border-bottom:1px solid rgba(46,50,48,.06);padding:0 0 7px;margin:0 0 7px;"
const tableLastFieldStyle = "display:block;box-sizing:border-box;width:100%;min-width:0;padding:0;margin:0;"
const tableLabelStyle = "display:block;color:#2f5d3e;font-size:12px;font-weight:900;line-height:1.45;margin:0 0 2px;"
const tableValueStyle =
  "display:block;width:100%;min-width:0;color:#3c403d;font-size:12px;font-weight:600;line-height:1.5;white-space:normal;overflow-wrap:break-word;word-break:break-word;"

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const safeLinkProtocols = new Set(["http:", "https:", "mailto:", "tel:"])

// Agent/scraped content is untrusted and the result is injected via innerHTML in the
// renderer, so only allow known-safe URL schemes and reject javascript:/data:/etc.
function sanitizeUrl(href: string) {
  const trimmed = href.trim()
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed
  }
  if (!URL.canParse(trimmed)) return "#"
  return safeLinkProtocols.has(new URL(trimmed).protocol) ? trimmed : "#"
}

function renderTableCell(cell: Tokens.TableCell, parser?: { parseInline: (tokens: Token[]) => string }) {
  if (parser) return parser.parseInline(cell.tokens).replaceAll("\n", "<br>")
  return escapeHtml(cell.text.trim()).replaceAll("\n", "<br>")
}

renderer.link = ({ href, title, text }: Tokens.Link) => {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
  return `<a href="${escapeHtml(sanitizeUrl(href))}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

renderer.image = ({ href, title, text }: Tokens.Image) => {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
  return `<img src="${escapeHtml(sanitizeUrl(href))}" alt="${escapeHtml(text)}"${titleAttr}>`
}

// marked v15 passes raw HTML through untouched; escape it so untrusted markdown
// cannot inject active markup (e.g. <img onerror>) into the renderer's innerHTML.
renderer.html = ({ text }) => escapeHtml(text)

renderer.table = function (token: Tokens.Table) {
  const headers = token.header.map((cell, index) => renderTableCell(cell, this.parser) || `字段 ${index + 1}`)
  const rows = token.rows.length ? token.rows : [token.header]

  const cards = rows
    .map((row) => {
      const fields = row
        .map((cell, index) => {
          const label = headers[index] || `字段 ${index + 1}`
          const value = renderTableCell(cell, this.parser) || "-"
          const fieldStyle = index === row.length - 1 ? tableLastFieldStyle : tableFieldStyle
          return `<div class="markdown-table-field" style="${fieldStyle}"><span style="${tableLabelStyle}">${label}</span><span style="${tableValueStyle}">${value}</span></div>`
        })
        .join("")

      return `<article class="markdown-table-card" style="${tableCardStyle}">${fields}</article>`
    })
    .join("")

  return `<div class="markdown-table-cards" style="${tableCardsStyle}">${cards}</div>`
}

export async function parseMarkdown(input: string) {
  return await marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}
