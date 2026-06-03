# Gugu Agent Desktop 打包发布规范

更新时间：2026-06-02

本规范用于后续所有 Desktop 版本发布。旧的 `desktop-0.1.16-release-packaging-runbook.md` 只作为历史参考；正式打包、发布、热更新判断以本文为准。

## 0. 核心原则

发布不是“CI 跑完”或“OSS 有文件”。

- **打包完成**：官方 CI 产出对应平台安装包、更新包、签名文件，并能追溯到唯一 tag。
- **发布完成**：版本化产物已经上传，GitHub/Gitee/OSS 元数据一致，但还没有代表用户一定能安全升级。
- **热更新稳定完成**：真实 Windows/macOS 升级链路通过，`latest.json` 已经指向新版本，并完成发布后回归。

`latest.json` 是热更新开关，不是普通静态文件。只有在所有阻断项通过后才能切到新版本。

## 1. 我还需要什么

为了防止再次出现“文件已上传但用户升级坏掉”的情况，每次发布前必须确认这些条件。

1. **GitHub Actions 可见性**
   - 需要能看到 `.github/workflows/release-desktop.yml` 的 run 状态、commit、tag、artifact。
   - 最好提供 `gh` 登录或网页截图；没有时只能通过 OSS 侧间接判断，不能算完整确认。

2. **OSS 发布与回滚权限**
   - 需要能上传、覆盖或回滚 `latest.json`。
   - 需要能查看版本化安装包 URL、文件大小、签名文件是否存在。
   - 没有 OSS 权限时，我不能暂停坏版本热更新，也不能完成事故止血。
   - 当前本机临时 OSS 凭据文件路径：`D:/Claude Code/claude-code-gugu/secrets/OSS.txt`。
   - `secrets/` 已被 `.gitignore` 忽略，禁止提交凭据或备份文件。

3. **Windows 真实冒烟环境**
   - 至少一台干净 Windows 机器或 VM。
   - 能安装上一个公开版本，再走应用内热更新到当前版本。
   - 能验证 `C:\Program Files\gugu-agent\gugu-agent.exe`、开始菜单快捷方式、桌面快捷方式、sidecar、版本号。

4. **macOS 真实冒烟环境**
   - 至少一台 Apple Silicon Mac。
   - 能安装上一版本，走热更新到当前版本，并确认应用和 sidecar 正常。

5. **上一版本安装包**
   - 每次发布必须明确“从哪个公开版本升级到新版本”。
   - 不能只测新版本全新安装。

6. **签名与 updater secret**
   - 不需要把 secret 明文给 agent。
   - 但必须确认 CI 中 Tauri updater 签名、macOS/Windows 相关签名配置仍可用。

7. **测试账号与 Gugu Managed 可用性**
   - 至少能跑一次真实 Gugu Managed 对话。
   - 若包含支付、激活码、套餐相关改动，还需要单独支付冒烟。

## 2. 发布源头

所有正式 Desktop 发布必须来自仓库主分支的 tag。

关键文件：

- `.github/workflows/release-desktop.yml`
- `scripts/release.ts`
- `desktop/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`
- `release-notes/vX.Y.Z.md`
- `.agents/skills`

版本规则：

- tag 必须是 `vX.Y.Z`。
- release notes 文件必须是 `release-notes/vX.Y.Z.md`。
- Desktop 版本号必须与 tag 完全一致。
- 不允许从脏工作区发布。
- 不允许手工移动已有 tag，除非明确进入事故处理流程。
- 不允许把运行日志、临时目录、打包输出、下载缓存提交进 release commit。

## 3. 必须打入安装包的内容

Desktop 安装包必须包含：

- React/Vite 前端构建产物。
- Tauri/Rust 桌面壳。
- `gugu-sidecar`。
- 当前项目 `.agents/skills`，作为 `gugu-agent-pack` resource 打入。
- 默认启用所需的内置 skill、plugin、agent 功能。
- Office 工具箱相关 skill/prompt/resource。
- claude-mem 若作为默认能力，必须内置可运行路径，不能依赖小白用户安装 `sh`、`qmd`、Python 或其他宿主命令。

默认不应打入或默认启用：

- `qmd`，除非已经有内置可运行实现并通过冒烟。
- 依赖用户 PATH 的外部命令型 MCP。
- 未验证连通性的第三方 provider preset。

CodeGraph 原则：

