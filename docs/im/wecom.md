# 企业微信接入

> 企业微信接入面向企业管理员，不是普通用户一键登录。
> 当前支持的是自建应用回调：企业微信用户私聊应用，Adapter 接收回调消息，转发到本地 Gu Agent 会话，再通过企业微信应用消息接口回复。

## 适合谁使用

企业微信适合这些场景：

- 你有企业微信管理员权限。
- 你能创建或管理企业微信自建应用。
- 你能提供一个公网 HTTPS 回调地址，并转发到本机 Adapter。
- 你愿意维护 `Corp ID / Agent ID / Secret / Token / EncodingAESKey` 这组企业应用凭据。

如果只是个人用户，通常更建议先用 Telegram 或飞书。企业微信后台配置步骤更多，普通用户很难独立完成。

## 必填参数

为了达到“能聊天”的标准，企业微信不再支持只填群机器人 Webhook 作为可用配置。

必须填写：

| 字段 | 从哪里拿 | 用途 |
| --- | --- | --- |
| `corpId` | 企业微信管理后台企业信息 | 校验回调归属，并获取应用 access_token |
| `agentId` | 自建应用详情 | 指定由哪个企业微信应用收发消息 |
| `secret` | 自建应用详情 | 获取应用 access_token，用于发送回复 |
| `token` | 自建应用“接收消息”配置 | 校验企业微信回调签名 |
| `encodingAesKey` | 自建应用“接收消息”配置 | 解密企业微信回调消息 |

可选字段：

- `allowedUsers`：逗号分隔的企业微信 UserID 白名单。
- `defaultProjectDir`：默认项目目录。配置后用户发消息即可直接创建本地会话。

## 本地配置

配置文件位置：

```text
~/.claude/adapters.json
```

示例：

```json
{
  "serverUrl": "ws://127.0.0.1:3456",
  "defaultProjectDir": "/Users/dai/IdeaProjects/claude-code-gugu",
  "wecom": {
    "corpId": "wwxxxxxxxxxxxxxxxx",
    "agentId": "1000002",
    "secret": "xxxxxxxx",
    "token": "your-callback-token",
    "encodingAesKey": "43-character-encoding-aes-key",
    "allowedUsers": ["zhangsan"]
  }
}
```

也可以在桌面 App 的 `设置 -> IM 接入 -> 企业微信` 中填写。保存后同样会写入这个文件。

## 企业微信后台步骤

1. 进入企业微信管理后台，创建或打开一个自建应用。
2. 从企业信息和应用详情中复制 `Corp ID`、`Agent ID`、`Secret`。
3. 打开自建应用的“接收消息”配置。
4. 生成或填写 `Token` 和 `EncodingAESKey`。
5. 准备一个公网 HTTPS 回调地址，转发到本机 `3478` 端口。
6. 在企业微信后台填写回调 URL，例如：

```text
https://your-domain.example/wecom/events
```

本地 Adapter 默认监听：

```text
http://127.0.0.1:3478/wecom/events
```

如果你用 ngrok、cloudflared 或自己的反向代理，需要把公网 HTTPS 地址转发到这个本地地址。

## 启动本地 Adapter

先确认桌面 App 或本地服务已经启动。默认本地服务地址是：

```text
ws://127.0.0.1:3456
```

然后运行：

```bash
cd /Users/dai/IdeaProjects/claude-code-gugu/adapters
bun install
WECOM_CALLBACK_PORT=3478 ADAPTER_SERVER_URL=ws://127.0.0.1:3456 bun run wecom
```

启动成功会看到类似：

```text
[WeCom] Bot is running!
[WeCom] Server: ws://127.0.0.1:3456
[WeCom] Callback: http://127.0.0.1:3478/wecom/events
```

## 用户怎么聊天

1. 在桌面 App 的 `IM 接入` 里生成配对码。
2. 企业微信用户私聊这个自建应用，发送配对码。
3. 配对成功后，直接发送自然语言消息即可进入本地 Gu Agent 会话。

支持的文本命令：

- `/new [项目]`：新建会话或切换项目
- `/projects`：查看最近项目
- `/status`：查看当前会话状态
- `/clear`：清空当前会话上下文
- `/stop`：停止当前生成
- `/help`：显示帮助
- `截图` / `截屏` / `/screenshot`：截取本机当前屏幕并发回企业微信

权限请求会以文本形式返回。用户可以回复：

- `/allow <requestId>`：允许一次
- `/always <requestId>`：本次会话内永久允许相同操作
- `/deny <requestId>`：拒绝

## 为什么不支持群机器人 Webhook 作为入口

群机器人 Webhook 更像一个单向发送地址，无法完成“用户私聊 Bot -> 本地 Claude 会话 -> 回复同一用户”的闭环，也无法做用户配对和权限确认。

所以产品界面里不再把 Webhook URL 当成企业微信可聊天配置。要上线给普通用户看，必须以自建应用回调这条链路为准。
