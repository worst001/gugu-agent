# Phase 3：Gitee Release 自动化

本阶段目标是把 Gitee Release 的创建、正文更新和安装包附件上传脚本化，减少手工写 Release Markdown、上传 MSI/DMG、复制 SHA256 的成本。

## 命令

预览发布计划：

```bash
bun run release:desktop:gitee
```

确认无误后真实发布：

```bash
bun run release:desktop:gitee -- --publish
```

指定版本：

```bash
bun run release:desktop:gitee -- --version 0.1.15 --publish
```

## 环境变量

真实发布只从环境变量读取 Gitee 私人令牌，不写入仓库。

```bash
GUGU_GITEE_ACCESS_TOKEN=...
```

可选：

```bash
GUGU_GITEE_OWNER=xiyouwangluo
GUGU_GITEE_REPO=claude-code-gugu
```

如果没有配置 owner/repo，脚本会优先从 `origin` remote 解析，解析不到时回退到 `xiyouwangluo/claude-code-gugu`。

## 默认行为

脚本会校验 `desktop/src-tauri/tauri.conf.json` 版本与产物文件名一致，然后：

- 读取 `release-notes/v<version>.md`。
- 读取 `desktop/build-artifacts/release.json` 中的 OSS 下载链接和 SHA256。
- 生成 `desktop/build-artifacts/gitee-release-body.md` 作为最终 Release 正文预览。
- 创建或更新 Gitee Release `v<version>`。
- 上传 `Gugu-Agent-<version>-windows-x64.msi`。
- 上传 `Gugu-Agent-<version>-aarch64.dmg`。

同一个 tag 已经存在时，脚本会更新 Release 正文；同名附件已经存在时，默认先删除旧附件再上传新附件，方便重复执行。

## 常用选项

```bash
# 只更新 Release 正文，不上传附件
bun run release:desktop:gitee -- --skip-assets --publish

# 允许只存在一个平台的安装包
bun run release:desktop:gitee -- --allow-partial --publish

# 保留 Gitee 上已有同名附件，不替换
bun run release:desktop:gitee -- --keep-existing-assets --publish

# 上传额外附件
bun run release:desktop:gitee -- --asset desktop/build-artifacts/latest.json --publish
```

## 安全策略

- 默认 dry-run，不会访问 Gitee。
- `--publish` 才会调用 Gitee API。
- 私人令牌只放环境变量或本地 ignored 脚本。
- 脚本不会打印 token。
- 可重复执行，适合发布时网络抖动后补传。

## 当前边界

Phase 3 只解决 Gitee Release 自动化，不自动双平台构建。Windows/macOS 构建仍沿用当前本地流程，Phase 4 再迁移到 CI。
