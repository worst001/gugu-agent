# Phase 5：热更新正规化

本阶段目标是让桌面端发布不再只上传 MSI/DMG，而是稳定地产出并上传 Tauri updater 所需的完整热更新产物。

## 当前状态

已完成：

- `desktop/src-tauri/tauri.conf.json` 已配置 updater `pubkey`。
- 客户端检查更新已经直接读取 OSS：

```text
https://gxy-download.oss-cn-shanghai.aliyuncs.com/latest.json
```

- Windows 构建脚本支持 `TAURI_SIGNING_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY_PATH`。
- macOS 构建脚本支持 `SIGN_BUILD=1` 以及 `TAURI_SIGNING_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY_PATH`。
- `desktop/scripts/merge-updater-latest.ts` 会合并 Windows / macOS 两个平台的 updater manifest。
- `scripts/upload-release-oss.ts --require-updater` 会校验并上传：
  - `latest.json`
  - Windows updater artifact
  - Windows `.sig`
  - macOS updater archive
  - macOS `.sig`
- CI workflow 在 tag 发布或 `publish=true` 时强制要求 updater 签名密钥。

## CI 发布要求

tag 发布和真实发布都必须配置以下 Secrets：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

缺少 updater 签名密钥时，CI 会在构建阶段失败，不会继续上传 OSS 或 Gitee Release。

## 本地发布要求

Windows：

```powershell
. .\scripts\updater-env.local.ps1
cd desktop
.\scripts\build-windows-x64.ps1
```

macOS：

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="/absolute/path/to/tauri-updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
export SIGN_BUILD=1
./desktop/scripts/build-macos-arm64.sh
```

合并并上传：

```bash
cd desktop
bun run release:updater-manifest
cd ..
bun run release:desktop:oss -- --require-updater --publish
```

## 验收标准

发布后 OSS 至少应存在：

```text
latest.json
Gugu-Agent-<version>-windows-x64.msi
Gugu-Agent-<version>-windows-x64.msi.sig
Gugu-Agent-<version>-darwin-aarch64.app.tar.gz
Gugu-Agent-<version>-darwin-aarch64.app.tar.gz.sig
```

同时保留官网安装包：

```text
Gugu-Agent-latest-windows-x64.msi
Gugu-Agent-latest-aarch64.dmg
release.json
```

客户端“检查更新”应直接读取 OSS `latest.json`，不依赖 gateway 动态接口。

## 边界

- 热更新签名只负责 updater 安全校验，不等于 Windows 代码签名，也不等于 Apple Developer ID 签名和公证。
- 旧版本如果没有内置 updater 配置，无法通过热更新进入新链路，需要用户手动安装一次带 updater 的版本。
- macOS 未公证时仍可能出现 Gatekeeper 提示，需走 Apple Developer Program 后才能彻底改善。
