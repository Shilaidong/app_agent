import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, readlinkSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

export const egoRuntimeRoot = fileURLToPath(new URL("..", import.meta.url))
export const egoRuntimeLockPath = join(egoRuntimeRoot, "resources/ego-runtime.lock.json")
export const vendoredEgoLitePath = join(egoRuntimeRoot, "resources/vendor/ego-lite/ego lite.app")

const officialSkillRelativePath = "Contents/Frameworks/ego Framework.framework/Versions/Current/Resources/ego-skills/ego-browser/SKILL.md"

export type EgoRuntimeLock = {
  schemaVersion: 1
  terraPolicyRevision: string
  version: string
  bundleVersion: string
  bundleIdentifier: string
  teamIdentifier: string
  signingAuthority: string
  cdHash: string
  egoBrowserHelperSha256: string
  officialSkill: {
    relativePath: typeof officialSkillRelativePath
    sha256: string
    version: string
    date: string
  }
  updaterPayload: {
    mustBePresent: true
    mustNotBeExecutable: true
  }
}

type EgoRuntimeLockContext = Pick<EgoRuntimeLock, "terraPolicyRevision" | "bundleIdentifier" | "teamIdentifier" | "signingAuthority">

export async function readEgoRuntimeLock(path = egoRuntimeLockPath) {
  if (!(await Bun.file(path).exists())) throw new Error(`Ego runtime lock is missing: ${path}`)
  return parseEgoRuntimeLock(await Bun.file(path).json())
}

export async function captureEgoRuntime(app: string, context: EgoRuntimeLockContext): Promise<EgoRuntimeLock> {
  if (process.platform !== "darwin") throw new Error("The vendored Ego runtime can only be inspected on macOS.")
  if (!existsSync(app) || !statSync(app).isDirectory()) throw new Error(`Ego Lite app is missing: ${app}`)

  const info = join(app, "Contents/Info.plist")
  const version = requirePlistValue(info, "CFBundleShortVersionString")
  const bundleIdentifier = requirePlistValue(info, "CFBundleIdentifier")
  const bundleVersion = requirePlistValue(info, "CFBundleVersion")
  if (requirePlistValue(info, "KSVersion") !== version) throw new Error("Ego Info.plist KSVersion does not match CFBundleShortVersionString.")
  if (requirePlistValue(info, "KSProductID") !== bundleIdentifier) throw new Error("Ego Info.plist KSProductID does not match CFBundleIdentifier.")

  const current = join(app, "Contents/Frameworks/ego Framework.framework/Versions/Current")
  if (!existsSync(current) || !lstatSync(current).isSymbolicLink()) throw new Error("Ego Framework Versions/Current must be a symlink.")
  if (readlinkSync(current) !== version) throw new Error(`Ego Framework Versions/Current must point exactly to ${version}.`)

  const helper = join(app, `Contents/Frameworks/ego Framework.framework/Versions/${version}/Helpers/ego-browser`)
  if (!existsSync(helper) || !statSync(helper).isFile()) throw new Error(`Ego browser helper is missing: ${helper}`)
  if ((statSync(helper).mode & 0o111) === 0) throw new Error(`Ego browser helper is not executable: ${helper}`)

  const skill = join(app, officialSkillRelativePath)
  if (!existsSync(skill) || !statSync(skill).isFile()) throw new Error(`Official Ego browser skill is missing: ${skill}`)
  const skillMetadata = parseSkillMetadata(await Bun.file(skill).text())

  const updaterFiles = listFiles(app).filter(isUpdaterPayload)
  if (updaterFiles.length === 0) throw new Error("The signed Ego updater payload is missing.")
  const executableUpdaterFiles = updaterFiles.filter((path) => (statSync(path).mode & 0o111) !== 0)
  if (executableUpdaterFiles.length > 0) {
    throw new Error(`Ego updater payload must not be executable:\n${executableUpdaterFiles.map((path) => `- ${relative(app, path)}`).join("\n")}`)
  }

  const verification = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf8", timeout: 30_000 })
  if (verification.status !== 0) throw new Error(`Ego code-signature verification failed: ${verification.stderr || verification.error?.message || "unknown error"}`)
  const signature = codeSignature(app)
  const teamIdentifier = requireSignatureValue(signature, "TeamIdentifier")
  const signingAuthority = signature
    .split("\n")
    .find((line) => line.startsWith("Authority=Developer ID Application:"))
    ?.slice("Authority=".length)
  if (!signingAuthority) throw new Error("Ego code signature is missing its Developer ID Application authority.")

  if (bundleIdentifier !== context.bundleIdentifier) {
    throw new Error(`Ego bundle identifier changed from ${context.bundleIdentifier} to ${bundleIdentifier}.`)
  }
  if (teamIdentifier !== context.teamIdentifier) {
    throw new Error(`Ego signing team changed from ${context.teamIdentifier} to ${teamIdentifier}.`)
  }
  if (signingAuthority !== context.signingAuthority) {
    throw new Error(`Ego signing authority changed from ${context.signingAuthority} to ${signingAuthority}.`)
  }

  return {
    schemaVersion: 1,
    terraPolicyRevision: context.terraPolicyRevision,
    version,
    bundleVersion,
    bundleIdentifier,
    teamIdentifier,
    signingAuthority,
    cdHash: requireSignatureValue(signature, "CDHash"),
    egoBrowserHelperSha256: await sha256(helper),
    officialSkill: {
      relativePath: officialSkillRelativePath,
      sha256: await sha256(skill),
      version: skillMetadata.version,
      date: skillMetadata.date,
    },
    updaterPayload: {
      mustBePresent: true,
      mustNotBeExecutable: true,
    },
  }
}

