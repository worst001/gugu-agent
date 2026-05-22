# QQ 接入

QQ 支持两条可聊天路径，当前已接入文字、图片和文件：

- **QQ 官方 Bot WebSocket**：正规发布路径，适合产品化和灰度。
- **OneBot/NapCat 本地桥**：个人本地测试路径，需要自己运行 QQ 桥接程序，不建议作为公开产品主路径。

> 当前本地版适合自用或小范围灰度测试。要让大量普通用户直接使用，后续更适合做统一服务端中转，而不是让每个用户都创建自己的 QQ Bot。

## 选择哪种方式

| 方式 | 适合谁 | 必填 |
| --- | --- | --- |
| QQ 官方 Bot | 有 QQ 开放平台机器人资质、希望正规发布 | `appId`、`appSecret` |
| OneBot/NapCat | 个人本地测试或自用 | `oneBotUrl`，可选 `oneBotAccessToken` |

媒体能力边界：

- 收到 QQ 图片/文件后，会先下载到本机临时目录，再交给本地 Gu Agent 处理。
- 发送“截图给我”会调用本机截图能力，并把截图作为 QQ 图片回复。
- QQ 官方 Bot 可直接回复图片、音频、视频；通用文件发送受 QQ 平台/SDK 能力限制，当前会退回为“文件已生成，本机路径如下”。
- OneBot/NapCat 可尝试走 `upload_private_file` / `upload_group_file` 发送通用文件，但是否成功取决于具体 OneBot 实现。
- QQ 目前没有像飞书“流式卡片”那样稳定的原生流式更新能力；默认采用最终回复，不建议用频繁分段/撤回重发模拟流式。

## A. 官方 QQ Bot 操作步骤

### 1. 进入 QQ 机器人开放平台

打开 [QQ 机器人开放平台](https://q.qq.com/qqbot/#/developer/developer-setting)，按页面提示完成个人或企业主体入驻。

### 2. 创建机器人

1. 点击“创建机器人”。
2. 填写机器人头像、名称、简介等基础资料。
3. 提交后会生成 `AppID`，点击对应机器人进入管理端。

### 3. 复制 AppID / AppSecret

进入“开发设置 / 开发基础设置”，复制：

- `AppID`：填到 Gugu Agent 的 `QQ App ID`。
- `AppSecret`：填到 Gugu Agent 的 `App Secret`。
- `Token`：兼容旧字段；如果已经填 `AppSecret`，通常不用再填。

请不要把这些凭据发给用户，也不要写进公开仓库。

### 4. 先配置沙箱

建议先用沙箱测试，不要一开始就走正式上线。

1. 进入 QQ 机器人管理端的“沙箱配置”。
2. 把自己的 QQ 号加入沙箱单聊或沙箱私信账号。
3. 如果要测群聊，创建一个不超过 20 人、自己是群主或管理员的群，并加入沙箱群。
4. 回到 Gugu Agent 的 QQ 页，勾选“沙箱环境”。

### 5. 正式环境确认 IP 白名单

正式环境可能要求固定公网出口 IP。沙箱通常不受这个限制。

如果正式环境连接失败，但沙箱能通，优先检查：

- QQ 管理端“开发基础设置 / IP 白名单配置”是否添加了运行本地接入的公网出口 IP。
- 家庭网络公网 IP 是否变化。
- 是否需要改为固定服务器或统一中转服务。

### 6. 发布上线与使用范围

要让普通 QQ 用户添加机器人，需要完成：

1. 自测报告。
2. 提交审核。
3. 审核通过后上线。
4. 在“使用范围与人员”里配置消息列表单聊、QQ群、QQ频道等场景。

白名单模式适合灰度；全量开放适合审核通过后的公开分发。

## B. 本机 Gugu Agent 配置

配置文件位置：

```text
~/.claude/adapters.json
```

QQ 官方 Bot 示例：

```json
{
  "serverUrl": "ws://127.0.0.1:3456",
  "defaultProjectDir": "/Users/dai/IdeaProjects/claude-code-gugu",
  "qq": {
    "appId": "1020xxxx",
    "appSecret": "xxxxxxxx",
    "sandbox": false,
    "allowedUsers": ["123456789"]
  }
}
```

OneBot/NapCat 示例：

```json
{
  "serverUrl": "ws://127.0.0.1:3456",
  "defaultProjectDir": "/Users/dai/IdeaProjects/claude-code-gugu",
  "qq": {
    "oneBotUrl": "ws://127.0.0.1:3001",
    "oneBotAccessToken": "optional-token"
  }
}
```

也可以在桌面 App 的 `设置 -> IM 接入 -> QQ` 中填写。

### 官方 Bot 填写方式

1. 填写 `QQ App ID`。
2. 填写 `App Secret`。
3. 沙箱测试时勾选“沙箱环境”。
4. 点击“保存”。
5. 点击“启动/重启本地接入”。
6. 配对成功后，先发送“你好”测试文字，再发送一张图片或一个文件测试附件，最后发送“截图给我”测试图片回复。

### OneBot/NapCat 填写方式

1. 在本机启动 NapCat 或其他 OneBot v11 兼容程序。
2. 登录测试 QQ。
3. 开启 WebSocket 服务，例如 `ws://127.0.0.1:3001`。
4. 把地址填到 Gugu Agent 的 `OneBot 地址`。
5. 如果配置了 access token，也同步填入 `OneBot Access Token`。
6. 点击“保存”。
7. 点击“启动/重启本地接入”。
8. 配对成功后，先发送“你好”测试文字，再发送一张图片或一个文件测试附件，最后发送“截图给我”测试图片回复。

## 启动本地 Adapter

桌面 App 里可以直接点“启动/重启本地接入”，普通用户不需要打开终端。

如果你要用命令行排查，先确认桌面 App 或本地服务已经启动。默认本地服务地址是：

```text
ws://127.0.0.1:3456
```

然后运行：

```bash
cd /Users/dai/IdeaProjects/claude-code-gugu/adapters
bun install
ADAPTER_SERVER_URL=ws://127.0.0.1:3456 bun run qq
```

启动成功会看到：

```text
[QQ] Bot is running! (WebSocket connected)
```

或：

```text
[QQ OneBot] Bot is running! (WebSocket connected)
```

## 用户怎么聊天

1. 在桌面 App 的 `IM 接入` 里生成配对码。
2. 在 QQ App 里私聊机器人，发送这 6 位配对码。
3. 配对成功后，发送“你好”测试文字聊天。
4. 后续直接发送自然语言消息即可进入本地 Gu Agent 会话。

群聊也可以接入，但建议用白名单或群 ID 授权，例如：

```text
group:987654321
```

支持的文本命令：

- `/new [项目]`：新建会话或切换项目
- `/projects`：查看最近项目
- `/status`：查看当前会话状态
- `/clear`：清空当前会话上下文
- `/stop`：停止当前生成
- `/help`：显示帮助

权限请求会以文本形式返回。用户可以回复：

- `/allow <requestId>`：允许一次
- `/always <requestId>`：本次会话内永久允许相同操作
- `/deny <requestId>`：拒绝

## 当前边界

- 当前只处理文本消息。
- 官方 Bot 路径依赖 QQ 开放平台权限、沙箱配置、IP 白名单和审核结果。
- OneBot/NapCat 路径适合本地自用，面向公开产品时需要额外考虑合规和安装门槛。
- 一个 QQ Bot 凭据只建议绑定一台本机接入；多用户产品形态后续应考虑统一服务端中转。
