import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`
await $`bun ./scripts/write-supabase-public-config.ts`
await $`bun ./scripts/bundle-ripgrep.ts`
await $`bun ./scripts/build-terra-paddleocr.ts`

await $`cd ../opencode && bun script/build-node.ts`
