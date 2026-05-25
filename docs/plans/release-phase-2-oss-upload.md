# Phase 2：OSS 自动上传

本阶段目标是把桌面端发布产物上传 OSS 的动作脚本化，减少手工上传、复制链接、计算 SHA256 和改官网配置的成本。

## 命令

预览上传计划：

```bash
bun run release:desktop:oss
```

确认无误后真实上传：

```bash
bun run release:desktop:oss -- --publish
```

如果热更新产物已经生成，并且希望缺失时直接失败：

```bash
bun run release:desktop:oss -- --require-updater --publish
```

## 环境变量

真实上传只从环境变量读取密钥，不写入仓库。

```bash
GUGU_OSS_ACCESS_KEY_ID=...
GUGU_OSS_ACCESS_KEY_SECRET=...
GUGU_OSS_BUCKET=gxy-download
GUGU_OSS_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com
GUGU_OSS_PUBLIC_BASE_URL=https://gxy-download.oss-cn-shanghai.aliyuncs.com/
```

可选：

```bash
GUGU_OSS_SECURITY_TOKEN=...
GUGU_OSS_OBJECT_PREFIX=
GUGU_OSS_ACL=public-read
```

## 默认上传内容

脚本会校验 `desktop/src-tauri/tauri.conf.json` 版本与产物文件名一致，然后上传：

- `Gugu-Agent-<version>-windows-x64.msi`
- `Gugu-Agent-latest-windows-x64.msi`
- `Gugu-Agent-<version>-aarch64.dmg`
- `Gugu-Agent-latest-aarch64.dmg`
- `release.json`

如果 `desktop/build-artifacts/latest.json` 存在，还会上传：

- `latest.json`
- `latest.json` 中引用的 updater archive
- updater archive 对应的 `.sig` 文件

## 安全策略

- 默认 dry-run，不会碰 OSS。
- `--publish` 才会真正上传。
- 版本文件使用长期缓存。
- `release.json`、`latest.json` 和 latest 别名使用 `no-cache`，方便官网和更新检查尽快看到新版。
- 没有 updater 签名产物时默认跳过；加 `--require-updater` 后会失败，适合之后热更新正规化。

## 当前边界

Phase 2 只解决 OSS 上传，不自动创建 Gitee Release，也不自动双平台构建。下一阶段再接 Gitee Release 自动化。
