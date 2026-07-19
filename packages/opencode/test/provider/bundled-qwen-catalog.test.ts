import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "../../src/provider/provider"

const catalogPath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")

test("vendored catalog resolves qwen3.7-plus with image attachments", async () => {
  const catalog = (await Bun.file(catalogPath).json()) as Record<string, unknown>
  const provider = Schema.decodeUnknownSync(ModelsDev.Provider)(catalog["opencode-go"])
  const model = Provider.fromModelsDevProvider(provider).models["qwen3.7-plus"]

  expect(model.api.npm).toBe("@ai-sdk/anthropic")
  expect(model.capabilities.attachment).toBe(true)
  expect(model.capabilities.input).toEqual({
    text: true,
    audio: false,
    image: true,
    video: true,
    pdf: false,
  })
  expect(model.limit).toEqual({ context: 1_000_000, input: undefined, output: 65_536 })
})

test("compiled catalog snapshot resolves qwen3.7-plus with an empty cache", async () => {
  const temp = await mkdtemp(path.join(import.meta.dir, ".terra-qwen-catalog-"))
  const entry = path.join(temp, "entry.ts")
  const outdir = path.join(temp, "dist")
  await Bun.write(
    entry,
    [
      'import { Effect } from "effect"',
      `import * as ModelsDev from ${JSON.stringify(path.join(import.meta.dir, "../../../core/src/models-dev.ts"))}`,
      "const catalog = await Effect.runPromise(ModelsDev.Service.use((service) => service.get()).pipe(Effect.provide(ModelsDev.defaultLayer)))",
      'const model = catalog["opencode-go"]?.models["qwen3.7-plus"]',
      "console.log(JSON.stringify(model))",
    ].join("\n"),
  )

  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "bun",
    define: {
      OPENCODE_MODELS_DEV: await Bun.file(catalogPath).text(),
    },
  })
  expect(result.success).toBe(true)

  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    XDG_CACHE_HOME: path.join(temp, "empty-cache"),
    XDG_CONFIG_HOME: path.join(temp, "empty-config"),
    XDG_DATA_HOME: path.join(temp, "empty-data"),
    OPENCODE_DISABLE_MODELS_FETCH: "true",
  }
  delete childEnv.OPENCODE_MODELS_PATH
  delete childEnv.OPENCODE_MODELS_URL
  const child = Bun.spawn([process.execPath, path.join(outdir, "entry.js")], {
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  const exitCode = await child.exited
  await rm(temp, { recursive: true, force: true })

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  expect(JSON.parse(stdout)).toMatchObject({
    id: "qwen3.7-plus",
    description: "Multimodal reasoning model for visual analysis, planning, and tool use",
    attachment: true,
    modalities: { input: ["text", "image", "video"], output: ["text"] },
  })
})
