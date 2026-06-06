# Terra-Edu Application Agent

This is an independent Terra-Edu subprogram based on OpenCode Desktop `v1.15.5`
(`d7a6e1daaf2271bcd0b611fbb27d4956806e475a`).

It intentionally does not connect to the Terra-Edu root Next.js app, Supabase,
CRM, login, or permission system.

## Run

```bash
bun install
bun --cwd packages/desktop dev
```

## Build

```bash
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop build
bun --cwd packages/desktop package:mac
```

## Runtime Data

Application task workspaces are created under:

```text
~/Documents/Terra-Edu Application Agent/application_workspaces/
```

Each task creates:

```text
00_original_backup/
01_classified_materials/
02_generated/
03_state/
04_logs/
05_screenshots/
06_new_materials/
.opencode/
```

Original student folders are copied into `00_original_backup/`; the Agent works
on the copy and must not modify the original folder.

## Safety Boundary

The Agent may fill, upload, and save application progress, but it must not:

- click final submit
- pay fees
- send irreversible recommendation invitations
- save account passwords
- guess uncertain application fields