- 可以作为“编码”工具增强能力。
- 不能作为强依赖。
- 未连接时不能影响普通编码流程。
- 若未来作为默认 MCP，需要做到无需用户手动安装宿主命令。
- 仅打入 `.agents/skills/codegraph/SKILL.md` 只代表 agent 有使用指引，不会让设置页的 MCP 服务列表出现 CodeGraph。
- MCP 服务页只显示实际 `mcpServers` 配置；如果要显示 `codegraph`，必须注册 MCP server，例如：

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "codegraph",
      "args": ["serve", "--mcp", "--path", "<project path>"],
      "env": {}
    }
  }
}
```

- 发布给小白用户前，不能默认启用依赖宿主 `codegraph` 命令的 MCP；要么内置可运行 launcher，要么把 CodeGraph 作为可选增强。

## 4. 打包前检查

发布前先确认：

- `git status` 干净，或只有明确要发布的改动。
- release notes 已存在，且描述用户可见变化、修复、风险。
- 版本文件一致。
- `.agents/skills` 已包含本次需要的 skill/plugin/agent；办公工具箱至少检查 `office-suite`、`document-master`、`spreadsheet-master`、`ppt-master`、`mail-master`、`file-master`、`local-office-files`、`pdf-master`、`excel-master`、`word-master`。
- 默认 MCP 列表没有依赖缺失后必红的条目。
- Windows updater 入口、macOS updater 入口、OSS endpoint 没有漂移。
- 没有把内部 scaffold 写入用户消息标题或聊天记录。
- 相关前端、store、server、sidecar 测试已跑。

推荐命令：

```powershell
bun install
bun test
cd desktop
bun install
bun run test
bun run lint
```

如果只改文档，可以跳过测试；只要涉及 UI、运行链路、MCP、sidecar、updater，不能跳过。

## 5. 创建发布 commit 和 tag

使用官方脚本，不手工改版本号。

```powershell
bun run scripts/release.ts X.Y.Z
```

脚本必须完成：

- 更新 Desktop 版本号。
- 刷新 `desktop/src-tauri/Cargo.lock`。
- 校验 `release-notes/vX.Y.Z.md` 存在。
- 创建 release commit。
- 创建 annotated tag `vX.Y.Z`。

推送时优先推精确 tag：

```powershell
git push origin main
git push origin vX.Y.Z
```

不要用无脑 `git push origin main --tags` 发布一堆旧 tag。

## 6. CI 打包规范

官方 Desktop 产物必须由 GitHub Actions 构建。

当前 workflow：

- `.github/workflows/release-desktop.yml`

必须确认每个平台：

- workflow run 成功。
- commit SHA 等于本次 release commit。
- tag 等于 `vX.Y.Z`。
- 安装包存在。
- updater archive 存在。
- `.sig` 签名文件存在。
- `latest.json` 或待合并 manifest 存在。
- artifact 文件大小正常，不是 0 字节或异常偏小。

Windows 特别说明：

- 当前 Windows 脚本主要走 MSI。
- Tauri v2 在 `bundle.createUpdaterArtifacts: true` 下会把 raw `.msi` 作为 Windows updater bundle，并生成 `.msi.sig`；`.msi.zip` 是 `createUpdaterArtifacts: "v1Compatible"` 的产物。
- MSI 可以继续用，但不能因为 CI 产出 MSI 就认为热更新稳定。
- Windows 必须额外通过真实升级冒烟。
- `latest.json` 必须指向与当前 Tauri 配置匹配、且已经通过升级冒烟的 updater 产物。

## 7. Windows 发布阻断项

Windows 是本次事故风险最高的平台。以下任何一项失败，都不能更新 `latest.json`。

### 7.1 MSI 表静态检查

用 Windows Installer 表检查新旧 MSI：

- `ProductName` 稳定，例如 `gugu-agent`。
- `ProductVersion` 等于 `X.Y.Z`。
- `UpgradeCode` 与历史版本一致。
- `ProductCode` 每个版本不同。
- `INSTALLDIR` 稳定，例如 `ProgramFiles64Folder\gugu-agent`。
- File 表存在 `gugu-agent.exe`。
- Shortcut target 指向主 exe。
- `System.AppUserModel.ID` 没有异常漂移。
- 同一路径同一资源的 Component GUID 没有无意义漂移；如有漂移，需要说明原因。

### 7.2 Windows 全新安装冒烟

在干净 Windows 上：

1. 安装新版本 MSI。
2. 确认安装过程没有用户可见 warning，例如 `Warning 1946`。
3. 确认 `C:\Program Files\gugu-agent\gugu-agent.exe` 存在。
4. 从安装目录启动 exe。
5. 从开始菜单快捷方式启动。
6. 从桌面快捷方式启动，如果安装器创建了桌面快捷方式。
7. 确认应用内版本号是 `X.Y.Z`。
8. 确认 sidecar 启动。
9. 确认能新建会话并跑一次普通 Gugu Managed 请求。
10. 卸载后确认快捷方式和主程序被清理。

### 7.3 Windows 旧版本升级冒烟

这是热更新发布前最重要的一关。

1. 安装上一个公开稳定版本。
2. 启动应用，确认旧版本正常。
3. 关闭应用，重新打开，触发检查更新。
4. 通过应用内 updater 升级到 `X.Y.Z`。
5. 升级后确认没有弹出“找不到 `gugu-agent.exe`”。
6. 确认 `C:\Program Files\gugu-agent\gugu-agent.exe` 存在。
7. 确认开始菜单快捷方式目标存在。
8. 确认应用可以启动。
9. 确认 sidecar 可以启动。
10. 确认应用内版本号是 `X.Y.Z`。
11. 再次检查更新，应该显示已是最新。
12. 重启 Windows 后再启动一次。

阻断条件：

- 安装后主 exe 不存在。
- 快捷方式目标不存在。
- 安装器出现用户可见 warning。
- 升级后应用无法自启动或手动启动。
- sidecar 不启动。
- updater manifest 指向未测过的产物。
- 安装路径、identifier、productName、upgradeCode 漂移。

### 7.4 Windows updater 运行时要求

Windows 上不要假设 `install()` 后可以立即 `relaunch()`。

如果使用 Tauri updater：

- Windows 安装阶段可能会退出当前进程。
- relaunch 必须确认不会和 MSI 安装/卸载过程抢时间。
- 若发现升级后找不到 exe，必须优先检查 updater install 与 relaunch 的时序。
- 任何 relaunch 策略改动，都要重新跑 7.3。

## 8. macOS 发布阻断项

macOS 也必须测升级，不只测 DMG。

1. 安装上一个公开稳定版本。
2. 启动应用，确认旧版本正常。
3. 触发热更新到 `X.Y.Z`。
4. 确认更新包签名通过。
5. 确认应用可以重新启动。
6. 确认应用内版本号是 `X.Y.Z`。
7. 确认 sidecar 启动。
8. 确认 `.agents/skills` resource 可读。
9. 新建会话跑一次普通请求。
10. Office 工具箱、默认模型、自动接受、计划模式至少各冒烟一次。

阻断条件：

- app updater archive 缺失。
- `.sig` 缺失或不匹配。
- 更新后应用打不开。
- sidecar 无法启动。
- resource 缺失。

## 9. 功能冒烟

所有平台至少验证：

- 新建普通会话。
- Gugu Managed 模式能跑通。
- 自动接受开关不影响发送。
- 计划模式弹窗能确认和反馈。
- Bash/Write/Read 等长耗时工具有活动概览。
- 工具权限“仅此一次 / 本次会话允许 / 永远允许”语义正确。
- 上下文按钮显示合理。
- Office 工具箱：
  - 普通对话。
  - 编码。
  - 总结文档：wire prompt 包含 `$document-master`，涉及本地文件/PDF/Word 时包含 `$local-office-files`、`$pdf-master`、`$word-master`，用户消息和标题不出现内部 scaffold。
  - 分析表格：wire prompt 包含 `$spreadsheet-master` 和 `$excel-master`，用户消息和标题不出现内部 scaffold。
  - 做 PPT：wire prompt 包含 `$ppt-master`，真实幻灯片任务必须走版式质量检查。
  - 写邮件：wire prompt 包含 `$mail-master`，涉及附件时包含 `$local-office-files` 与格式专用 skill，不自动发送邮件。
  - 处理文件：wire prompt 包含 `$file-master`、`$local-office-files`、`$pdf-master`、`$excel-master`、`$word-master`、`$ppt-master`，无附件时给友好提示，不覆盖原文件。
  - 路由优先级：用户明确要求的最终产物类型优先于工具箱意图和输入格式，例如“把 PDF 做成 PPT”必须用 PDF workflow 读取来源、PPT workflow 产出结果。
- 用户消息、会话标题、聊天记录不出现内部 scaffold。
- 默认 MCP 不出现小白用户无法处理的红色 unavailable 项。
- claude-mem 若默认启用，必须 connected。

## 10. 发布顺序

正确顺序：

1. 创建 release commit 和 tag。
2. 推送 main。
3. 推送 tag。
4. 等 GitHub Actions 产出安装包、updater archive、签名文件。
5. 上传版本化产物到 OSS。
6. 验证版本化产物 URL 都可访问。
7. 生成但暂不发布最终 `latest.json`。
8. 跑 Windows/macOS 全新安装冒烟。
9. 跑 Windows/macOS 从上一版本升级冒烟。
10. 只有全部通过，才上传/覆盖线上 `latest.json`。
11. 发布 GitHub/Gitee release。
12. 发布后再次跑一次线上热更新检查。

错误顺序：

- CI 一成功就更新 `latest.json`。
- 没有 Windows 升级冒烟就通知用户热更新。
- 只测全新安装，不测旧版本升级。
- 只有本机构建，没有官方 CI 产物。
- 发现 Windows warning 后继续发布。

## 11. OSS 与 latest.json 规范

OSS 上的版本化产物必须不可变。

### 11.1 OSS 凭据与本地文件

当前本机用于止血/发布的 OSS 凭据文件：

```text
D:/Claude Code/claude-code-gugu/secrets/OSS.txt
```

约定：

- 文件只放在本机 `secrets/` 目录，不能提交 git。
- `secrets/` 已被 `.gitignore` 忽略。
- 文件里可以使用当前格式：
  - `AccessKey ID: ...`
  - `AccessKey Secret: ...`
- 不要在聊天、日志、发布报告里打印密钥值。
- agent 读取时只能确认字段名，不能输出真实 AccessKey。
- 事故处理完成后，建议禁用或轮换这组临时 AccessKey。

默认 OSS 信息：

- bucket：`gxy-download`
- region：`oss-cn-shanghai`
- public base URL：`https://gxy-download.oss-cn-shanghai.aliyuncs.com`
- object：`latest.json`

