# Terra-Edu Application Agent Desktop

Terra-Edu 申请 Agent 的独立 macOS Desktop 子程序，基于 OpenCode Desktop fork 构建。

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

## macOS Customer Delivery

本项目暂不考虑上架 Mac App Store，也暂不考虑付费开发者公证。当前交付方式是免费客户分发版。

### Free Customer Release

适合自用、内部顾问、小范围客户试用和早期收费客户。

```bash
bun run release:mac
```

这会生成正式产品名的 macOS DMG/ZIP：

- `dist/terra-edu-application-agent-mac-arm64.dmg`
- `dist/terra-edu-application-agent-mac-arm64.zip`
- `dist/release-notes/mac-free.md`

限制：这是 ad-hoc signing，不经过 Apple notarization。第一次在其他 Mac 上打开时，macOS Gatekeeper 可能提示无法验证开发者。用户需要按安装文档在系统设置里允许打开。

### Login, AI Credits, And Upgrades

- 客户不配置 Supabase，不配置 API key，只用 Terra-Edu 顾问账号登录。
- 每个顾问账号默认 200 AI credits。
- credits 按 OpenCode 回传 token 折算：`input + output * 4 + reasoning + cache_write`，每 10,000 加权 token 扣 1 credit。
- 额度用完后提示联系微信 `shilaidong`。
- 当前不做自动更新；新版通过 DMG 覆盖安装，客户工作区保存在用户 Documents 目录，不会被覆盖。

### Release Checks

release 命令会先运行：

- `verify:application-agent`
- `verify:application-agent:e2e`
- `typecheck`
- production `build`
- macOS `package:mac`

如果任何一步失败，不应发包。
