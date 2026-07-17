#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
const modelsDevApiJson = new URL("../../opencode/test/tool/fixtures/models-api.json", import.meta.url).pathname

await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`
await $`bun ./scripts/write-supabase-public-config.ts`
await $`bun ./scripts/bundle-ripgrep.ts`
await $`bun ./scripts/build-terra-dialog-guard.ts`
await $`bun ./scripts/build-terra-paddleocr.ts`

await $`cd ../opencode && MODELS_DEV_API_JSON=${modelsDevApiJson} bun script/build-node.ts`