本地备份目录：

```text
D:/Claude Code/claude-code-gugu/secrets/oss-backups/
```

每次覆盖线上 `latest.json` 前必须先备份当前线上文件。备份文件也不能提交。

建议结构：

- `Gugu-Agent-X.Y.Z-windows-x64.msi`
- `Gugu-Agent-X.Y.Z-windows-x64.msi.sig`
- `Gugu-Agent-X.Y.Z-windows-x64.msi.zip`（仅 `createUpdaterArtifacts: "v1Compatible"` 时）
- `Gugu-Agent-X.Y.Z-windows-x64.msi.zip.sig`（仅 `createUpdaterArtifacts: "v1Compatible"` 时）
- `Gugu-Agent-X.Y.Z-macos-arm64.dmg`
- `Gugu-Agent-X.Y.Z-macos-arm64.app.tar.gz`
- `Gugu-Agent-X.Y.Z-macos-arm64.app.tar.gz.sig`
- `latest.json`

`latest.json` 要求：

- `version` 等于 `X.Y.Z`。
- Windows URL 指向已通过 Windows 升级冒烟的产物。
- macOS URL 指向已通过 macOS 升级冒烟的产物。
- 每个 updater URL 都有匹配签名。
- 不引用本地路径、GitHub 临时 artifact URL 或未上传完成的对象。
- 更新 `latest.json` 前后都要记录其内容和 SHA256。

