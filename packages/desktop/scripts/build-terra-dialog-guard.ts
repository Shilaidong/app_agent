import { existsSync } from "node:fs"
import { chmod, mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

if (process.platform !== "darwin") throw new Error("The Terra-Edu native dialog guard is built only for macOS packages.")

const source = path.resolve("native/terra-dialog-guard.swift")
const targetDirectory = path.resolve("resources/vendor/terra-dialog-guard")
const target = path.join(targetDirectory, "terra-dialog-guard")
const staged = path.join(targetDirectory, `.terra-dialog-guard-${process.pid}`)
const architecture = process.arch === "x64" ? "x86_64" : "arm64"

if (!existsSync(source)) throw new Error(`Missing Terra-Edu native dialog guard source: ${source}`)

await mkdir(targetDirectory, { recursive: true })
await rm(staged, { force: true })
const child = Bun.spawn(
  ["xcrun", "swiftc", "-target", `${architecture}-apple-macos12.0`, "-O", "-whole-module-optimization", source, "-o", staged],
  { cwd: path.resolve("."), stdout: "inherit", stderr: "inherit" },
)
if ((await child.exited) !== 0) throw new Error("Compiling the Terra-Edu native dialog guard failed.")
await chmod(staged, 0o755)
await rename(staged, target)

