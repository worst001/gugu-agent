# Gugu IM 扫码接入重构：基于 Kun 的源码审计与架构评审 Prompt

> 版本：v1.0  
> 日期：2026-07-23  
> 用途：直接交给 Codex。  
> 本轮目标是**重新审计和选型，不立即修改代码**。请以 Gugu 当前仓库、Kun 指定提交的真实源码和平台官方能力为准，不要只根据 README、界面截图或理想化架构作答。

---

## 0. 先回答的一句话

请在结论开头直接回答：

> Gugu 是否应该把现有“手工配置 Bot / Adapter”的用户入口，迁移为类似 Kun 的“扫码授权后自动接入 IM”体验？在不重复建设 Runtime、Session 和消息处理能力的前提下，最小且正确的架构方案是什么？

---

## 1. 背景

Gugu Agent 当前底座来自 Claude Code 体系，已经接入过飞书、企业微信等 IM，但现有使用方式偏工程化：

1. 用户先去平台开放后台创建应用或 Bot；
2. 配置消息、文件、权限等能力；
3. 取得 App ID、Secret、Token 等凭据；
4. 回到 Gugu 填写配置；
5. 启动 Adapter / sidecar；
6. 才能在手机 IM 中与 Agent 交互。

这个流程对普通用户太复杂。

近期研究了 Kun：

- 仓库：`https://github.com/KunAgent/Kun`
- 参考提交：`f65ac05c0f62d060b7a0cf208ee2941b6ecf41f7`

Kun 在桌面端提供“连接手机”入口。用户选择微信、飞书 / Lark 等平台后，可以生成二维码；扫码完成后，Kun 自动取得平台凭据、保存连接配置并启动消息通道。

希望评估：

> Gugu 是否可以把 IM 接入体验改成“扫码授权 → 自动保存凭据 → 自动启动通道”，尽量不再让普通用户手动创建 Bot、复制密钥和配置权限。

---

## 2. 产品目标

### 2.1 用户体验目标

普通用户应该能够：

1. 打开 Gugu 的“连接手机”页面；
2. 选择微信、飞书 / Lark 等支持的平台；
3. 点击生成二维码；
4. 用对应手机 App 扫码并确认；
5. 看到“连接成功”；
6. 直接在手机中给 Gugu 发消息、触发 Agent 任务并接收文本、图片或文件结果。

默认流程不要求用户理解：

- App ID；
- App Secret；
- Webhook；
- WebSocket；
- Bot 权限；
- Adapter；
- sidecar；
- SessionStore；
- Runtime。

### 2.2 技术目标

- 走平台允许的官方授权和消息通道；
- 不模拟登录个人微信客户端；
- 不使用高风险 Hook、注入或协议逆向方案；
- 复用 Gugu 已有的 Session、消息处理、权限和附件能力；
- 平台特殊协议状态留在对应 Adapter 内部；
- 凭据安全保存；
- 可暂停、重连、解绑、吊销和恢复；
- 连接流程和消息执行过程可观测；
- 新实现失败时可以回退到现有方案。

### 2.3 非目标

本轮不追求：

- 一次性统一所有 IM；
- QQ 接入，除非真实源码或官方能力可以证明；
- 个人微信分身或代替用户与全部私人联系人聊天；
- 重写整个 Gugu Runtime；
- 复制 Kun 的商业受限源码；
- 把所有平台字段硬塞进一个巨大的公共消息对象；
- 第一轮就完成全量密钥库迁移。

---

## 3. 已确认的 Kun 事实

请自行重新核对以下文件，不要直接相信本 Prompt 的摘要。

### 3.1 前端与 IPC

重点文件：

```text
src/renderer/src/components/chat/ConnectPhoneView.tsx
src/preload/index.ts
src/main/ipc/register-app-ipc-handlers.ts
src/main/claw-platform-install.ts
```

调用链大致为：