export async function verifyEgoRuntime(app = vendoredEgoLitePath, lock?: EgoRuntimeLock) {
  const expected = lock ?? await readEgoRuntimeLock()
  const actual = await captureEgoRuntime(app, expected)
  const mismatches = [
    ["version", expected.version, actual.version],
    ["bundle version", expected.bundleVersion, actual.bundleVersion],
    ["bundle identifier", expected.bundleIdentifier, actual.bundleIdentifier],
    ["signing team", expected.teamIdentifier, actual.teamIdentifier],
    ["signing authority", expected.signingAuthority, actual.signingAuthority],
    ["app CDHash", expected.cdHash, actual.cdHash],
    ["ego-browser SHA256", expected.egoBrowserHelperSha256, actual.egoBrowserHelperSha256],
    ["official ego-browser Skill SHA256", expected.officialSkill.sha256, actual.officialSkill.sha256],
    ["official ego-browser Skill version", expected.officialSkill.version, actual.officialSkill.version],
    ["official ego-browser Skill date", expected.officialSkill.date, actual.officialSkill.date],
  ].filter(([, expectedValue, actualValue]) => expectedValue !== actualValue)

  if (mismatches.length > 0) {
    throw new Error(`Ego runtime does not match ${egoRuntimeLockPath}:\n${mismatches
      .map(([label, expectedValue, actualValue]) => `- ${label}: expected ${expectedValue}, found ${actualValue}`)
      .join("\n")}`)
  }
}

function parseEgoRuntimeLock(value: unknown): EgoRuntimeLock {
  const lock = requireRecord(value, "Ego runtime lock")
  const officialSkill = requireRecord(lock.officialSkill, "officialSkill")
  const updaterPayload = requireRecord(lock.updaterPayload, "updaterPayload")
  if (lock.schemaVersion !== 1) throw new Error("Ego runtime lock schemaVersion must be 1.")
  if (officialSkill.relativePath !== officialSkillRelativePath) {
    throw new Error(`officialSkill.relativePath must be the authoritative in-app path ${officialSkillRelativePath}.`)
  }
  if (updaterPayload.mustBePresent !== true || updaterPayload.mustNotBeExecutable !== true) {
    throw new Error("Ego runtime lock must require the signed updater payload to remain present and non-executable.")
  }

  const parsed = {
    schemaVersion: 1,
    terraPolicyRevision: requireString(lock.terraPolicyRevision, "terraPolicyRevision"),
    version: requireString(lock.version, "version"),
    bundleVersion: requireString(lock.bundleVersion, "bundleVersion"),
    bundleIdentifier: requireString(lock.bundleIdentifier, "bundleIdentifier"),
    teamIdentifier: requireString(lock.teamIdentifier, "teamIdentifier"),
    signingAuthority: requireString(lock.signingAuthority, "signingAuthority"),
    cdHash: requireHash(lock.cdHash, "cdHash", 40),
    egoBrowserHelperSha256: requireHash(lock.egoBrowserHelperSha256, "egoBrowserHelperSha256", 64),
    officialSkill: {
      relativePath: officialSkillRelativePath,
      sha256: requireHash(officialSkill.sha256, "officialSkill.sha256", 64),
      version: requireString(officialSkill.version, "officialSkill.version"),
      date: requireDate(officialSkill.date, "officialSkill.date"),
    },
    updaterPayload: {
      mustBePresent: true,
      mustNotBeExecutable: true,
    },
  } satisfies EgoRuntimeLock
  return parsed
}

function requireRecord(value: unknown, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`)
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Ego runtime lock ${label} must be a non-empty string.`)
  return value
}

function requireHash(value: unknown, label: string, length: number) {
  const hash = requireString(value, label)
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(hash)) throw new Error(`Ego runtime lock ${label} must be ${length} lowercase hexadecimal characters.`)
  return hash
}

function requireDate(value: unknown, label: string) {
  const date = requireString(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Ego runtime lock ${label} must use YYYY-MM-DD.`)
  return date
}

function parseSkillMetadata(source: string) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (!frontmatter) throw new Error("Official Ego browser Skill is missing YAML frontmatter.")
  const metadata = frontmatter.match(/^metadata:\s*\r?\n((?: {2,}[^\r\n]*(?:\r?\n|$))*)/m)?.[1]
  if (!metadata) throw new Error("Official Ego browser Skill is missing its metadata block.")
  const version = metadata.match(/^\s+version:\s*["']([^"']+)["']\s*$/m)?.[1]
  const date = metadata.match(/^\s+date:\s*["'](\d{4}-\d{2}-\d{2})["']\s*$/m)?.[1]
  if (!version || !date) throw new Error("Official Ego browser Skill must declare quoted version and YYYY-MM-DD date values.")
  return { version, date }
}

function requirePlistValue(path: string, key: string) {
  if (!existsSync(path)) throw new Error(`Ego Info.plist is missing: ${path}`)
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`Ego Info.plist is missing ${key}: ${result.stderr || "unknown error"}`)
  return result.stdout.trim()
}

function codeSignature(path: string) {
  const result = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", path], { encoding: "utf8", timeout: 30_000 })
  if (result.status !== 0) throw new Error(`Could not inspect Ego code signature: ${result.stderr || result.error?.message || "unknown error"}`)
  return `${result.stdout}\n${result.stderr}`
}

function requireSignatureValue(signature: string, key: string) {
  const value = signature
    .split("\n")
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1)
  if (!value) throw new Error(`Ego code signature is missing ${key}.`)
  return value
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return entry.isFile() ? [path] : []
  })
}

function isUpdaterPayload(path: string) {
  return path.includes("/EgoUpdater.app/") || path.includes("/EgoSoftwareUpdate.bundle/") || path.endsWith("/com.citrolabs.ego.UpdaterPrivilegedHelper")
}

async function sha256(path: string) {
  return new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex")
}