## 12. 发布后验收记录

每次发布必须留下记录，至少包含：

- 版本号。
- release commit SHA。
- tag。
- GitHub Actions run URL。
- Windows 安装包 URL、大小、SHA256。
- Windows updater URL、大小、SHA256。
- macOS 安装包 URL、大小、SHA256。
- macOS updater URL、大小、SHA256。
- `latest.json` SHA256。
- Windows 测试机器信息。
- macOS 测试机器信息。
- 从哪个旧版本升级。
- 冒烟结果。
- 是否发现 installer warning。
- 是否发布 GitHub/Gitee release。
- 是否完成线上热更新复测。

## 13. 事故处理

如果发布后发现用户升级失败：

1. **先止血**
   - 立即回滚 `latest.json` 到上一个稳定版本。
   - 或临时移除问题平台的 updater entry。
   - 没有 OSS 权限时，必须立刻要求人工处理，不能继续假装发布完成。

2. **确认影响面**
   - 哪个平台。
   - 哪个版本升级到哪个版本。
   - 全新安装是否受影响。
   - 应用内热更新是否受影响。
   - 手工下载安装是否受影响。

3. **保留证据**
   - 用户截图。
   - `latest.json` 当时内容。
   - 安装包 URL。
   - MSI 表检查结果。
   - 本地或用户机器日志。

4. **修复策略**
   - 优先发布 hotfix 新版本，不覆盖旧安装包。
   - 只有 hotfix 通过完整冒烟后，才能重新打开 `latest.json`。

5. **用户恢复指引**
   - 若主 exe 已丢失，提供手动下载稳定安装包的方式。
   - 指导用户卸载残留版本后安装稳定版本。
   - 不要求用户自己理解 MSI/updater 细节。

## 14. 本次 0.2.1 事故教训

