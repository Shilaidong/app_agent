# Terra-Edu Application Agent

这是 Terra-Edu 申请 Agent 的中文 README。当前仓库首页说明以 [README.md](./README.md) 为准。

## 当前状态

- 最新版本：[v1.0.14](https://github.com/Shilaidong/app_agent/releases/tag/v1.0.14)
- 支持平台：macOS Apple Silicon
- 交付文件：DMG / ZIP
- 自动构建：GitHub Actions 仅构建 macOS arm64
- 浏览器自动化：内置并锁定官方签名 ego-lite `0.4.4.15`；updater payload 保留但不可执行
- 模型和登录：随包配置 Supabase 登录、AI 额度和默认 OpenCode Go 路由

## 快速开始

```bash
git clone https://github.com/Shilaidong/app_agent.git
cd app_agent
git lfs install
git lfs pull
bun install
bun run doctor
bun run dev
```

## 常用文档

- [README.md](./README.md)：项目首页说明
- [APPLICATION_AGENT_LOGIC.md](./APPLICATION_AGENT_LOGIC.md)：完整产品逻辑和 Agent 工作方式
- [DEVELOPMENT.md](./DEVELOPMENT.md)：新电脑开发、打包和发版说明
- [packages/desktop/README.md](./packages/desktop/README.md)：桌面端说明

## 发版

推送 `v*` tag 后，GitHub Actions 会自动构建 macOS DMG/ZIP 并上传到 GitHub Release。

```bash
git tag -a v1.0.4 -m "Terra-Edu Application Agent v1.0.4"
git push origin v1.0.4
```

Release 页面：

```text
https://github.com/Shilaidong/app_agent/releases
```
