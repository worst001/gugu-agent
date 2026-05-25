# Tauri 热更新签名运行手册

## 目标

从 `0.1.14` 内测版本开始补齐 Tauri updater 签名链路。之后每次发布除 MSI / DMG 外，还要生成并上传 updater archive、`.sig` 和合并后的 `latest.json`。

## 首次初始化

在 Windows 主仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-tauri-updater-key.ps1 -GeneratePassword -Force
```

脚本会：

- 生成本地私钥：`secrets/tauri-updater.key`
- 生成本地环境脚本：`scripts/updater-env.local.ps1`
- 更新 `desktop/src-tauri/tauri.conf.json` 里的 updater 公钥

`secrets/`、`*.local.ps1`、`*.local.sh` 都被 git 忽略，不能提交。
环境脚本会从私钥文件读取内容并设置 `TAURI_SIGNING_PRIVATE_KEY`，这是 Tauri CLI 实际生成 updater 签名时需要的变量。

## Windows 打包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\updater-env.local.ps1; cd desktop; .\scripts\build-windows-x64.ps1"
```

成功后 `desktop/build-artifacts/windows-x64/` 应包含：

- `Gugu-Agent-<version>-windows-x64.msi`
- `Gugu-Agent-<version>-windows-x64.msi.zip`
- `Gugu-Agent-<version>-windows-x64.msi.zip.sig`
- `latest.json`

## macOS 打包

把同一份 `secrets/tauri-updater.key` 安全复制到 Mac，然后设置：

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="/absolute/path/to/tauri-updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="同一份密码"
export SIGN_BUILD=1
```

再运行：

```bash
desktop/scripts/build-macos-arm64.sh
```

成功后 `desktop/build-artifacts/macos-arm64/` 应包含：

- `Gugu-Agent-<version>-aarch64.dmg`
- `Gugu-Agent-<version>-darwin-aarch64.app.tar.gz`
- `Gugu-Agent-<version>-darwin-aarch64.app.tar.gz.sig`
- `latest.json`

## 合并 updater manifest 并上传 OSS

当 Windows 和 macOS 产物都齐全后运行：

```powershell
cd desktop
bun run release:updater-manifest
cd ..
bun run release:desktop:oss -- --require-updater --publish
```

`--require-updater` 会强制检查 updater 产物是否齐全，避免只上传安装包却漏掉热更新文件。
