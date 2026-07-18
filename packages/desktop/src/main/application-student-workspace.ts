import { existsSync } from "node:fs"
import { mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"

const SHARED_CATEGORIES = [
  "identity",
  "academic",
  "language",
  "essays",
  "recommendation",
  "financial",
  "platform_related",
  "other",
  "needs_review",
]

const DISCOVERY_SKIP = new Set([
  ".opencode",
  "00_original_backup",
  "00_selection_list",
  "00_shared_materials",
  "01_classified_materials",
  "02_generated",
  "03_state",
  "04_logs",
  "05_screenshots",
  "06_new_materials",
  "shared",
])

export function studentWorkspaceLayout(workspacePath: string) {
  const sharedWorkspacePath = join(workspacePath, "shared")
  return {
    workspacePath,
    selectionListPath: join(workspacePath, "00_selection_list"),
    schoolsPath: join(workspacePath, "schools"),
    sharedWorkspacePath,
    sharedMaterialsPath: join(sharedWorkspacePath, "00_original_backup"),
    sharedClassifiedPath: join(sharedWorkspacePath, "01_classified_materials"),
    sharedGeneratedPath: join(sharedWorkspacePath, "02_generated"),
    sharedStatePath: join(sharedWorkspacePath, "03_state"),
    sharedProfilePath: join(sharedWorkspacePath, "02_generated", "student_profile.md"),
    sharedMaterialsIndexPath: join(sharedWorkspacePath, "03_state", "materials_index.json"),
    sharedOcrIndexPath: join(sharedWorkspacePath, "03_state", "ocr_index.json"),
    sharedDossierStatePath: join(sharedWorkspacePath, "03_state", "shared_dossier_state.json"),
  }
}

export async function createStudentWorkspace(workspacePath: string) {
  const layout = studentWorkspaceLayout(workspacePath)
  await Promise.all([
    mkdir(layout.selectionListPath, { recursive: true }),
    mkdir(layout.schoolsPath, { recursive: true }),
    mkdir(layout.sharedMaterialsPath, { recursive: true }),
    mkdir(layout.sharedGeneratedPath, { recursive: true }),
    mkdir(join(layout.sharedStatePath, "extracted_text"), { recursive: true }),
    ...SHARED_CATEGORIES.map((category) => mkdir(join(layout.sharedClassifiedPath, category), { recursive: true })),
  ])
  return layout
}

export async function discoverApplicationTaskWorkspaces(root: string, maxDepth = 3) {
  const workspaces: string[] = []

  async function walk(directory: string, depth: number) {
    if (existsSync(join(directory, "03_state", "task_state.json"))) {
      workspaces.push(directory)
      return
    }
    if (depth === 0) return

    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !DISCOVERY_SKIP.has(entry.name))
        .map((entry) => walk(join(directory, entry.name), depth - 1)),
    )
  }

  await walk(root, maxDepth)
  return workspaces
}
