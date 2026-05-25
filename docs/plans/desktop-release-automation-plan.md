# Gugu Agent 桌面端发布自动化方案

## 背景

当前桌面端发布流程包含大量人工步骤：

- Windows 本机打 MSI。
- macOS 机器拉取最新代码并打 DMG。
- 编写 Gitee Release Markdown。
- 上传 MSI / DMG 到 Gitee Release。
- 上传安装包和热更新产物到 OSS。
- 计算并填写 SHA256。
- 修改 gateway 下载链接、版本号和校验值。
- 部署或重启 gateway。

这个流程容易漏步骤，也会让每次发布都被两台电脑、多个平台和多处配置绑住。

目标是把发布动作收敛成一次触发，后续构建、上传、官网同步都由流水线完成。

## 目标体验

最终发布时只需要执行：

```bash
bun run release:desktop 0.1.15
```

或：

```bash
bun run release:desktop patch
```

脚本负责更新版本、校验 release notes、提交 release commit、创建 tag 并推送。CI 自动完成后续构建和发布。

## 推荐架构

### 1. CI 自动构建

优先使用 GitHub Actions 或等价 CI：

- Windows runner 构建 `Gugu-Agent-<version>-windows-x64.msi`。
- macOS Apple Silicon runner 构建 `Gugu-Agent-<version>-aarch64.dmg`。
- 构建时确保 `.agents/skills`、agents、plugins 等资源全部打入包内。
- 如果配置了 `TAURI_SIGNING_PRIVATE_KEY`，同时输出热更新产物。

如果坚持 Gitee，需要确认 Gitee Go 是否稳定支持 macOS runner。否则可以考虑用一台 Mac mini 作为 self-hosted runner，但维护成本更高。

### 2. Release 产物

每次发布生成：

- `Gugu-Agent-<version>-windows-x64.msi`
- `Gugu-Agent-<version>-aarch64.dmg`
- `Gugu-Agent-<version>-windows-x64.msi.zip`
- `Gugu-Agent-<version>-windows-x64.msi.zip.sig`
- `Gugu-Agent-<version>-darwin-aarch64.app.tar.gz`
- `Gugu-Agent-<version>-darwin-aarch64.app.tar.gz.sig`
- `latest.json`
- `release.json`

其中 `latest.json` 给 Tauri updater 使用，`release.json` 给官网 `/download` 使用。

### 3. OSS 上传策略

OSS 同时保留版本文件和 latest 别名：

```text
Gugu-Agent-0.1.15-windows-x64.msi
Gugu-Agent-0.1.15-aarch64.dmg
Gugu-Agent-latest-windows-x64.msi
Gugu-Agent-latest-aarch64.dmg
latest.json
release.json
```

版本文件用于归档和回滚，latest 别名用于官网固定下载链接。

### 4. 官网下载配置

gateway 不应再每次发布手动改 `.env`。建议改成读取 OSS 上的 `release.json`。

示例：

```json
{
  "version": "0.1.15",
  "windows": {
    "url": "https://gxy-download.oss-cn-shanghai.aliyuncs.com/Gugu-Agent-latest-windows-x64.msi",
    "sha256": "..."
  },
  "macos": {
    "url": "https://gxy-download.oss-cn-shanghai.aliyuncs.com/Gugu-Agent-latest-aarch64.dmg",
    "sha256": "..."
  },
  "publishedAt": "2026-05-24T12:00:00.000Z"
}
```

gateway `/download` 页面优先读取 `release.json`，读取失败时再回退到 `.env` 中的静态配置。

这样发布后不需要再部署 gateway。

### 5. Gitee Release 自动化

CI 在 tag 发布后：

- 读取 `release-notes/v<version>.md`。
- 创建或更新 Gitee Release。
- 上传 MSI / DMG。
- 将 SHA256 和下载地址写入 Release 内容。

## 密钥管理

以下内容只放 CI Secrets，不进仓库：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- OSS AccessKey ID / Secret
- Gitee Access Token
- 未来的 Windows 代码签名证书与密码
- 未来的 Apple Developer 签名、公证相关凭据

## 分阶段实施

### 阶段一：减少手工改官网

- 新增生成 `release.json` 的脚本。
- 修改 gateway `/download` 支持读取 `release.json`。
- 发布时仍可本地打包，但官网不再手动改版本、链接和 SHA256。

### 阶段二：自动上传 OSS

- 新增 OSS 上传脚本。
- 上传版本文件、latest 别名、`latest.json`、`release.json`。
- 自动计算 SHA256。

### 阶段三：自动创建 Gitee Release

- 新增 Gitee Release 脚本。
- 自动读取 release notes。
- 自动上传 MSI / DMG。

### 阶段四：CI 双平台构建

- Windows runner 负责 MSI。
- macOS runner 负责 DMG。
- 两边产物汇总后统一上传 OSS 和 Gitee Release。

### 阶段五：热更新正规化

- CI 构建时强制要求 updater 签名密钥。
- 自动合并双平台 `latest.json`。
- 上传完整 updater 产物。
- 客户端检查更新直接走 OSS。

## 推荐最小落地顺序

1. 先做 `release.json`，让 gateway 不再每次改下载配置。
2. 再做 OSS 上传脚本，减少复制、上传、算 SHA256。
3. 再做 Gitee Release 自动化。
4. 最后把 Windows / macOS 构建迁移到 CI。

这个顺序最稳，任何阶段失败都能回退到当前人工流程，不会卡发布。

## 风险和注意事项

- macOS 构建机必须确认能稳定打包 Apple Silicon DMG。
- 如果没有正式代码签名，安装包仍可能被系统或浏览器提示风险。
- `latest` 别名覆盖后，OSS/CDN 缓存需要控制 TTL 或主动刷新。
- `release.json` 要有回退机制，避免 OSS 短暂不可用导致下载页空白。
- CI 里必须验证 MSI / DMG 文件名、版本号、SHA256 与 `release.json` 一致。

## 验收标准

- 本地只需执行一次 release 命令。
- Windows / macOS 产物自动生成。
- Gitee Release 自动创建并包含附件。
- OSS 上版本文件和 latest 别名都存在。
- `/download` 自动展示最新版本、下载链接和 SHA256。
- 热更新产物在配置签名密钥后自动生成并上传。
