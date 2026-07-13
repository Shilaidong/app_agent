import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getStore } from "./store"

const AUTH_STORE = "terra.application-agent.auth"
const SESSION_KEY = "session"
const USAGE_STORE = "terra.application-agent.quota-usage"
const root = dirname(fileURLToPath(import.meta.url))

export type TerraAuthUser = {
  id: string
  email: string
}

export type TerraQuota = {
  creditsTotal: number
  creditsUsed: number
  creditsRemaining: number
  weightedTokensUsed: number
  status: string
  contactWechat: string
}

export type TerraAuthStatus = {
  configured: boolean
  authenticated: boolean
  localDevelopment: boolean
  user: TerraAuthUser | null
  quota: TerraQuota | null
  contactWechat: string
  message?: string
}

type SupabaseConfig = {
  configured: boolean
  url?: string
  anonKey?: string
  quotaContactWechat?: string
}

type StoredSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: TerraAuthUser
}

type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

type UsageRecord = {
  chargedCredits: number
  lastTokens: TokenUsage
}

let activeSession: StoredSession | null = null

const emptyTokens = (): TokenUsage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

export function getSupabasePublicConfig(): SupabaseConfig {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const envAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (envUrl && envAnonKey) return { configured: true, url: envUrl, anonKey: envAnonKey, quotaContactWechat: "shilaidong" }

  const candidates = [
    join(process.resourcesPath ?? "", "private", "supabase-public.json"),
    join(root, "../../resources/private/supabase-public.json"),
  ]
  for (const candidate of candidates) {
    try {
      if (!candidate || !existsSync(candidate)) continue
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as SupabaseConfig
      if (parsed.configured && parsed.url && parsed.anonKey) return parsed
    } catch {}
  }
  return { configured: false, quotaContactWechat: "shilaidong" }
}

export async function loginTerraAdvisor(email: string, password: string): Promise<TerraAuthStatus> {
  const config = requireSupabaseConfig()
  const response = await fetch(`${trimSlash(config.url)}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: supabaseHeaders(config),
    body: JSON.stringify({ email, password }),
  })
  const body = (await response.json().catch(() => ({}))) as any
  if (!response.ok) throw new Error(body?.error_description || body?.msg || "Terra-Edu 登录失败")
  if (!body.access_token || !body.refresh_token || !body.user?.id || !body.user?.email) {
    throw new Error("Terra-Edu 登录返回缺少必要凭据")
  }
  const session: StoredSession = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + Number(body.expires_in || 3600),
    user: {
      id: String(body.user.id),
      email: String(body.user.email),
    },
  }
  saveSession(session)
  return getTerraAuthStatus()
}

export function logoutTerraAdvisor() {
  activeSession = null
  getStore(AUTH_STORE).delete(SESSION_KEY)
}

export async function getTerraAuthStatus(): Promise<TerraAuthStatus> {
  const config = getSupabasePublicConfig()
  const contactWechat = config.quotaContactWechat || "shilaidong"
  if (!config.configured || !config.url || !config.anonKey) {
    return {
      configured: false,
      authenticated: true,
      localDevelopment: true,
      user: null,
      quota: null,
      contactWechat,
      message: "Supabase public config is missing. Running in local development mode.",
    }
  }

  const session = await getValidSession().catch(() => null)
  if (!session) {
    return {
      configured: true,
      authenticated: false,
      localDevelopment: false,
      user: null,
      quota: null,
      contactWechat,
    }
  }

  const quota = await getQuota(session).catch((error) => {
    throw new Error(error instanceof Error ? error.message : String(error))
  })
  return {
    configured: true,
    authenticated: true,
    localDevelopment: false,
    user: session.user,
    quota,
    contactWechat,
  }
}

export async function ensureApplicationAgentQuota(action: string, workspacePath = "", sessionID = "") {
  const config = getSupabasePublicConfig()
  if (!config.configured) return
  const session = await requireValidSession()
  const quota = await getQuota(session)
  if (quota.status !== "active" || quota.creditsRemaining <= 0) {
    throw new Error(`AI 额度已用完。请联系微信：${quota.contactWechat || "shilaidong"} 获取更多额度。`)
  }
  await logQuotaCheck(session, action, workspacePath, sessionID)
}

export async function syncApplicationAgentTokenUsage(sessionID: string, workspacePath: string, tokens: TokenUsage) {
  const config = getSupabasePublicConfig()
  if (!config.configured) return null
  const session = await requireValidSession()
  const totalWeighted = weightedTokens(tokens)
  if (totalWeighted <= 0) return await getQuota(session)

  const key = usageKey(session.user.id, sessionID)
  const record = readUsageRecord(key)
  const desiredCredits = Math.ceil(totalWeighted / 10000)
  const deltaCredits = desiredCredits - record.chargedCredits
  if (deltaCredits <= 0) return await getQuota(session)

  const delta = subtractTokens(tokens, record.lastTokens)
  await consumeQuota(session, {
    action: "agent_token_usage",
    workspacePath,
    sessionID,
    idempotencyKey: `${sessionID}:tokens:${desiredCredits}`,
    tokens: delta,
    minimumCredits: deltaCredits,
    allowOverage: true,
  })
  writeUsageRecord(key, { chargedCredits: desiredCredits, lastTokens: tokens })
  return await getQuota(session)
}

function requireSupabaseConfig() {
  const config = getSupabasePublicConfig()
  if (!config.configured || !config.url || !config.anonKey) throw new Error("Supabase 尚未配置到桌面端构建中")
  return config as Required<Pick<SupabaseConfig, "url" | "anonKey">> & SupabaseConfig
}

async function requireValidSession() {
  const session = await getValidSession()
  if (!session) throw new Error("请先登录 Terra-Edu 顾问账号")
  return session
}

async function getValidSession() {
  const session = readSession()
  if (!session) return null
  if (session.expiresAt > Math.floor(Date.now() / 1000) + 90) return session
  return await refreshSession(session)
}

async function refreshSession(session: StoredSession) {
  const config = requireSupabaseConfig()
  const response = await fetch(`${trimSlash(config.url)}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: supabaseHeaders(config),
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  })
  const body = (await response.json().catch(() => ({}))) as any
  if (!response.ok || !body.access_token || !body.refresh_token) {
    logoutTerraAdvisor()
    return null
  }
  const next: StoredSession = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + Number(body.expires_in || 3600),
    user: session.user,
  }
  saveSession(next)
  return next
}

