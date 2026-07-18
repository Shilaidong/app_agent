#!/usr/bin/env bun
import { $ } from "bun"
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mode = "free"
const opencodeDir = join(process.cwd(), "../opencode")
const releaseDir = join(process.cwd(), "dist", "release-notes")
const electronBuilderCache = join(process.cwd(), ".cache", "electron-builder")
const dmg = join(process.cwd(), "dist", "terra-edu-application-agent-mac-arm64.dmg")
const dmgBlockmap = `${dmg}.blockmap`
const zip = join(process.cwd(), "dist", "terra-edu-application-agent-mac-arm64.zip")

console.log("Preparing Terra-Edu Application Agent macOS customer release...")
console.log("Signing/notarization: free ad-hoc build. macOS may ask the customer to manually allow first launch.")

mkdirSync(electronBuilderCache, { recursive: true })

const dmgAvailable = await canCreateDmg()

await $`bun test`
await $`bun test --timeout 30000 test/tool/read.test.ts`.cwd(opencodeDir)
await $`bun typecheck`.cwd(opencodeDir)
await $`bun verify:application-agent`
await $`bun verify:application-agent:e2e`
await $`bun typecheck`
await $`OPENCODE_CHANNEL=prod bun run build`
if (existsSync(dmg)) unlinkSync(dmg)
if (existsSync(dmgBlockmap)) unlinkSync(dmgBlockmap)
await $`ELECTRON_BUILDER_CACHE=${electronBuilderCache} OPENCODE_CHANNEL=prod TERRA_EDU_MAC_TARGET=zip bun run package:mac`
if (dmgAvailable) {
  await createDmgFromVerifiedApp()
}
await $`bun verify:application-agent:package`

mkdirSync(releaseDir, { recursive: true })

const generatedAt = new Date().toISOString()

writeFileSync(
  join(releaseDir, `mac-${mode}.md`),
  [
    "# Terra-Edu Application Agent macOS Release",
    "",
    `Generated at: ${generatedAt}`,
    `Mode: ${mode}`,
    "",
    "## Artifacts",
    "",
    `- DMG: ${dmgAvailable ? dmg : "not generated because hdiutil create is unavailable in this environment"}`,
    `- ZIP: ${zip}`,
    "",
    "## Verification",
    "",
    "- Desktop unit tests, OpenCode read-permission regression tests, static Application Agent contract verification, and deterministic E2E workspace verification passed.",
    "- TypeScript typecheck passed.",
    "- Electron production build passed.",
    dmgAvailable ? "- macOS DMG and ZIP package build passed." : "- macOS ZIP package build passed; DMG build was skipped after hdiutil capability probing failed.",
    "- Final ZIP resources, signatures, bundled ego lite/PaddleOCR, updater suppression, retired guard exclusion, and packaged Ego dialog smoke passed.",
    dmgAvailable
      ? "- Final DMG bundle identity, version, critical resources, deep signatures, and app.asar parity passed after a read-only mount."
      : "- DMG verification was not required for this ZIP-only fallback release.",
    "- Supabase public config was bundled from the Terra-Edu web environment when available.",
    "",
    "## Distribution Notes",
    "",
    "- This is a free customer distribution build with ad-hoc signing.",
    "- macOS Gatekeeper may show a security warning on first launch.",
    "- Customers may need to allow the app in System Settings -> Privacy & Security.",
    "- Customers sign in with Terra-Edu consultant accounts. Each consultant starts with 200 AI credits.",
    "- AI credits are charged from OpenCode token usage: input + output * 4 + reasoning + cache_write, divided by 10,000.",
    "- When credits run out, the app asks the customer to contact WeChat: shilaidong.",
    "- The app is not submitted to the Mac App Store.",
    "- Application materials stay in the local Terra-Edu Application Agent workspace unless the consultant intentionally uploads files through an application portal.",
    "",
  ].join("\n"),
  "utf8",
)

if (!existsSync(zip) || (dmgAvailable && !existsSync(dmg))) {
  throw new Error("Release artifacts were not generated as expected.")
}

console.log("Release complete.")
console.log(`DMG: ${dmgAvailable ? dmg : "not generated because hdiutil create is unavailable in this environment"}`)
console.log(`ZIP: ${zip}`)
console.log(`Notes: ${join(releaseDir, `mac-${mode}.md`)}`)

async function canCreateDmg() {
  if (process.platform !== "darwin") return false

  const probe = join(electronBuilderCache, `dmg-probe-${process.pid}.dmg`)
  const result = await $`hdiutil create -size 1m -fs APFS -volname TerraEduProbe ${probe}`.quiet().nothrow()

  if (existsSync(probe)) unlinkSync(probe)
  if (result.exitCode === 0) return true

  console.warn("DMG creation is unavailable in this environment; falling back to a ZIP-only macOS package.")
  return false
}

async function createDmgFromVerifiedApp() {
  const app = join(process.cwd(), "dist", "mac-arm64", "Terra-Edu Application Agent.app")
  if (!existsSync(app)) throw new Error(`Missing packaged application: ${app}`)

  await $`codesign --verify --deep --strict ${app}`
  const staging = mkdtempSync(join(tmpdir(), "terra-edu-dmg-staging-"))
  const stagedApp = join(staging, "Terra-Edu Application Agent.app")

  try {
    await $`ditto ${app} ${stagedApp}`
    await $`ln -s /Applications ${join(staging, "Applications")}`
    await $`codesign --verify --deep --strict ${stagedApp}`
    await $`hdiutil create -fs APFS -volname ${"Terra-Edu Application Agent"} -srcfolder ${staging} -ov -format UDZO ${dmg}`
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
