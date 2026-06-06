import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getStore } from "./store"

const execFileAsync = promisify(execFile)
const CREDENTIAL_STORE = "terra.application-agent.platform-credentials"

export type ApplicationPlatformCredentialSummary = {
  key: string
  serviceName: string
  platformHost: string
  username: string
  hasPassword: boolean
  updatedAt: string
}

export function platformCredentialKey(applicationUrl: string) {
  const parsed = URL.canParse(applicationUrl) ? new URL(applicationUrl) : null
  const host = (parsed?.host || applicationUrl || "unknown-platform").trim().toLowerCase().replace(/^www\./, "")
  return {
    key: createHash("sha256").update(host).digest("hex").slice(0, 18),
    platformHost: host,
  }
}

export function platformCredentialService(applicationUrl: string) {
  const { key } = platformCredentialKey(applicationUrl)
  return `terra-edu.application-agent.platform.${key}`
}

export async function getApplicationPlatformCredential(applicationUrl: string): Promise<ApplicationPlatformCredentialSummary | null> {
  const { key, platformHost } = platformCredentialKey(applicationUrl)
  const value = getStore(CREDENTIAL_STORE).get(key)
  if (!value || typeof value !== "object") return null
  const record = value as Partial<ApplicationPlatformCredentialSummary>
  if (!record.username) return null
  return {
    key,
    serviceName: platformCredentialService(applicationUrl),
    platformHost,
    username: String(record.username),
    hasPassword: Boolean(record.hasPassword),
    updatedAt: String(record.updatedAt || new Date().toISOString()),
  }
}

export async function saveApplicationPlatformCredential(input: {
  applicationUrl: string
  username: string
  password?: string
  rememberPassword?: boolean
}): Promise<ApplicationPlatformCredentialSummary | null> {
  if (!input.applicationUrl || !input.username.trim()) return null
  const { key, platformHost } = platformCredentialKey(input.applicationUrl)
  const serviceName = platformCredentialService(input.applicationUrl)
  const username = input.username.trim()
  const existing = await getApplicationPlatformCredential(input.applicationUrl)
  const shouldSavePassword = Boolean(input.rememberPassword && input.password)
  if (shouldSavePassword) {
    await execFileAsync("security", ["add-generic-password", "-s", serviceName, "-a", username, "-w", input.password!, "-U"])
  } else if (input.rememberPassword === false && existing?.hasPassword) {
    await deleteKeychainPassword(serviceName, existing.username)
  }
  const summary: ApplicationPlatformCredentialSummary = {
    key,
    serviceName,
    platformHost,
    username,
    hasPassword: shouldSavePassword || (input.rememberPassword !== false && Boolean(existing?.hasPassword)),
    updatedAt: new Date().toISOString(),
  }
  getStore(CREDENTIAL_STORE).set(key, summary)
  return summary
}

export async function clearApplicationPlatformCredential(applicationUrl: string) {
  const existing = await getApplicationPlatformCredential(applicationUrl)
  if (existing?.hasPassword) await deleteKeychainPassword(existing.serviceName, existing.username)
  getStore(CREDENTIAL_STORE).delete(platformCredentialKey(applicationUrl).key)
}

async function deleteKeychainPassword(serviceName: string, username: string) {
  await execFileAsync("security", ["delete-generic-password", "-s", serviceName, "-a", username]).catch(() => undefined)
}
