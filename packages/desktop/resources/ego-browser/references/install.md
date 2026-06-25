# Terra-Edu bundled ego lite

Read this file only when the Terra-Edu wrapper reports a browser-runtime problem. For day-to-day browser work, go back to `SKILL.md`.

## Terra-Edu pinned-build policy

This Terra-Edu Application Agent build uses a pinned ego-browser skill snapshot and a pinned ego lite browser bundled inside the app. Do not replace this skill with a newer ego lite skill and do not update ego lite automatically.

The bundled install script is locked by default:

- Normal advisor builds do not need a public ego lite install.
- Browser operations must go through `.opencode/bin/ego-browser`, which points to the Terra-Edu bundled app.
- The fallback install script will not download, replace, or upgrade ego lite unless the owner explicitly runs it with `TERRA_EGO_BROWSER_ALLOW_INSTALL=1`.

This protects the private build from unexpected upstream behavior or pricing changes.

The ego-browser skill depends on the ego lite browser: in Terra-Edu builds, the `ego-browser` command is provided by the workspace wrapper and the browser app is packaged as an application resource.

ego lite website: https://lite.ego.app/

## Normal Terra-Edu runtime

For Terra-Edu builds, confirm the workspace wrapper is ready. Do not check or use the system `ego-browser`:

```bash
test -x .opencode/bin/ego-browser
```

Verify the runtime with the pinned wrapper:

```bash
PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'
cliLog('Terra-Edu bundled ego-browser ready')
EOF
```

Printing `Terra-Edu bundled ego-browser ready` means the environment is ready.

If the wrapper reports a missing browser, version mismatch, update feed, or updater helper, stop and ask the owner for a new Terra-Edu Application Agent build. Do not install or upgrade ego lite from the public website.

## Owner-only fallback install

The fallback install script lives at `scripts/install.sh` and supports macOS only. It is not part of the normal advisor flow.

Run the script only after the owner has explicitly approved installing ego lite outside the packaged build. The locked default command opens an existing install if present and refuses network installation:

```bash
sh skills/ego-browser/scripts/install.sh
```

To allow a first-time public install, the owner must run:

```bash
TERRA_EGO_BROWSER_ALLOW_INSTALL=1 sh skills/ego-browser/scripts/install.sh
```

Do not use this fallback for customer builds unless Terra-Edu intentionally releases a new browser baseline.

## After that, return to the original task

Once the environment is ready, return to the user's original task and continue with the task space flow in `SKILL.md` — start from `useOrCreateTaskSpace(name)` and proceed as usual.

## Troubleshooting

- **Not macOS**: the Terra-Edu bundled ego lite runtime currently supports macOS only.
- **Wrapper reports a version/update error**: use a new Terra-Edu Application Agent build. Do not repair it by installing a public ego lite update.
- **Gatekeeper still blocks it**: ask the owner for a newly signed Terra-Edu build.
- **Wrapper unavailable**: reopen the task from Terra-Edu Application Agent so it regenerates `.opencode/bin/ego-browser`; if it is still missing, ask the owner for a new build.
