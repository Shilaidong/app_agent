# Terra-Edu Application Agent

Terra-Edu Application Agent is a standalone desktop subprogram forked from OpenCode Desktop. It helps consultants organize student materials, generate application profiles and missing-item checklists, and assist with application-platform form filling through CUA.

This repository is intentionally separate from the Terra-Edu main project. It does not require the Terra-Edu Next.js dev server to run or build.

## Requirements

- Bun `1.3.14`
- macOS for local macOS packaging
- Windows or a Windows CI runner for Windows packaging
- Optional local CUA runtime for browser form automation testing

## Setup

```bash
bun install
```

For Supabase login/quota support in fresh clones, create `.env.local` at the repository root:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Local private build files live under `packages/desktop/resources/private/` and are git-ignored.

## Development

```bash
bun run dev
```

## Verification

```bash
bun run verify
bun run verify:e2e
bun run typecheck:desktop
```

## Build Current Desktop Versions

macOS customer build:

```bash
bun run release:mac
```

Windows package:

```bash
bun run build:desktop
bun run package:win
```

Artifacts are written to:

```text
packages/desktop/dist/
```

## Runtime Data

Application workspaces are created under:

```text
~/Documents/Terra-Edu Application Agent/application_workspaces/
```

Each task keeps original materials copied into `00_original_backup/`; the Agent works inside the isolated application workspace.

## Safety Boundary

The Agent may fill, upload, and save application progress, but must not automatically:

- final-submit applications
- pay fees
- send irreversible recommendation invitations
- write account passwords into files, logs, or chat
- guess uncertain fields
