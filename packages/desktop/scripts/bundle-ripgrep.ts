import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const version = "15.1.0"
const platform = process.arch === "arm64" ? "aarch64-apple-darwin" : process.arch === "x64" ? "x86_64-apple-darwin" : ""

if (!platform) throw new Error(`Unsupported macOS architecture for bundled ripgrep: ${process.arch}`)

const archiveName = `ripgrep-${version}-${platform}.tar.gz`
const target = path.resolve("resources/vendor/ripgrep/rg")

if (await Bun.file(target).exists()) process.exit(0)

const response = await fetch(`https://github.com/BurntSushi/ripgrep/releases/download/${version}/${archiveName}`)
if (!response.ok) throw new Error(`Failed to download bundled ripgrep: ${response.status} ${response.statusText}`)

const dir = await mkdtemp(path.join(tmpdir(), "terra-edu-ripgrep-"))
const archive = path.join(dir, archiveName)
await Bun.write(archive, await response.arrayBuffer())

const extraction = Bun.spawn(["tar", "-xzf", archive, "-C", dir])
if ((await extraction.exited) !== 0) throw new Error("Failed to extract bundled ripgrep")

await mkdir(path.dirname(target), { recursive: true })
await copyFile(path.join(dir, `ripgrep-${version}-${platform}`, "rg"), target)
await chmod(target, 0o755)
await rm(dir, { recursive: true, force: true })
