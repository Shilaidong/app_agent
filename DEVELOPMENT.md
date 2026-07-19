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

当前版本把官方签名的 ego-lite `0.4.4.15` 打包进桌面 app，OpenCode 工作区通过下面这个 wrapper 调用它：

```text
.opencode/bin/ego-browser
```

开发和 Agent prompt 都应该使用：

```bash
PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'
...
EOF
```

`packages/desktop/resources/ego-runtime.lock.json` 是随包 Ego runtime 的唯一锁源。它固定 Info.plist 版本和 bundle identity、Citro team/签名/CDHash、Framework `Versions/Current`、`ego-browser` helper SHA256，以及 Current framework 官方 Skill 的正文 SHA256、元数据版本和日期。工作区只能从这一份 Current Skill 生成；仓库不再维护第二份改写副本。`terraPolicyRevision` 用于标识 Terra 在官方 Skill 旁边追加的浏览器可靠性策略版本。

开发、接手或发版前可单独验证：

```bash
bun run --cwd packages/desktop verify:ego-runtime
```

`bun run doctor` 和最终 App/ZIP/DMG 包验证也会使用同一个 lock，检查 `Info.plist`、`Versions/Current`、Current 官方 Skill、精确 hash 和官方代码签名。官方签名包中的 updater payload 会保留，但所有 updater 文件都必须不可执行；不要通过删除签名资源来关闭更新。

不要让 Agent 或用户自动安装、自动更新、替换公共网站上的 ego-lite。这个项目依赖固定版本的行为，随意升级可能导致浏览器填写策略变化。

只有仓库 owner 完成人工来源、签名和行为复核，并已在本地替换 vendor app 后，才能从这个本地副本刷新 lock：

```bash
bun run --cwd packages/desktop update:ego-runtime-lock:owner --accept-reviewed-local-vendor
```

这个命令不会联网、下载或升级 Ego，也不会接受 bundle、签名 team 或签名 authority 的变化；它只读取已经 vendored 的本地 app，解析官方 Skill frontmatter，重新计算 hash，并在完整验证通过后写 lock。

## GitHub Release 流程

当前发版由 GitHub Actions 完成，不再从本机手动上传 DMG/ZIP。常规发版流程：

```bash
bun run doctor
bun run release:mac
git status --short
```

确认本地包能打出来、当前提交已经推到 `main` 后，创建并推送版本 tag：

```bash
git tag -a v1.0.x -m "Terra-Edu Application Agent v1.0.x"
git push origin v1.0.x
```

`build-desktop` workflow 会在 GitHub 上自动拉取 Git LFS、安装依赖、运行验证、构建 macOS arm64 DMG/ZIP，并上传到对应 GitHub Release。

Release 页面：

```text
https://github.com/Shilaidong/app_agent/releases
```

当前只维护 macOS Apple Silicon Release。Windows 构建已经从 CI 移除。

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