```text
ConnectPhoneView
→ window.kunGui.startClawImInstallQr(...)
→ Electron preload
→ claw:im-install:qrcode IPC
→ startWeixinInstallQrcode / startFeishuInstallQrcode
```

前端统一理解：

- 生成二维码；
- 显示倒计时；
- 轮询安装状态；
- 扫码成功；
- 保存新的 IM Channel。

前端并不直接理解微信或飞书的底层协议。

### 3.2 微信

重点文件：

```text
src/main/weixin-bridge-runtime.ts
src/main/claw-platform-install.ts
```

Kun 使用依赖：

```text
@tencent-weixin/openclaw-weixin
```

代码中可见的服务：

```text
https://ilinkai.weixin.qq.com
https://novac2c.cdn.weixin.qq.com/c2c
```

真实流程：

```text
Kun GUI
→ 本机 loopback JSON-RPC 微信 Bridge
→ get_bot_qrcode
→ 展示二维码
→ get_qrcode_status 长轮询
→ confirmed 后取得 ilink_bot_id、bot_token、baseurl、ilink_user_id
→ 本地保存账号凭据
→ channels.start
→ getupdates 长轮询收消息
→ POST 到 Kun 本地 /claw/im
→ Agent 执行
→ sendmessage / CDN 把结果发回微信
```

微信的以下状态属于 Adapter / Bridge 内部协议状态：

- `context_token`
- `get_updates_buf`
- `baseurl`
- `bot_token`
- iLink 消息游标与重试状态

这些内容不应默认泄漏到 Gugu 的公共消息模型或业务 Runtime。

### 3.3 飞书 / Lark

重点文件：

```text
src/main/claw-platform-install.ts
src/main/feishu-transport-adapter.ts
```

扫码阶段使用飞书官方应用注册流程：

```text
POST /oauth/v1/app/registration
action=begin
archetype=PersonalAgent
auth_method=client_secret
```

取得：

- `verification_uri_complete`
- `device_code`
- `user_code`

扫码确认后，轮询换取：

- `client_id`
- `client_secret`

随后 Kun 使用：

```text
@larksuiteoapi/node-sdk
transport: websocket
```

建立官方 WebSocket 消息通道。

### 3.4 关键判断

Kun 的二维码不是“手机直接连接本地 Runtime”。

更准确的描述是：

> Kun 把平台官方授权、凭据换取、凭据保存和通道启动包装为扫码流程。

它没有绕开微信或飞书；它减少的是用户手工配置步骤。

### 3.5 尚未确认的点

在已审查的 Kun 文件中，明确看到了：

- 微信；
- 飞书；
- Lark；
- Telegram。

没有从上述源码中确认 QQ。

如果仓库的其他扩展、分支或后续版本支持 QQ，请给出确切文件和调用链；否则不要在 Gugu 方案中写“已支持 QQ”。

---

## 4. Gugu 当前代码基线

上一轮 Codex 审计称，Gugu 不是绿地项目，当前已经存在类似链路：

```text
Settings
→ /api/adapters
→ adapters.json
→ Tauri 管理的 Bun sidecar
→ 平台 Adapter
→ WsBridge
→ Session
```

已提到的现有模块包括：

- `AdapterPlatform`
- `AdapterFileConfig`
- `/api/adapters`
- `adapterService.ts`
- Tauri 管理的 Adapter sidecar
- `WsBridge`
- `SessionStore`
- 配对
- 白名单
- 权限回复
- 附件协议
- `IncomingTextMessage`
- `TextChatRunner`

并且存在两套容易混淆的入口：

```text
src/services/mcp/channel*
```

它属于 Claude Code MCP Channel。

```text
adapters/
```

它属于桌面端 IM sidecar。

本轮微信扫码接入原则上应该落在 `adapters/` 体系，不应再创建第三套 Gateway；但请先以仓库实际代码验证。

---

## 5. 我的真实诉求

