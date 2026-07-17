# Terra-Edu Application Agent

Terra-Edu Application Agent 是一个独立的 macOS 桌面申请助理，基于 OpenCode Desktop fork 改造。它面向留学申请顾问：顾问输入学生材料文件夹、学校、项目和申请链接后，软件会让 OpenCode Agent 负责整理材料、生成学生申请档案、研究申请要求、检查缺失项、生成收集清单，并通过内置 ego-lite 浏览器辅助填写申请平台。

这个仓库已经从 Terra-Edu 主项目拆分出来，独立开发、独立构建、独立发布，不依赖 Terra-Edu 主项目的 Next.js dev server。

## 当前版本

- 最新 Release：[Terra-Edu Application Agent v1.0.3](https://github.com/Shilaidong/app_agent/releases/tag/v1.0.3)
- 支持平台：macOS Apple Silicon
- 交付文件：`terra-edu-application-agent-mac-arm64.dmg` 和 `terra-edu-application-agent-mac-arm64.zip`
- 构建方式：GitHub Actions 只构建 macOS arm64
- 签名方式：免费 ad-hoc signing，不做 Apple notarization，不上架 Mac App Store

第一次在新 Mac 打开时，macOS 可能提示无法验证开发者。右键打开，或在“系统设置 -> 隐私与安全性”里允许打开即可。

## 软件能做什么

- 新建或读取申请任务
- 把原始学生材料复制到隔离工作区，避免修改原始文件
- 自动分类身份、学术、语言、文书、推荐、财务等材料
- 生成 `student_profile.md` 学生申请档案
- 研究学校和项目的官方申请要求
- 生成 `missing_items.json`、信息收集表、材料收集表和 Word 缺失材料清单
- 使用 OpenCode Agent + Skills + Custom Tools 推进申请流程
- 使用内置 ego-lite 浏览器辅助网页登录、填表、上传和保存草稿
- 保存申请进度、日志、截图和阶段总结

安全边界保持不变：Agent 可以填写、上传、保存草稿，但不能自动最终提交申请、付款、发送不可逆推荐信邀请、保存明文密码，或瞎填没有依据的字段。

## 重要文档

- [APPLICATION_AGENT_LOGIC.md](./APPLICATION_AGENT_LOGIC.md)：完整软件逻辑、Agent 语言、工作流、CUA 规则和安全边界，适合产品重构或让别的 Agent 复刻。
- [DEVELOPMENT.md](./DEVELOPMENT.md)：新电脑接手开发、Git LFS、Bun、ego-lite、构建和发版流程。
- [packages/desktop/README.md](./packages/desktop/README.md)：桌面端开发和 macOS 客户交付说明。

## 新电脑开发

本仓库使用 Bun `1.3.14`，并通过 Git LFS 跟踪随包 ego-lite 浏览器。新电脑克隆后先执行：

```bash
git clone https://github.com/Shilaidong/app_agent.git
cd app_agent
git lfs install
git lfs pull
bun install
bun run doctor
```

`bun run doctor` 会检查 Bun、Git LFS、私有运行配置、Supabase 登录配置、内置 OpenCode Go key、随包 ego-lite 和 macOS 打包资源。

## 常用命令

启动桌面开发版：

```bash
bun run dev
```

运行验证：

```bash
bun run verify
bun run verify:e2e
bun run typecheck:desktop
```

本地生成 macOS 客户安装包：

```bash
bun run release:mac
```

产物位置：

```text
packages/desktop/dist/
```

## 发版方式

当前发版由 GitHub Actions 自动完成。推送 `v*` tag 后，云端会自动：

1. 拉取 Git LFS 里的 ego-lite。
2. 安装 Bun 依赖。
3. 运行申请 Agent 验证、E2E 验证和桌面端类型检查。
4. 生成 macOS DMG/ZIP。
5. 上传到对应 GitHub Release。

示例：

```bash
git tag -a v1.0.4 -m "Terra-Edu Application Agent v1.0.4"
git push origin v1.0.4
```

Release 页面：

```text
https://github.com/Shilaidong/app_agent/releases
```

## 内置运行配置

为了让客户“点开即用”，当前 direct-distribution build 会把必要运行配置一起打进桌面包，包括：

- Supabase 登录和 AI 额度所需的 public config
- 默认 OpenCode Go 模型路由
- 随包 ego-lite 浏览器
- 申请 Agent 的 Prompt、Skills、Commands 和 Custom Tools

因此这个仓库应作为 private repo 维护。不要把它公开镜像；如果要开源，需要先移除或替换私有运行配置，并重新设计授权和 AI key 管理。

## 运行数据

用户申请工作区创建在：

```text
~/Documents/Terra-Edu Application Agent/application_workspaces/
```

每个任务都会创建独立目录，包含原始材料备份、分类材料、生成文件、状态文件、日志、截图和补充材料。卸载或覆盖安装 App 不会自动删除这些工作区。

## ego-lite 浏览器

当前版本内置并固定 ego-lite `0.4.4.15`，保留 Citro 官方签名，同时禁用自动替换和自动更新。这样既使用已验证的新版本能力，也避免浏览器身份变化造成登录态、钥匙串权限或填表行为漂移。

开发时请不要让 Agent 或用户自动安装新版 ego-lite，也不要把系统浏览器临时替换进来。升级浏览器应作为单独版本变更测试。

## 平台范围

当前只维护 macOS Apple Silicon。Windows 构建已从 CI 移除，仓库里继承自 OpenCode 的 Windows/Linux 脚本不代表当前产品支持这些平台。
