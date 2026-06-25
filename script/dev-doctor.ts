#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const root = process.cwd()
const expectedBun = "1.3.14"
const expectedEgoLite = "0.4.2.15"

type Status = "ok" | "warn" | "fail"

const results: { status: Status; label: string; detail: string }[] = []

function add(status: Status, label: string, detail: string) {
  results.push({ status, label, detail })
}

function addCheck(condition: unknown, label: string, failDetail: string, status: Status = "fail", okDetail = "Ready.") {
  add(condition ? "ok" : status, label, condition ? okDetail : failDetail)
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  }
}

function hasFile(path: string) {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
}

function hasDir(path: string) {
  return existsSync(path) && statSync(path).isDirectory()
}

function read(path: string) {
  return hasFile(path) ? readFileSync(path, "utf8") : ""
}

function listFiles(path: string): string[] {
  if (!hasDir(path)) return []
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name)
    if (entry.isDirectory()) return listFiles(full)
    if (entry.isFile()) return [full]
    return []
  })
}

function checkBun() {
  add(
    Bun.version === expectedBun ? "ok" : "warn",
    "Bun runtime",
    Bun.version === expectedBun
      ? `Bun ${expectedBun}`
      : `Current Bun is ${Bun.version}; this repo is pinned to ${expectedBun}.`,
  )
}

function checkPackageFiles() {
  const packageJson = read(join(root, "package.json"))
  addCheck(
    packageJson.includes(`"packageManager": "bun@${expectedBun}"`),
    "packageManager pin",
    `Expected bun@${expectedBun}.`,
    "fail",
    `bun@${expectedBun}`,
  )
  addCheck(
    hasFile(join(root, "bun.lock")),
    "root lockfile",
    "bun.lock must be present for reproducible installs.",
    "fail",
    "bun.lock present.",
  )
  addCheck(
    hasDir(join(root, "node_modules")),
    "dependencies",
    "Run `bun install` if node_modules is missing.",
    "warn",
    "node_modules present.",
  )
}

function checkGit() {
  const lfs = run("git", ["lfs", "version"])
  add(lfs.ok ? "ok" : "fail", "Git LFS", lfs.ok ? lfs.stdout : "Install Git LFS before cloning large runtime assets.")

  const attrs = read(join(root, ".gitattributes"))
  addCheck(
    attrs.includes("packages/desktop/resources/vendor/ego-lite/** filter=lfs"),
    "Git LFS tracking",
    "Vendored ego-lite must stay in Git LFS.",
    "fail",
    "Vendored ego-lite is tracked by LFS.",
  )

  const status = run("git", ["status", "--short"])
  add(
    status.stdout.length === 0 ? "ok" : "warn",
    "working tree",
    status.stdout.length === 0 ? "Clean." : "There are local changes.",
  )
}

function checkPrivateRuntimeConfig() {
  const keyPath = join(root, "packages/desktop/resources/private/opencode-go-key.txt")
  const supabasePath = join(root, "packages/desktop/resources/private/supabase-public.json")
  const supabase = read(supabasePath)

  addCheck(
    hasFile(keyPath) && read(keyPath).startsWith("sk-"),
    "OpenCode Go key",
    "Private customer build key is missing.",
  )
  addCheck(hasFile(supabasePath), "Supabase public config", "supabase-public.json must be bundled.")
  addCheck(
    supabase.includes('"configured": true'),
    "Supabase configured",
    "Expected configured=true.",
    "fail",
    "configured=true.",
  )
  addCheck(
    supabase.includes('"initialCredits": 200'),
    "AI credit default",
    "Expected 200 initial credits.",
    "fail",
    "200 initial credits.",
  )
}

function checkEgoLiteRuntime() {
  const app = join(root, "packages/desktop/resources/vendor/ego-lite/ego lite.app")
  const info = join(app, "Contents/Info.plist")
  const contents = join(app, "Contents")
  const files = listFiles(contents)
  const updaterPattern = /EgoUpdater\.app|EgoSoftwareUpdate\.bundle|\/ksadmin$|\/ksinstall$/

  addCheck(
    hasDir(app),
    "bundled ego lite",
    "Expected packages/desktop/resources/vendor/ego-lite/ego lite.app.",
    "fail",
    "ego lite.app present.",
  )
  addCheck(
    read(info).includes(expectedEgoLite),
    "ego lite version",
    `Expected ${expectedEgoLite}.`,
    "fail",
    expectedEgoLite,
  )
  addCheck(
    !read(info).includes("KSUpdateURL"),
    "ego lite update feed",
    "KSUpdateURL must not be present.",
    "fail",
    "No update feed found.",
  )
  addCheck(
    !files.some((file) => updaterPattern.test(file)),
    "ego lite updater components",
    "Updater components must be removed.",
    "fail",
    "No updater components found.",
  )
  addCheck(
    files.some((file) => file.endsWith("/ego-browser") && statSync(file).mode & 0o111),
    "ego-browser helper",
    "Executable helper must exist in the bundled app.",
    "fail",
    "Executable helper present.",
  )
}

function checkApplicationAgentContracts() {
  const source = read(join(root, "packages/desktop/src/main/application-agent-opencode.ts"))
  const skill = read(join(root, "packages/desktop/resources/ego-browser/SKILL.md"))
  const builder = read(join(root, "packages/desktop/electron-builder.config.ts"))

  addCheck(
    source.includes("writeEgoBrowserWrapper"),
    "workspace wrapper generator",
    "Workspaces must generate .opencode/bin/ego-browser.",
  )
  addCheck(
    skill.includes('PATH="$PWD/.opencode/bin:$PATH" ego-browser'),
    "ego-browser skill wrapper",
    "Skill must use the Terra wrapper.",
  )
  addCheck(
    builder.includes("resources/vendor/ego-lite/"),
    "mac package vendor resource",
    "Electron builder must package the bundled browser.",
  )
  addCheck(builder.includes("!resources/vendor/**"), "asar exclusion", "Bundled browser must stay out of app.asar.")
}

function printResults() {
  const icon = { ok: "OK", warn: "WARN", fail: "FAIL" } satisfies Record<Status, string>
  for (const result of results) {
    console.log(`${icon[result.status]}  ${result.label}: ${result.detail}`)
  }

  const failed = results.filter((result) => result.status === "fail")
  const warned = results.filter((result) => result.status === "warn")

  console.log("")
  console.log(
    `Summary: ${results.length - failed.length - warned.length} ok, ${warned.length} warning(s), ${failed.length} failure(s).`,
  )

  if (failed.length > 0) {
    console.log("")
    console.log("Fix the failed checks before building or releasing on this machine.")
    process.exit(1)
  }
}

checkBun()
checkPackageFiles()
checkGit()
checkPrivateRuntimeConfig()
checkEgoLiteRuntime()
checkApplicationAgentContracts()
printResults()