async function getQuota(session: StoredSession): Promise<TerraQuota> {
  const rows = await rpc<any[]>(session, "application_agent_get_quota", {})
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row) throw new Error("无法读取 AI 额度")
  return {
    creditsTotal: Number(row.credits_total || 0),
    creditsUsed: Number(row.credits_used || 0),
    creditsRemaining: Number(row.credits_remaining || 0),
    weightedTokensUsed: Number(row.weighted_tokens_used || 0),
    status: String(row.status || "active"),
    contactWechat: "shilaidong",
  }
}

async function consumeQuota(
  session: StoredSession,
  input: {
    action: string
    workspacePath: string
    sessionID: string
    idempotencyKey: string
    tokens: TokenUsage
    minimumCredits: number
    allowOverage: boolean
  },
) {
  const result = await rpc<any[]>(session, "application_agent_consume_ai_quota", {
    p_idempotency_key: input.idempotencyKey,
    p_action: input.action,
    p_workspace_path: input.workspacePath,
    p_session_id: input.sessionID,
    p_input_tokens: Math.max(0, Math.floor(input.tokens.input || 0)),
    p_output_tokens: Math.max(0, Math.floor(input.tokens.output || 0)),
    p_reasoning_tokens: Math.max(0, Math.floor(input.tokens.reasoning || 0)),
    p_cache_read_tokens: Math.max(0, Math.floor(input.tokens.cache.read || 0)),
    p_cache_write_tokens: Math.max(0, Math.floor(input.tokens.cache.write || 0)),
    p_minimum_credits: Math.max(0, Math.floor(input.minimumCredits || 0)),
    p_allow_overage: input.allowOverage,
  })
  const row = Array.isArray(result) ? result[0] : result
  if (row && row.allowed === false) throw new Error(row.message || "AI 额度不足")
  return row
}

async function logQuotaCheck(session: StoredSession, action: string, workspacePath: string, sessionID: string) {
  const store = getStore(USAGE_STORE)
  store.set(`last-check:${randomUUID()}`, {
    at: new Date().toISOString(),
    user: session.user.email,
    action,
    workspacePath,
    sessionID,
  })
}

async function rpc<T>(session: StoredSession, fn: string, payload: unknown): Promise<T> {
  const config = requireSupabaseConfig()
  const response = await fetch(`${trimSlash(config.url)}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(config),
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.message || body?.error_description || `Supabase RPC failed: ${fn}`)
  return body as T
}

function saveSession(session: StoredSession) {
  activeSession = session
  getStore(AUTH_STORE).delete(SESSION_KEY)
}

function readSession(): StoredSession | null {
  getStore(AUTH_STORE).delete(SESSION_KEY)
  return activeSession
}

function readUsageRecord(key: string): UsageRecord {
  const value = getStore(USAGE_STORE).get(key)
  if (!value || typeof value !== "object") return { chargedCredits: 0, lastTokens: emptyTokens() }
  const record = value as Partial<UsageRecord>
  return {
    chargedCredits: Number(record.chargedCredits || 0),
    lastTokens: normalizeTokens(record.lastTokens),
  }
}

function writeUsageRecord(key: string, value: UsageRecord) {
  getStore(USAGE_STORE).set(key, value)
}

function usageKey(userID: string, sessionID: string) {
  return `${userID}:${sessionID}`
}

function normalizeTokens(value: unknown): TokenUsage {
  const item = (value && typeof value === "object" ? value : {}) as any
  return {
    input: Number(item.input || 0),
    output: Number(item.output || 0),
    reasoning: Number(item.reasoning || 0),
    cache: {
      read: Number(item.cache?.read || 0),
      write: Number(item.cache?.write || 0),
    },
  }
}

function subtractTokens(next: TokenUsage, previous: TokenUsage): TokenUsage {
  return {
    input: Math.max(0, next.input - previous.input),
    output: Math.max(0, next.output - previous.output),
    reasoning: Math.max(0, next.reasoning - previous.reasoning),
    cache: {
      read: Math.max(0, next.cache.read - previous.cache.read),
      write: Math.max(0, next.cache.write - previous.cache.write),
    },
  }
}

function weightedTokens(tokens: TokenUsage) {
  return Math.max(0, tokens.input + tokens.output * 4 + tokens.reasoning + tokens.cache.write)
}

function supabaseHeaders(config: { anonKey: string }) {
  return {
    apikey: config.anonKey,
    "content-type": "application/json",
  }
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "")
}