请不要把需求简化成“新增一个微信 Adapter”。

我真正希望获得的是：

### 5.1 新的用户入口

用户不再手动填写大量平台凭据，而是：

```text
选择平台
→ 生成二维码
→ 扫码确认
→ 自动创建连接
→ 自动启动 IM 通道
```

### 5.2 可以逐步替代旧 IM 使用方式

我接受：

- 旧 IM 代码暂时保留但前台不再推荐；
- 新扫码链路与旧链路并行；
- 新链路稳定后再废弃旧手工配置入口；
- 最后根据复用价值决定删除还是保留旧代码。

我也接受较大重构，但不希望为了“复刻 Kun”而重写 Gugu 已经稳定的：

- Runtime；
- Session；
- TextChatRunner；
- 附件处理；
- 权限控制；
- sidecar 生命周期。

### 5.3 平台差异由 Adapter 吞掉

公共 Runtime 只需要理解规范化后的消息、会话和回复。

例如微信的：

- `context_token`
- `get_updates_buf`
- iLink base URL
- CDN 上传协议

应由微信 Adapter 管理。

飞书的：

- App ID / Secret
- WebSocket 连接
- Reply-To / Thread
- 文件上传规则

应由飞书 Adapter 管理。

### 5.4 未来可扩展

后续希望能够增加：

- 企业微信；
- Telegram；
- 其他具备官方授权和消息通道的平台；
- 账号解绑；
- 多账号；
- 指定项目或 Agent 绑定；
- 手机端触发长任务；
- 任务完成后发送产物；
- 定时任务和主动通知。

因此需要稳定的“安装生命周期”和“通道生命周期”，但不要第一轮建设过度抽象的通用平台。

---

## 6. 不要直接照搬的上一版建议

上一版外部分析提出了抽象接口：

```ts
interface ImInstallProvider {
  startInstall(): Promise<...>
  pollInstall(sessionId: string): Promise<...>
  startChannel(credential: Credential): Promise<void>
}
```

它可以作为概念参考，但不是 Kun 源码中的真实接口。

请不要因为这个示例就创建一套平行 Runtime。

同样，不要直接新建一个公共 `GuguImMessage` 并把所有平台字段塞进去。请先检查现有：

- `IncomingTextMessage`
- `TextChatRunner`
- Session 数据
- 附件协议
- Adapter 与 WsBridge 的边界

再决定最小扩展。

---

## 7. 请重点评审的三种方案

### 方案 A：在现有 Adapter 上增加扫码安装生命周期

保留：

- 现有 Adapter；
- sidecar；
- SessionStore；
- TextChatRunner；
- WsBridge；
- 权限与附件体系。

增加：

- `weixin` 平台；
- QR `start/poll/cancel` API；
- 凭据保存；
- sidecar 自动重启；
- 新的连接手机 UI。

优点：

- 改动小；
- 复用多；
- 风险低。

风险：

- 现有 Adapter 配置模型可能不适合短时安装会话；
- 旧手工配置和新扫码配置可能互相污染；
- 历史设计包袱可能继续存在。

### 方案 B：新建“扫码连接控制面”，数据面继续复用现有 Adapter

建议重点评估。

```text
Connect Phone UI
→ IM Connection Manager / Install Control Plane
→ Provider Login Bridge
→ Credential Store
→ 生成或更新 AdapterFileConfig
→ 现有 sidecar / Adapter / TextChatRunner / Session
```

扫码连接控制面只负责：

- 开始授权；
- 展示二维码；
- 轮询状态；
- 取消、过期和重试；
- 取得凭据；
- 安全保存；
- 创建 / 更新 Adapter；
- 启动通道；
- 显示连接状态。

消息数据面仍走现有系统。

优点：

- 用户体验可以彻底重做；
- 不需要重写消息和会话 Runtime；
- 授权状态和长期消息状态职责清楚；
- 旧手工入口可以隐藏或逐步废弃。

