# Gugu Agent Desktop

基于 Tauri 2 + React 的桌面客户端。

## 开发

```bash
bun install
bun run tauri dev
```

## 构建

```bash
# macOS (Apple Silicon)
./scripts/build-macos-arm64.sh

# Windows (x64, MSI only)
.\scripts\build-windows-x64.ps1
```

构建产物位于 `build-artifacts/` 目录，文件名会显式包含平台、架构和包类型。

## 热更新发布

热更新不能只上传 DMG/MSI，还需要 signed updater archive、`.sig` 和最终的 `latest.json`。

```bash
# macOS signed build
SIGN_BUILD=1 ./scripts/build-macos-arm64.sh

# Windows signed build, on Windows
.\scripts\build-windows-x64.ps1

# 合并两端 latest.json，生成上传到 OSS 根目录的 build-artifacts/latest.json
bun run release:updater-manifest
```

将脚本输出列出的 updater 文件和 `latest.json` 上传到
`https://gxy-download.oss-cn-shanghai.aliyuncs.com/`。已安装的 0.1.13
客户端会先请求这里的 `latest.json`，缺这个文件就会报
`Could not fetch a valid release JSON from the remote`。

## 常见问题

### macOS 提示"已损坏，无法打开"

```bash
xattr -cr /Applications/Gugu\ Agent.app
```
