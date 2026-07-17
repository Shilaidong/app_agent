import { execFile } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

function walkFiles(base: string): string[] {
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(base, entry.name)
    if (entry.isDirectory()) return walkFiles(full)
    if (entry.isFile()) return [full]
    return []
  })
}

function isExecutableCode(file: string) {
  const stat = statSync(file)
  const basename = path.basename(file)
  return (
    (stat.mode & 0o111) !== 0 ||
    basename.includes(".dylib") ||
    basename.endsWith(".so") ||
    basename.endsWith(".node") ||
    basename === "ego Framework"
  )
}

async function adHocSign(target: string, options: string[] = []) {
  await execFileAsync("codesign", ["--sign", "-", "--force", "--timestamp=none", ...options, target])
}

async function signBundledTerraTools(app: string) {
  if (process.platform !== "darwin") return

  const resources = path.join(app, "Contents/Resources/vendor")
  for (const target of [path.join(resources, "ripgrep/rg"), path.join(resources, "terra-dialog-guard/terra-dialog-guard")]) {
    if (!existsSync(target)) throw new Error(`Missing bundled Terra-Edu tool: ${target}`)
    await adHocSign(target)
  }
  const paddleOcr = path.join(resources, "terra-paddleocr")
  const files = walkFiles(paddleOcr)
    .filter(isExecutableCode)
    .sort((a, b) => b.length - a.length)
  if (files.length === 0) throw new Error(`Missing bundled Terra-Edu PaddleOCR tool: ${paddleOcr}`)
  for (const file of files) await adHocSign(file)
}

async function signTerraRuntimeCode(app: string) {
  const frameworks = path.join(app, "Contents/Frameworks")
  if (!existsSync(frameworks)) throw new Error(`Missing Electron runtime frameworks: ${frameworks}`)

  const targets = readdirSync(frameworks, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (entry.name.endsWith(".app") || entry.name.endsWith(".framework") || entry.name.endsWith(".xpc")))
    .map((entry) => path.join(frameworks, entry.name))
    .sort()

  for (const target of targets) await adHocSign(target)
}

async function signMacApplication(configuration: { app: string }) {
  if (process.platform !== "darwin") return

  await signBundledTerraTools(configuration.app)
  await signTerraRuntimeCode(configuration.app)
  // The bundled Ego Lite runtime keeps Citro's notarized signature so macOS
  // recognises its existing encrypted browser storage. Deep-signing would
  // replace that identity and trigger a Keychain access prompt.
  await adHocSign(configuration.app, [
    "--options",
    "runtime",
    "--entitlements",
    path.join(rootDir, "packages/desktop/resources/entitlements.plist"),
  ])
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const macTarget = process.env.TERRA_EDU_MAC_TARGET === "zip" ? ["zip"] : ["dmg", "zip"]

const getBase = (): Configuration => ({
  artifactName: "terra-edu-application-agent-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*", "!resources/vendor/**"],
  extraResources: [
    {
      from: "resources/private/",
      to: "private/",
      filter: ["opencode-go-key.txt", "supabase-public.json"],
    },
    {
      from: "resources/vendor/ripgrep/",
      to: "vendor/ripgrep/",
      filter: ["rg"],
    },
    {
      from: "resources/vendor/terra-dialog-guard/",
      to: "vendor/terra-dialog-guard/",
      filter: ["terra-dialog-guard"],
    },
    {
      from: "resources/vendor/terra-paddleocr/",
      to: "vendor/terra-paddleocr/",
      filter: ["**/*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    extraResources: [
      {
        from: "resources/vendor/ego-lite/",
        to: "vendor/ego-lite/",
        filter: ["ego lite.app/**"],
      },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: false,
    sign: signMacApplication,
    target: macTarget,
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Terra-Edu Application Agent",
    schemes: ["terra-application-agent"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "edu.terra.application-agent.dev",
        productName: "Terra-Edu Application Agent Dev",
        rpm: { packageName: "terra-edu-application-agent-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "edu.terra.application-agent.beta",
        productName: "Terra-Edu Application Agent Beta",
        protocols: { name: "Terra-Edu Application Agent Beta", schemes: ["terra-application-agent"] },
        rpm: { packageName: "terra-edu-application-agent-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "edu.terra.application-agent",
        productName: "Terra-Edu Application Agent",
        protocols: { name: "Terra-Edu Application Agent", schemes: ["terra-application-agent"] },
        rpm: { packageName: "terra-edu-application-agent" },
      }
    }
  }
}

export default getConfig()
