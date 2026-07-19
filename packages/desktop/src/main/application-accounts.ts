import { createHash } from "node:crypto"
import { getStore } from "./store"

const ACCOUNT_STORE = "terra.application-agent.platform-accounts"

export type ApplicationPlatformAccount = {
  key: string
  platformHost: string
  username: string
  updatedAt: string
}

export function platformAccountKey(applicationUrl: string) {
  const parsed = URL.canParse(applicationUrl) ? new URL(applicationUrl) : null
  const platformHost = (parsed?.host || applicationUrl || "unknown-platform").trim().toLowerCase().replace(/^www\./, "")
  return {
    key: createHash("sha256").update(platformHost).digest("hex").slice(0, 18),
    platformHost,
  }
}

export async function getApplicationPlatformAccount(applicationUrl: string): Promise<ApplicationPlatformAccount | null> {
  const { key, platformHost } = platformAccountKey(applicationUrl)
  const value = getStore(ACCOUNT_STORE).get(key)
  if (!value || typeof value !== "object") return null
  const username = "username" in value && typeof value.username === "string" ? value.username.trim() : ""
  if (!username) return null
  return {
    key,
    platformHost,
    username,
    updatedAt: "updatedAt" in value && typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  }
}

export async function saveApplicationPlatformAccount(input: {
  applicationUrl: string
  username: string
}): Promise<ApplicationPlatformAccount | null> {
  if (!input.applicationUrl || !input.username.trim()) return null
  const { key, platformHost } = platformAccountKey(input.applicationUrl)
  const account = { key, platformHost, username: input.username.trim(), updatedAt: new Date().toISOString() }
  getStore(ACCOUNT_STORE).set(key, account)
  return account
}

export async function clearApplicationPlatformAccount(applicationUrl: string) {
  getStore(ACCOUNT_STORE).delete(platformAccountKey(applicationUrl).key)
}
