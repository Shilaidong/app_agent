# Terra-Edu Application Agent Development Handoff

这份文档用于把项目搬到另一台电脑继续开发、构建和发版。它假设你要维护的是当前独立仓库：

```text
https://github.com/Shilaidong/app_agent
```

当前 GitHub 默认分支是 `main`，`main` 应该始终代表可以继续开发和打包的最新状态。

## 新电脑首次准备

1. 安装 Git、Git LFS 和 Bun。

   本仓库固定使用 Bun `1.3.14`，见根目录 `package.json` 的 `packageManager` 字段。版本不一致时通常也能装依赖，但桌面构建和 OpenCode fork 相关脚本更容易出现细碎差异。

2. 克隆仓库并拉取 LFS 文件。

   ```bash
   git clone https://github.com/Shilaidong/app_agent.git
   cd app_agent
   git lfs install
   git lfs pull
   ```

3. 确认随包浏览器已拉完整。

   ```bash
   du -sh "packages/desktop/resources/vendor/ego-lite/ego lite.app"
   ```

   正常应约为 `365M`。如果只有很小的体积，说明 Git LFS 没有把大文件拉下来，重新运行 `git lfs pull`。

4. 安装依赖。

   ```bash
   bun install
   ```

5. 运行开发环境检查。

   ```bash
   bun run doctor
   ```

   这个命令会检查 Bun 版本、Git LFS、私有运行配置、随包 ego-lite、OpenCode wrapper 和 macOS 打包资源。

## 日常开发命令

启动桌面开发版：

```bash
bun run dev
```

运行申请 Agent 契约验证：

```bash
bun run verify
```

运行已有工作区 E2E 验证：

```bash
bun run verify:e2e
```

运行桌面端类型检查：

```bash
bun run typecheck:desktop
```

打 macOS 客户分发包：

```bash
bun run release:mac
```

构建产物会出现在：

```text
packages/desktop/dist/
```

## 这个仓库故意提交了什么

为了让客户和新开发电脑“开箱即用”，以下内容是有意提交的：

- `packages/desktop/resources/private/opencode-go-key.txt`
- `packages/desktop/resources/private/supabase-public.json`
- `packages/desktop/resources/vendor/ego-lite/ego lite.app`

这意味着当前仓库应当作为 private repo 维护。不要把它镜像到公开仓库；如果必须公开，需要先替换或移除私有运行配置，并重新设计 AI key / Supabase 授权方式。

## 不要提交什么

这些内容应该保持本地化：

- `node_modules/`
- `packages/desktop/out/`
- `packages/desktop/dist/`
- `~/Documents/Terra-Edu Application Agent/application_workspaces/`
- 顾问或学生真实申请材料
- 本机调试日志、截图、临时 OCR 文件

`packages/desktop/dist/` 里的 DMG/ZIP 不进 Git。正式交付时上传到 GitHub Release。

## 随包 ego-lite 规则

当前版本把 ego-lite `0.4.2.15` 打包进桌面 app，OpenCode 工作区通过下面这个 wrapper 调用它：

```text
.opencode/bin/ego-browser
```

开发和 Agent prompt 都应该使用：

```bash
PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'
...
EOF
```

不要让 Agent 或用户自动安装、自动更新、替换公共网站上的 ego-lite。这个项目依赖固定版本的行为，随意升级可能导致浏览器填写策略变化。

## GitHub Release 流程

常规发版流程：

```bash
bun run doctor
bun run release:mac
git status --short
```

确认当前提交已经推到 `main` 后，创建 Release：

```bash
gh release create v1.0.x \
  packages/desktop/dist/terra-edu-application-agent-mac-arm64.dmg \
  packages/desktop/dist/terra-edu-application-agent-mac-arm64.zip \
  --target "$(git rev-parse HEAD)" \
  --title "Terra-Edu Application Agent v1.0.x" \
  --notes-file packages/desktop/dist/release-notes/mac-free.md \
  --latest
```

Release 页面：

```text
https://github.com/Shilaidong/app_agent/releases
```

## 常见问题

### `ego lite.app` 只有几 KB

Git LFS 没有拉取大文件。运行：

```bash
git lfs install
git lfs pull
```

### `bun run doctor` 提示 Bun 版本不一致

把 Bun 切到 `1.3.14` 后再试。这个项目从 OpenCode Desktop fork 而来，Bun 版本差异可能影响打包脚本和依赖解析。

### 在 Codex 沙箱里直接跑 `ego-browser` 提示 bootstrap 连接失败

这通常是当前自动化沙箱不能连接 ego runtime，不等于安装包坏了。真实验证以桌面 app 启动后由 OpenCode 工作区调用 `.opencode/bin/ego-browser` 为准。

### macOS 提示无法验证开发者

当前分发包是 ad-hoc signing，不走 Mac App Store，不做 Apple notarization。客户需要在“系统设置 -> 隐私与安全性”里允许打开。详见 `packages/desktop/DISTRIBUTION.md`。

## 最小交接检查清单

换电脑前，旧电脑确认：

- `git status --short` 为空。
- 最新代码已推到 `origin/main`。
- 需要交付的版本已经创建 GitHub Release。
- `APPLICATION_AGENT_LOGIC.md` 与真实产品逻辑一致。

换电脑后，新电脑确认：

- `git lfs pull` 后随包 ego-lite 约 `365M`。
- `bun install` 成功。
- `bun run doctor` 无失败项。
- `bun run verify`、`bun run verify:e2e`、`bun run typecheck:desktop` 通过。
- `bun run dev` 能打开 Terra-Edu Application Agent。
