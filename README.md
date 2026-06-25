# Terra-Edu Application Agent

Terra-Edu Application Agent is a standalone desktop subprogram forked from OpenCode Desktop. It helps consultants organize student materials, generate application profiles and missing-item checklists, and assist with application-platform form filling through CUA.

This repository is intentionally separate from the Terra-Edu main project. It does not require the Terra-Edu Next.js dev server to run or build.

## Product Logic

The product behavior, Agent language, workflow contract, CUA rules, safety boundaries, and rebuild guidance are documented in [APPLICATION_AGENT_LOGIC.md](./APPLICATION_AGENT_LOGIC.md).

This document is written for humans and other Agents that want to understand, refactor, or recreate the application without depending on implementation details.

## Development Handoff

If you are moving this project to another computer, start with [DEVELOPMENT.md](./DEVELOPMENT.md). It covers cloning with Git LFS, installing Bun, checking the bundled ego-lite runtime, running the app, building packages, and publishing GitHub Releases.

Quick health check after cloning:

```bash
git lfs pull
bun install
bun run doctor
```

## Current Release

Release builds are published on [GitHub Releases](https://github.com/Shilaidong/app_agent/releases).

The current packaged deliverables are:

- macOS Apple Silicon DMG
- macOS Apple Silicon ZIP
- Windows x64 executable artifact
- update helper metadata such as blockmap files when available

## Bundled Runtime Config

This repository is currently set up as a direct-distribution customer build. Runtime config under `packages/desktop/resources/private/` is intentionally committed and bundled into desktop packages so the app opens with Supabase login/quota support and the default OpenCode Go model route already configured.

Do not mirror this repository publicly without rotating or replacing those bundled credentials.

## Requirements

- Bun `1.3.14`
- macOS for local macOS packaging
- Windows or a Windows CI runner for Windows packaging
- Optional local CUA runtime for browser form automation testing

## Setup

```bash
git lfs pull
bun install
bun run doctor
```

For Supabase login/quota support in custom clones, create `.env.local` at the repository root if you need to replace the bundled direct-distribution config:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Direct-distribution private runtime files live under `packages/desktop/resources/private/` and are intentionally tracked for the current customer-ready build.

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
