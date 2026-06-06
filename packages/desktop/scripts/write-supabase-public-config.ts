#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const desktopRoot = process.cwd()
const projectRoot = resolve(desktopRoot, "../..")
const envPath = resolve(projectRoot, ".env.local")
const outputPath = resolve(desktopRoot, "resources/private/supabase-public.json")

function parseEnvFile(path: string) {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const index = line.indexOf("=")
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const env = { ...parseEnvFile(envPath), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

mkdirSync(dirname(outputPath), { recursive: true })

if (!url || !anonKey) {
  if (existsSync(outputPath)) {
    const existing = parseEnvFile(envPath)
    const hasEnvFile = Object.keys(existing).length > 0
    if (!hasEnvFile) {
      console.warn("Supabase public config not found in .env.local. Keeping existing local resources/private/supabase-public.json.")
      process.exit(0)
    }
  }
  writeFileSync(outputPath, JSON.stringify({ configured: false }, null, 2) + "\n", "utf8")
  console.warn("Supabase public config not found. Desktop app will run in local development mode.")
  process.exit(0)
}

writeFileSync(
  outputPath,
  JSON.stringify(
    {
      configured: true,
      url,
      anonKey,
      quotaContactWechat: "shilaidong",
      initialCredits: 200,
      creditUnitWeightedTokens: 10000,
    },
    null,
    2,
  ) + "\n",
  "utf8",
)

console.log("Wrote Supabase public desktop config to resources/private/supabase-public.json")
