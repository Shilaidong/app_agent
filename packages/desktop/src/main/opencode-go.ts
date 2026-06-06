import { safeStorage } from "electron"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getStore } from "./store"

const GO_KEY_STORE = "terra.application-agent.go"
const GO_KEY_FIELD = "encryptedApiKey"
const root = dirname(fileURLToPath(import.meta.url))

export function setOpenCodeGoApiKey(key: string | null) {
  const store = getStore(GO_KEY_STORE)
  if (!key?.trim()) {
    store.delete(GO_KEY_FIELD)
    return
  }
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key.trim()).toString("base64")
    : Buffer.from(key.trim(), "utf8").toString("base64")
  store.set(GO_KEY_FIELD, encrypted)
}

export function getOpenCodeGoApiKey(): string | null {
  const envKey = process.env.TERRA_EDU_OPENCODE_GO_KEY || process.env.OPENCODE_GO_API_KEY
  if (envKey?.trim()) return envKey.trim()

  const bundledKey = readBundledGoKey()
  if (bundledKey) return bundledKey

  const encrypted = getStore(GO_KEY_STORE).get(GO_KEY_FIELD)
  if (typeof encrypted === "string" && encrypted) {
    const buffer = Buffer.from(encrypted, "base64")
    try {
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString("utf8")
    } catch {}
  }

  return null
}

export function hasOpenCodeGoApiKey() {
  const envKey = process.env.TERRA_EDU_OPENCODE_GO_KEY || process.env.OPENCODE_GO_API_KEY
  if (envKey?.trim()) return true
  if (readBundledGoKey()) return true
  return typeof getStore(GO_KEY_STORE).get(GO_KEY_FIELD) === "string"
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
