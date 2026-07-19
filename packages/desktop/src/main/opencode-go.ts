import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))

export function getOpenCodeGoApiKey(): string | null {
  const envKey = process.env.TERRA_EDU_OPENCODE_GO_KEY || process.env.OPENCODE_GO_API_KEY
  if (envKey?.trim()) return envKey.trim()

  return readBundledGoKey()
}

export function hasOpenCodeGoApiKey() {
  return Boolean(getOpenCodeGoApiKey())
}

export function openCodeGoAuthContent() {
  const key = getOpenCodeGoApiKey()
  if (!key) return null
  return JSON.stringify({
    "opencode-go": {
      type: "api",
      key,
    },
  })
}

function readBundledGoKey() {
  const candidates = [
    join(process.resourcesPath ?? "", "private", "opencode-go-key.txt"),
    join(root, "../../resources/private/opencode-go-key.txt"),
  ]
  for (const candidate of candidates) {
    try {
      if (!candidate || !existsSync(candidate)) continue
      const key = readFileSync(candidate, "utf8").trim()
      if (key) return key
    } catch {}
  }
  return null
}
