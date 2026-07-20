import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  return readFile(path, "utf8")
    .then((contents) => JSON.parse(contents) as T)
    .catch(() => fallback)
}

export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

/** Write via a temp file + rename so readers never observe a partially written file. */
export async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(temporaryPath, path).catch(async (error) => {
    await rm(temporaryPath, { force: true })
    throw error
  })
}
