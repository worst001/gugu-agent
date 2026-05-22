# 钉钉接入

> 钉钉使用 Stream 模式接入机器人消息。
> 相比 Webhook 回调，Stream 模式不需要你准备公网 HTTPS 地址，更适合作为普通用户可用的本地接入方式。

## 适合谁使用

钉钉接入适合这些场景：

- 你能在钉钉开放平台创建企业内部应用。
- 你能为应用添加机器人能力，并选择 Stream 模式。
- 你希望用户在钉钉里给机器人发消息，再由本机 Gu Agent 回复。

## 必填参数

| 字段 | 从哪里拿 | 用途 |
| --- | --- | --- |
| `clientId` | 钉钉开放平台应用凭据 | 连接钉钉 Stream 网关 |
| `clientSecret` | 钉钉开放平台应用凭据 | 获取 Stream 连接凭据 |

可选字段：

- `robotCode`：如果一个应用里有多个机器人，可以用它过滤指定机器人。
- `allowedUsers`：逗号分隔的钉钉员工 ID 白名单。
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
  "dingtalk": {
    "clientId": "dingxxxx",
    "clientSecret": "xxxxxxxx",
    "robotCode": "dingxxxx",
    "allowedUsers": ["staff_001"]
  }
}
```

也可以在桌面 App 的 `设置 -> IM 接入 -> 钉钉` 中填写。

## 两个“钉钉”先分清

接入时会同时用到两个地方：

- **钉钉开放平台（网页）**：用来创建企业内部应用、复制凭据、添加机器人能力、开启 Stream 模式、发布并安装应用。
- **钉钉 App（手机/电脑聊天）**：用来私聊机器人、发送配对码、发送“你好”测试真实聊天。

## 钉钉开放平台步骤

入口：[钉钉开放平台](https://open.dingtalk.com/)

1. 登录钉钉开放平台，进入 `应用开发 -> 企业内部应用`。
2. 创建或打开一个企业内部应用，应用名称建议填 `Gu Agent`。
3. 进入 `凭证与基础信息`，复制 `Client ID` 和 `Client Secret`。
   - `Client ID` 在 Stream SDK 里也对应 `AppKey`。
   - `Client Secret` 在 Stream SDK 里也对应 `AppSecret`。
4. 进入 `应用能力 -> 添加应用能力`，添加 `机器人`。
   - 这里要用企业内部应用里的应用机器人。
   - 不要用普通群机器人的 Webhook 地址。
5. 在机器人消息接收模式里选择 `Stream`。
   - 不要选择 `Outgoing Webhook` 或 HTTP 回调。
   - Stream 模式不需要公网 HTTPS URL。
6. 发布并安装应用到当前企业/组织。
   - 修改机器人能力或接收模式后，通常需要重新发布。
   - 未发布或未安装时，钉钉 App 里可能看不到机器人，或者机器人收不到消息。

如果后台展示 `Robot Code`，可以复制到桌面 App 的 `Robot Code` 字段。一个应用只有一个机器人时可先留空；一个应用里有多个机器人时建议填写。

## 本机 Gu Agent 步骤

推荐在桌面 App 里完成，不需要用户手动打开终端：

1. 打开 `设置 -> IM 接入 -> 钉钉`。
2. 填写 `Client ID` 和 `Client Secret`。
3. 可选填写 `Robot Code`。
4. 点击页面底部 `保存`。
5. 展开 `钉钉接入检查清单`，点击 `启动/重启本地接入`。
6. 在页面下方 `配对管理` 里点击 `生成配对码`。
7. 打开钉钉 App，私聊 Gu Agent 机器人，发送这 6 位配对码。
8. 看到配对成功后，发送 `你好` 测试文字聊天。

## 启动本地 Adapter

桌面 App 会优先通过按钮启动本地接入。下面的命令只用于开发者手动调试。

先确认桌面 App 或本地服务已经启动。默认本地服务地址是：

```text
ws://127.0.0.1:3456
```

然后运行：

```bash
cd /Users/dai/IdeaProjects/claude-code-gugu/adapters
bun install
ADAPTER_SERVER_URL=ws://127.0.0.1:3456 bun run dingtalk
```

启动成功会看到类似：

```text
[DingTalk] Bot is running! (Stream connected)
```

## 用户怎么聊天

1. 在桌面 App 的 `IM 接入` 里生成配对码。
2. 钉钉用户私聊机器人，发送配对码。
3. 配对成功后，直接发送自然语言消息即可进入本地 Gu Agent 会话。

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

- 当前钉钉 Stream adapter 先保证文字聊天闭环。
- 回复使用钉钉机器人消息里的 `sessionWebhook`，适合正常对话回包。
- 图片/文件和截图回发需要额外媒体链路，未打通前不要作为正式卖点展示。
- 群聊场景建议先配 `allowedUsers` 或配对码，避免误触发本地 Gu Agent 会话。

## 常见问题

### 发送配对码没有回复

按顺序检查：

1. `Client ID` / `Client Secret` 是否来自同一个钉钉应用。
2. 机器人是否选择了 `Stream` 模式。
3. 应用是否已经发布并安装到当前企业/组织。
4. 桌面 App 里是否已经点击 `启动/重启本地接入`。
5. 如果填写了 `Robot Code`，先清空保存再测试，避免机器人编号不匹配被过滤。

### 一直显示正在思考

这通常说明消息已经到达本机，但本地会话没有正常返回：

1. 先确认桌面 App 里普通聊天可用。
2. 点击 `启动/重启本地接入`。
3. 确认 `默认项目` 已设置，或者会话里已选择项目。
4. 查看本地接入日志是否有凭据、网络或会话错误。