0.2.1 的问题不是“没有打包”，而是“把发布完成误判成了热更新稳定完成”。

已确认的风险点：

- Windows 产物主要是 MSI。
- Tauri v2 raw MSI 作为 updater 产物本身并不违规；问题在于 Windows 真实旧版本升级冒烟没有成为发布阻断项。
- Windows 真实旧版本升级冒烟没有成为发布阻断项。
- 安装器出现 `Warning 1946` 这类用户可见 warning 时，没有阻断发布。
- 用户升级后出现 `C:\Program Files\gugu-agent\gugu-agent.exe` 找不到，说明升级链路存在真实破坏。
- 本地环境没有 OSS 回滚权限，无法独立止血。

后续硬性要求：

- Windows 版本没有通过 7.3，不允许说“热更新可以发布”。
- `latest.json` 必须最后发布。
- Windows installer warning 必须当作 blocker 处理，除非已经证明不影响且不会展示给用户。
- 发布报告必须区分“CI 完成”“OSS 上传完成”“latest.json 已切换”“真实升级通过”。

## 15. 发布检查清单

复制给新窗口使用：

```text
版本：X.Y.Z
上一稳定版本：A.B.C

发布前：
[ ] 工作区干净
[ ] release-notes/vX.Y.Z.md 已写
[ ] Desktop 版本文件一致
[ ] .agents/skills 已包含本次 skill/plugin/agent，且办公工具箱意图层与格式层 skill 都存在
[ ] 默认 MCP 不依赖用户宿主命令
[ ] root 测试通过或说明跳过原因
[ ] desktop 测试通过
[ ] desktop lint 通过

打包：
[ ] bun run scripts/release.ts X.Y.Z 成功
[ ] release commit 创建
[ ] tag vX.Y.Z 创建
[ ] main 已推送
[ ] tag 已推送
[ ] GitHub Actions 成功
[ ] Windows artifact 存在
[ ] Windows .sig 存在
[ ] macOS artifact 存在
[ ] macOS .sig 存在

上传：
[ ] 版本化产物上传 OSS
[ ] URL 200
[ ] 文件大小正常
[ ] SHA256 已记录
[ ] latest.json 已生成但尚未切换线上

Windows：
[ ] MSI 表检查通过
[ ] 全新安装通过
[ ] 从 A.B.C 升级到 X.Y.Z 通过
[ ] 主 exe 存在
[ ] 快捷方式可启动
[ ] 无 installer warning
[ ] sidecar 正常
[ ] 应用内版本正确

macOS：
[ ] 全新安装通过
[ ] 从 A.B.C 升级到 X.Y.Z 通过
[ ] app 可启动
[ ] sidecar 正常
[ ] resource/skills 正常，`gugu-agent-pack` 内可读 office-suite/document-master/spreadsheet-master/ppt-master/mail-master/file-master/local-office-files/pdf-master/excel-master/word-master
[ ] 应用内版本正确

发布：
[ ] latest.json 已切到 X.Y.Z
[ ] 线上 latest.json 校验通过
[ ] GitHub release 完成
[ ] Gitee release 完成
[ ] 发布后热更新复测通过
[ ] 发布报告已写
```

## 16. 给新窗口的交接 Prompt

```text
你正在接手 Gugu Agent Desktop 发布。请先阅读并严格遵守：
D:/Claude Code/claude-code-gugu/docs/plans/desktop-release-packaging-runbook.md

这份规范是当前正式发布标准，旧的 desktop-0.1.16-release-packaging-runbook.md 只作为历史参考。

重要背景：
- 0.2.1 曾出现 Windows 热更新/安装事故：用户升级后找不到 C:\Program Files\gugu-agent\gugu-agent.exe，并且安装器出现 Warning 1946。
- 事故原因不是没有产物，而是把 CI/OSS/latest.json 完成误判成热更新稳定完成。
- 后续任何版本都必须区分：打包完成、发布完成、热更新稳定完成。
- latest.json 是热更新开关，必须最后发布。
- Windows 必须做真实旧版本升级冒烟，否则不能说热更新稳定。

如果我要你打包发布，请先确认缺什么：
1. GitHub Actions run 可见性。
2. OSS latest.json 发布/回滚权限。
3. Windows 干净测试机或 VM。
4. macOS Apple Silicon 测试机。
5. 上一稳定版本安装包。
6. Gugu Managed 测试账号或真实可用配置。

没有 OSS 权限时，不能声称可以止血或完成热更新发布。
没有 Windows 升级冒烟时，不能声称 Windows 热更新稳定。

请按规范输出发布报告，并明确每一项是否完成、跳过原因和剩余风险。
```