风险：

- 必须设计控制面和 sidecar 的可靠同步；
- 凭据注入边界需要仔细处理；
- 需要明确谁是配置真相源。

### 方案 C：完全采用 Kun 风格的新 IM Runtime

新建：

- 新 Bridge；
- 新消息通道；
- 新会话映射；
- 新附件处理；
- 新凭据系统；
- 新前端。

旧 adapters 不再使用。

优点：

- 架构可以从零整理；
- 容易做到表面一致。

风险：

- 重复 Gugu 已有能力；
- 迁移和回归范围最大；
- 容易出现两套 Session、权限和附件协议；
- 需要重新验证所有平台；
- 短期业务价值不一定覆盖成本。

请结合真实代码选择，不要为了保守默认选 A，也不要因为用户愿意重构就默认选 C。

---

## 8. 建议优先考虑的目标结构

以下只是待验证的候选，不是必须照做：

```text
┌───────────────────────────────┐
│ Connect Phone UI              │
│ 选择平台、二维码、倒计时、状态  │
└──────────────┬────────────────┘
               │ Tauri command / local API
┌──────────────▼────────────────┐
│ IM Connection Manager         │
│ install session / cancel      │
│ credential exchange           │
│ adapter provisioning          │
└───────┬──────────────┬────────┘
        │              │
┌───────▼───────┐ ┌────▼────────────┐
│ Weixin Login  │ │ Feishu Login    │
│ Bridge        │ │ Provider        │
│ iLink QR      │ │ PersonalAgent   │
└───────┬───────┘ └────┬────────────┘
        │ credential    │ credential
┌───────▼───────────────▼────────────┐
│ Secure Credential Service          │
│ Tauri / Rust → OS Keychain         │
└────────────────┬───────────────────┘
                 │ inject by env / controlled IPC
┌────────────────▼───────────────────┐
│ Existing Bun Sidecar               │
│ Weixin Adapter / Feishu Adapter    │
│ TextChatRunner / SessionStore      │
└────────────────┬───────────────────┘
                 │ normalized events
┌────────────────▼───────────────────┐
│ Gugu Runtime / Agent / Project     │
└────────────────────────────────────┘
```

请验证：

- Tauri 主进程是否适合做授权控制面；
- 二维码状态由 Tauri、桌面后端还是 Bun sidecar 管理更合理；
- 微信 Bridge 应嵌入 sidecar，还是作为独立受控子进程；
- 凭据如何在不落明文 JSON 的前提下注入 Adapter；
- `adapters.json` 是否只保存 credential reference，而不是 secret；
- sidecar 重启时如何恢复账号和消息游标；
- 多账号如何建模。

---

## 9. 凭据与安全边界

当前上一轮审计称，凭据可能明文写入：

```text
~/.claude/adapters.json
```

API 返回脱敏不等于磁盘安全。

请评估：

### 9.1 推荐方向

- Tauri / Rust 调用操作系统凭据库；
- Windows Credential Manager；
- macOS Keychain；
- Linux Secret Service，或明确降级；
- `adapters.json` 只保存 credential reference；
- sidecar 启动时通过环境变量、匿名管道或受控 IPC 获得凭据；
- secret 不进入 Renderer；
- secret 不进入普通日志；
- 解绑时删除系统凭据并停止通道。

### 9.2 第一版可以接受的折中

如果完整钥匙串改造会阻塞 PoC，请给出：

- 临时方案；
- 风险；
- 到期条件；
- 后续迁移路径。

不要把“本地 JSON”描述为已安全。

---

## 10. 微信 PoC 的建议边界

第一版只验证一条完整链路：

```text
生成微信二维码
→ 微信扫码确认
→ 获得账号和 token
→ 安全保存
→ 启动微信 Adapter
→ 微信发送文本
→ Gugu 建立或找到 Session
→ Agent 返回文本
→ 微信收到回复
→ 重启 Gugu 后连接恢复
→ 解绑后停止收发
```

