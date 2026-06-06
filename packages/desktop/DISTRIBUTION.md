# Terra-Edu Application Agent macOS Distribution

本子程序不需要上架 Mac App Store。当前只维护免费客户分发版。

## 免费客户分发版

适用场景：

- 创始人自用
- 内部顾问测试
- 小范围客户试用
- 早期收费客户交付

生成方式：

```bash
bun run release:mac
```

兼容旧命令：

```bash
bun run release:mac:free
```

产物：

- `dist/terra-edu-application-agent-mac-arm64.dmg`
- `dist/terra-edu-application-agent-mac-arm64.zip`
- `dist/release-notes/mac-free.md`

## 客户安装提示

这个版本使用 ad-hoc signing，不提交到 Mac App Store。其他 Mac 首次打开时，macOS 可能提示无法验证开发者。

给客户的安装文档里建议写清楚：

1. 打开 DMG，把 `Terra-Edu Application Agent.app` 拖进 `Applications`。
2. 如果 macOS 阻止打开，进入“系统设置 -> 隐私与安全性”。
3. 在安全提示区域选择“仍要打开”。
4. 再次打开应用。

## 升级策略

当前阶段不做自动更新。每次发新版时：

1. 开发侧运行 `bun run release:mac` 生成新的 DMG/ZIP。
2. 把新版 DMG 发给客户。
3. 客户退出旧版 App。
4. 打开新版 DMG，把新的 `Terra-Edu Application Agent.app` 拖进 `Applications` 并覆盖旧版。
5. 再次打开应用。

客户本地申请工作区默认保存在 `~/Documents/Terra-Edu Application Agent/application_workspaces`，覆盖 App 不会删除这些工作区。

## 登录与 AI 额度

客户不需要配置 Supabase 或 API key。App 内置 Terra-Edu 的 Supabase 公共配置，客户只需要使用你创建的顾问账号登录。

额度规则：

- 每个顾问账号默认 200 AI credits。
- 1 AI credit = 10,000 加权 token。
- 加权 token = input tokens + output tokens * 4 + reasoning tokens + cache write tokens。
- 额度用完后，App 会阻止新的 Agent 请求，并提示联系微信 `shilaidong`。

## 验证命令

```bash
codesign -dv --verbose=2 "dist/mac-arm64/Terra-Edu Application Agent.app"
spctl --assess --type execute --verbose=4 "dist/mac-arm64/Terra-Edu Application Agent.app"
```

免费客户分发版预期：

- `codesign` 显示 `Signature=adhoc`
- `spctl` 可能显示 `rejected`

这是免费分发路线的正常现象，不代表应用构建失败。

## 每次发包前必须通过

`bun run release:mac` 已经串好以下检查：

- `verify:application-agent`
- `verify:application-agent:e2e`
- `typecheck`
- production `build`
- macOS `package:mac`

任何一步失败都不要发包。
