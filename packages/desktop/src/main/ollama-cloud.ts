import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))

export function getOllamaCloudApiKey(): string | null {
  const envKey = process.env.TERRA_EDU_OLLAMA_API_KEY || process.env.OLLAMA_API_KEY
  if (envKey?.trim()) return envKey.trim()

  return readBundledOllamaKey()
}

export function hasOllamaCloudApiKey() {
  return Boolean(getOllamaCloudApiKey())
}

function readBundledOllamaKey() {
  const candidates = [
    join(process.resourcesPath ?? "", "private", "ollama-cloud-key.txt"),
    join(root, "../../resources/private/ollama-cloud-key.txt"),
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