建议第一版暂不包含：

- 多账号；
- 群聊复杂权限；
- 主动消息；
- 图片、音频和大文件；
- 定时任务；
- 自动项目路由；
- 账号迁移；
- 飞书扫码迁移。

但请判断现有附件体系是否可以低成本复用，若非常简单可保留。

---

## 11. 飞书处理原则

飞书现有手工 Bot 配置可能已经能用。

请将它和微信 PoC 分开：

1. 先验证微信 iLink QR；
2. 再评估是否迁移飞书到 PersonalAgent 扫码注册；
3. 不要把飞书迁移绑成微信 PoC 的前置条件；
4. 保留旧飞书配置的兼容和回滚路径。

需要确认：

- PersonalAgent 注册是否适合 Gugu 的发布和用户场景；
- 官方 SDK 与服务条款；
- 每个用户得到的是怎样的应用身份；
- 权限范围如何确定；
- 凭据撤销和重授权怎样处理。

---

## 12. 许可证与平台资格

Kun 采用：

```text
PolyForm Noncommercial 1.0.0
```

本轮只研究其架构和协议调用思路，不应直接复制其实现代码。

请单独核查：

- `@tencent-weixin/openclaw-weixin` 的许可证；
- 腾讯 iLink Bot 的接入资格与服务条款；
- 商业应用是否允许；
- 是否需要申请、白名单、审核或特定 Bot 类型；
- 飞书 PersonalAgent 的官方支持边界；
- Gugu 当前仓库许可证与未来商业发布计划是否一致。

技术可行不代表商业和平台合规已经成立。

---

## 13. 本轮 Codex 必须先输出的审计结果

### 13.1 Gugu 当前事实图

请列出：

1. IM 用户入口；
2. Adapter 配置真相源；
3. `/api/adapters` 的读写链；
4. Tauri 启停 sidecar 的链路；
5. sidecar 如何加载平台 Adapter；
6. Adapter 如何进入 `WsBridge`；
7. `TextChatRunner` 如何建立 Session；
8. 配对和白名单在哪里；
9. 权限回复在哪里；
10. 附件协议在哪里；
11. secret 目前如何保存；
12. 平台 Adapter 的公共接口；
13. MCP Channel 与桌面 Adapter 的区别。

### 13.2 Kun 事实图

请基于指定提交列出：

- 微信 QR 启动与轮询；
- iLink token 保存；
- 微信长轮询收消息；
- 微信消息进入 `/claw/im`；
- 微信回复与附件发送；
- 飞书 PersonalAgent 注册；
- 飞书 WebSocket 通道；
- 前端统一连接 UI；
- 凭据保存位置；
- 平台特殊状态的归属。

### 13.3 差异矩阵

至少比较：

| 维度 | Gugu 当前 | Kun | 可复用 | 需要新增 |
|---|---|---|---|---|
| 安装 / 授权 |  |  |  |  |
| 凭据存储 |  |  |  |  |
| 通道生命周期 |  |  |  |  |
| 消息规范化 |  |  |  |  |
| Session |  |  |  |  |
| 权限 |  |  |  |  |
| 附件 |  |  |  |  |
| 多账号 |  |  |  |  |
| 重启恢复 |  |  |  |  |
| 日志与观测 |  |  |  |  |

### 13.4 方案比较

比较 A、B、C 三种方案：

- 修改文件范围；
- Schema 变化；
- 可以复用的模块；
- 新增模块；
- 迁移成本；
- 回归风险；
- 凭据安全；
- 平台扩展性；
- 开发时间；
- 技术债；
- 回滚能力。

给出明确推荐，不要只说“各有优缺点”。

### 13.5 最小落地计划

推荐方案需要拆成：

