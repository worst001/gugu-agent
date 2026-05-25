# Phase 4：CI 双平台构建

本阶段目标是把 Windows / macOS 桌面端打包放进 CI 流水线，减少两台电脑来回拉代码、打包、传文件的人工步骤。

## Workflow

新增 workflow：

```text
.github/workflows/release-desktop.yml
```

包含三个 job：

- `build-windows`：在 Windows runner 上构建 `Gugu-Agent-<version>-windows-x64.msi`。
- `build-macos`：在 macOS Apple Silicon runner 上构建 `Gugu-Agent-<version>-aarch64.dmg`。
- `publish`：下载两个平台产物，合并 updater `latest.json`，再上传 OSS 和发布 Gitee Release。

## 触发方式

### 手动构建

在 GitHub Actions 页面手动运行 `Desktop Release`：

- `publish=false`：只构建并保存 CI artifacts，不上传 OSS/Gitee。
- `publish=true`：构建完成后同时发布到 OSS 和 Gitee。
- `require_updater=true`：要求生成完整热更新产物。

### Tag 发布

推送 `v*.*.*` tag 会自动触发完整发布：

```bash
git push origin v0.1.15
```

tag 发布默认要求 `TAURI_SIGNING_PRIVATE_KEY`，否则构建会失败，避免忘记生成热更新产物。

## CI Secrets

发布相关密钥只放 CI Secrets，不进仓库。

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
GUGU_OSS_ACCESS_KEY_ID
GUGU_OSS_ACCESS_KEY_SECRET
GUGU_OSS_BUCKET
GUGU_OSS_ENDPOINT
GUGU_OSS_PUBLIC_BASE_URL
GUGU_GITEE_ACCESS_TOKEN
```

可选 CI Variables：

```text
GUGU_GITEE_OWNER=xiyouwangluo
GUGU_GITEE_REPO=claude-code-gugu
```

## 发布产物

Windows job 上传：

```text
desktop/build-artifacts/windows-x64/*
```

macOS job 上传：

```text
desktop/build-artifacts/macos-arm64/*
```

publish job 会基于这些产物运行：

```bash
cd desktop && bun run release:updater-manifest
bun run release:desktop:oss -- --require-updater --publish
bun run release:desktop:gitee -- --publish
```

## 当前边界

- 这条 workflow 适合 GitHub Actions 或 GitHub 镜像仓库；如果只使用 Gitee，需要确认 Gitee Go 是否能提供稳定的 Windows runner 和 macOS Apple Silicon runner。
- 当前仍未接入正式 Windows 代码签名和 Apple Developer 公证。
- `publish` job 会直接覆盖 OSS latest 别名，并替换 Gitee Release 中同名 MSI/DMG 附件。
- 如果 CI runner 环境缺系统依赖，先以手动 `publish=false` 跑一次构建验证，再开启 tag 自动发布。
