import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createStudentWorkspace,
  discoverApplicationTaskWorkspaces,
  studentWorkspaceLayout,
} from "./application-student-workspace"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("student application workspace", () => {
  test("creates one shared dossier and a schools container", async () => {
    const root = await temporaryDirectory()
    const layout = await createStudentWorkspace(join(root, "国凯迪-申请批次"))

    expect(layout).toEqual(studentWorkspaceLayout(join(root, "国凯迪-申请批次")))
    expect(await directories(layout.sharedWorkspacePath)).toEqual([
      "00_original_backup",
      "01_classified_materials",
      "02_generated",
      "03_state",
    ])
    expect(await directories(layout.sharedClassifiedPath)).toContain("academic")
    expect(await directories(layout.workspacePath)).toContain("schools")
  })

  test("discovers old flat tasks and new nested school tasks without entering shared materials", async () => {
    const root = await temporaryDirectory()
    const legacy = join(root, "legacy-school")
    const student = await createStudentWorkspace(join(root, "student-batch"))
    const firstSchool = join(student.schoolsPath, "01-hku-macct")
    const secondSchool = join(student.schoolsPath, "02-cuhk-macc")
    const decoy = join(student.sharedWorkspacePath, "copied-task")

    await Promise.all([
      taskState(legacy),
      taskState(firstSchool),
      taskState(secondSchool),
      taskState(decoy),
    ])

    expect((await discoverApplicationTaskWorkspaces(root)).sort()).toEqual(
      [legacy, firstSchool, secondSchool].sort(),
    )
  })
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "terra-student-workspace-"))
  temporaryDirectories.push(directory)
  return directory
}

async function directories(path: string) {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

async function taskState(workspacePath: string) {
  await mkdir(join(workspacePath, "03_state"), { recursive: true })
  await writeFile(join(workspacePath, "03_state", "task_state.json"), "{}\n", "utf8")
}