- P0：ADR 与事实审计；
- P1：微信二维码授权 PoC；
- P2：微信文本消息闭环；
- P3：凭据安全、恢复和解绑；
- P4：桌面产品入口和错误体验；
- P5：测试、Review、Smoke；
- P6：飞书扫码迁移评估。

每阶段说明：

- 目标；
- 文件；
- 接口；
- 测试；
- 验收；
- 风险；
- 是否可独立回滚。

---

## 14. 必须回答的关键问题

1. Gugu 当前的 `adapters/` 是否足够承载扫码授权后的长期消息通道？
2. 授权控制面应放在 Tauri、桌面 Node/Bun 服务，还是独立 Bridge？
3. 微信 Bridge 应作为 sidecar 内部模块，还是独立子进程？
4. `IncomingTextMessage` 是否足以承载微信消息？
5. `context_token` 应如何保存在微信 Adapter 内部？
6. 消息游标如何持久化并在重启后恢复？
7. 扫码取得的凭据如何安全保存并注入 sidecar？
8. 是否需要修改 `AdapterFileConfig`，还是只保存 credential reference？
9. 旧手工配置入口如何隐藏、兼容和最终废弃？
10. 微信连接是否能与现有飞书、企业微信同时运行？
11. 用户扫码后如何选择绑定哪个项目、会话或 Agent？
12. 长任务完成后如何把结果和文件发回原 IM 会话？
13. 官方平台资格、许可证和商业使用有哪些未确认项？
14. 当前源码里有没有任何 QQ 支持的真实证据？
15. 哪些旧代码应保留，哪些可在新链路稳定后删除？

---

## 15. 验收标准

### 微信首次连接

- 用户不需要手动创建 Bot 或填写 token；
- 二维码能生成、倒计时、过期和重试；
- 扫码完成后显示明确账号和连接状态；
- 凭据不进入 Renderer 和普通日志；
- 自动启动通道。

### 消息闭环

- 微信文本进入正确的 Gugu Session；
- 同一联系人消息保持顺序；
- 不同联系人不会因一个长任务互相阻塞；
- Agent 文本回复正确发回；
- 平台特有 token 不进入公共 Runtime；
- 重复消息有幂等或去重策略。

### 生命周期

- Gugu 重启后自动恢复；
- 网络断开后退避重连；
- 解绑后立即停止收发并清除凭据；
- 旧手工 Adapter 仍可回滚使用；
- 新旧入口不会创建重复通道。

### 安全

- secret 不写入普通明文配置，或 PoC 明确标注临时风险；
- 日志不记录完整 token；
- sidecar 只接收当前运行所需凭据；
- 本地授权接口不能被任意网页调用；
- 二维码安装会话有过期和取消。

### 测试

- 安装状态机单测；
- Adapter 重启恢复测试；
- 消息顺序测试；
- 解绑测试；
- 凭据脱敏测试；
- sidecar Smoke；
- Windows 打包环境下真机扫码测试。

---

## 16. 不允许的实施方式

- 不要直接复制 Kun 源码；
- 不要为了扫码新建第二套 SessionStore；
- 不要为了扫码新建第二套附件协议；
- 不要把微信 `context_token` 放到全局消息接口；
- 不要同时大改微信、飞书、企业微信和 Telegram；
- 不要在没有官方依据时承诺 QQ；
- 不要先删旧 IM，再验证新方案；
- 不要把二维码图片生成误认为核心难点；
- 不要让 Renderer 持有长期 secret；
- 不要只改 UI，不完成真实消息闭环；
- 不要把平台授权成功等同于商业接入资格已确认。

---

## 17. 推荐的最终决策格式

请用以下格式结束审计：

```text
推荐方案：
为什么：
复用哪些现有模块：
新增哪些模块：
停用哪些旧入口：
暂时保留哪些旧代码：
微信 PoC 预计工期：
最大技术风险：
最大平台合规风险：
第一步应修改 / 新增的文件：
开始编码前需要我确认的决策：
```

在我确认审计结果之前，不要修改生产代码。
