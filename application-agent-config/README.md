# Terra-Edu Application Agent Config

This directory documents the application-agent OpenCode configuration contract.
At runtime, every created application workspace receives its own `.opencode/`
folder containing:

- `opencode.json`
- `agents/application-agent.md`
- `prompts/application-agent.md`
- `skills/*/SKILL.md`
- `commands/*.md`
- `tools/*.ts`

The generated config follows the two product documents in `docs/`:

- `当前产品子程序：申请 Agent 产品规划文档.md`
- `当前产品子程序：申请 Agent 技术路线文档.md`

Runtime workspaces are created under:

`~/Documents/Terra-Edu Application Agent/application_workspaces/`

The original student folder is copied into `00_original_backup/` and is never
modified directly.
