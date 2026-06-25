# Terra-Edu Application Agent Desktop

这是 Terra-Edu 申请 Agent 的桌面端。它基于 OpenCode Desktop fork，当前只维护 macOS Apple Silicon 客户版。

## 当前交付形态

- App 名称：Terra-Edu Application Agent
- 最新版本：`1.0.3`
- 发布页：https://github.com/Shilaidong/app_agent/releases
- 安装包：macOS arm64 DMG / ZIP
- 签名：ad-hoc signing
- 公证：暂不做 Apple notarization
- 更新：暂不做自动更新，新版通过 DMG 覆盖安装
- 浏览器：随包 ego-lite `0.4.2.15`

## 开发

新电脑接手时先看根目录 [DEVELOPMENT.md](../../DEVELOPMENT.md)，尤其是 Git LFS、Bun、随包 ego-lite 和私有运行配置。

```bash
git lfs pull
bun install
bun run doctor
bun run dev
```

## 验证

```bash
bun run verify
bun run verify:e2e
bun run typecheck:desktop
```

`release:mac` 会自动运行申请 Agent 契约验证、E2E 验证、类型检查、生产构建和 macOS 打包。

## 本地打 macOS 包

```bash
bun run release:mac
```

输出文件：

```text
packages/desktop/dist/terra-edu-application-agent-mac-arm64.dmg
packages/desktop/dist/terra-edu-application-agent-mac-arm64.zip
packages/desktop/dist/release-notes/mac-free.md
```

第一次在客户 Mac 上打开时，系统可能提示无法验证开发者。让客户右键打开，或在“系统设置 -> 隐私与安全性”里允许打开。

## GitHub Release

正式发版不再从本机手动上传大文件。确认代码已推到 `main` 后，推送版本 tag：

```bash
git tag -a v1.0.4 -m "Terra-Edu Application Agent v1.0.4"
git push origin v1.0.4
```

GitHub Actions 会自动构建 macOS 包并上传到对应 Release。

## 登录、额度和模型

- 客户使用 Terra-Edu 顾问账号登录。
- 每个顾问账号默认 200 AI credits。
- credits 按 OpenCode token usage 折算。
- 额度用完后提示联系微信 `shilaidong`。
- 默认模型路线随包配置，不要求客户自己配置 API key。

## 重要边界

Agent 可以填写、上传、保存草稿，但不能最终提交申请、付款、自动发送不可逆推荐信邀请、保存明文密码，或填写没有证据的不确定字段。

Windows/Linux 脚本来自 OpenCode fork 的历史结构，不代表当前 Terra-Edu Application Agent 支持这些平台。
