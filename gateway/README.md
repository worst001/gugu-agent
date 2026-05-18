# Gugu Gateway 单服务器部署说明

`gateway/` 是 Gugu Agent 内测订阅服务端。内测阶段只需要一台服务器运行 Bun + SQLite：

- DeepSeek V4 Key、GLM Key、设备、额度、激活码、用量扣减都在服务器里。
- 桌面端只内置 Gateway URL，不内置任何真实模型 Key。
- 管理端不暴露 HTTP 后台，管理员通过 SSH 执行 CLI 签发激活码、查设备、查用量、调额度。

## 目录结构

```text
gateway/
  package.json
  .env.example
  README.md
  src/
    index.ts        # HTTP 服务入口
    config.ts       # 环境变量配置
    store.ts        # SQLite 设备、额度、激活码、用量
    types.ts
    __tests__/
  scripts/
    admin.ts        # 服务器 SSH 管理 CLI
```

## 服务器准备

1. 安装 Bun。

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

2. 上传整个 `gateway/` 目录。

```bash
scp -r gateway root@your-server:/opt/gugu-gateway
```

3. 创建 SQLite 数据目录。

```bash
mkdir -p /var/lib/gugu-gateway
```

当前 Gateway 只使用 Bun 内置能力和 `bun:sqlite`，不需要额外 `npm install`。

## 环境变量

```bash
cd /opt/gugu-gateway
cp .env.example .env
```

编辑 `.env`：

```bash
GUGU_GATEWAY_HOST=0.0.0.0
GUGU_GATEWAY_PORT=8787
GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite

GUGU_FREE_CREDITS=50
GUGU_PURCHASE_URL=https://your-company.example.com/gugu-agent-buy

GUGU_DEEPSEEK_API_KEY=你的 DeepSeek Key
GUGU_DEEPSEEK_BASE_URL=https://api.deepseek.com/anthropic
GUGU_DEEPSEEK_MODEL=deepseek-v4-pro
GUGU_DEEPSEEK_FAST_MODEL=deepseek-v4-flash

GUGU_GLM_API_KEY=你的 GLM Key
GUGU_GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

`GUGU_FREE_CREDITS` 是新设备首次注册的免费额度。`GUGU_PURCHASE_URL` 会显示在桌面端订阅页的购买按钮里。

## 本机启动验证

```bash
cd /opt/gugu-gateway
bun --env-file=.env run start
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

注册测试设备：

```bash
curl -X POST http://127.0.0.1:8787/v1/devices \
  -H "Content-Type: application/json" \
  -d '{"platform":"linux","appVersion":"0.1.10"}'
```

返回里会有 `deviceToken`、套餐、总额度、剩余额度、购买链接。后续请求都带：

```text
Authorization: Bearer <deviceToken>
```

## systemd 常驻运行

创建服务文件：

```bash
cat >/etc/systemd/system/gugu-gateway.service <<'EOF'
[Unit]
Description=Gugu Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gugu-gateway
EnvironmentFile=/opt/gugu-gateway/.env
ExecStart=/root/.bun/bin/bun run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

启动：

```bash
systemctl daemon-reload
systemctl enable --now gugu-gateway
systemctl status gugu-gateway
journalctl -u gugu-gateway -f
```

## Nginx 和 HTTPS

示例：

```nginx
server {
    listen 80;
    server_name gateway.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

生产内测包建议使用 HTTPS 域名，例如：

```text
https://gateway.example.com
```

## 管理员 CLI

所有管理命令都在服务器 SSH 内执行，不对公网开放管理接口。

签发 Pro 激活码：

```bash
cd /opt/gugu-gateway
bun --env-file=.env run admin issue --plan pro --credits 1000 --max-activations 1
```

签发 Team 激活码并设置过期时间：

```bash
bun --env-file=.env run admin issue --plan team --credits 5000 --expires 2027-01-01T00:00:00.000Z --max-activations 10
```

禁用激活码：

```bash
bun --env-file=.env run admin disable GUGU-XXXX
```

查询设备：

```bash
bun --env-file=.env run admin device --device-token gugu_xxx
bun --env-file=.env run admin device --device-id device-uuid
```

查询用量：

```bash
bun --env-file=.env run admin usage --device-token gugu_xxx --limit 50
bun --env-file=.env run admin usage --device-id device-uuid --limit 50
```

调整设备额度：

```bash
bun --env-file=.env run admin set-credits --device-token gugu_xxx --remaining 100 --total 1000
bun --env-file=.env run admin set-credits --device-id device-uuid --remaining 100 --total 1000
```

## 桌面端接入

桌面本地后端读取 Gateway URL 的优先级：

1. `CC_GUGU_GATEWAY_URL`
2. `GUGU_GATEWAY_URL`
3. `GUGU_DESKTOP_DEFAULT_GATEWAY_URL`

开发时可以直接设置运行时变量：

```powershell
$env:CC_GUGU_GATEWAY_URL="https://gateway.example.com"
bun run src/server/index.ts
```

内测安装包应在构建时注入默认 Gateway URL。Windows 示例：

```powershell
cd desktop
$env:GUGU_DESKTOP_DEFAULT_GATEWAY_URL="https://gateway.example.com"
bun run build:windows-x64
```

macOS 示例：

```bash
cd desktop
GUGU_DESKTOP_DEFAULT_GATEWAY_URL=https://gateway.example.com bun run build:macos-arm64
```

这个变量只会把 Gateway URL 写入桌面启动 sidecar 的环境变量，不会把 DeepSeek/GLM Key 打进安装包。

## HTTP 接口

- `GET /health`
- `POST /v1/devices`
- `GET /v1/entitlement`
- `POST /v1/activate`
- `POST /v1/messages`
- `POST /v1/attachments/parse`

额度耗尽统一返回：

```json
{
  "error": {
    "code": "GUGU_QUOTA_EXHAUSTED",
    "message": "Included credits have been used up. Purchase or activate a plan to continue.",
    "entitlement": {
      "status": "quota_exhausted",
      "plan": "free",
      "expiresAt": null,
      "creditsTotal": 50,
      "creditsRemaining": 0,
      "isTrial": true,
      "purchaseUrl": "https://your-company.example.com/gugu-agent-buy",
      "message": "Included credits have been used up. Purchase or activate a plan to continue.",
      "reason": "quota_exhausted"
    }
  }
}
```

桌面端收到 `402 GUGU_QUOTA_EXHAUSTED` 后会停止等待状态，并提示用户购买或输入激活码。

## 故障排查

- `503 UPSTREAM_NOT_CONFIGURED`：服务器没有配置 `GUGU_DEEPSEEK_API_KEY` 或 `GUGU_GLM_API_KEY`。
- `401 UNAUTHORIZED`：设备 token 缺失或无效，客户端重启后会重新注册设备。
- `402 GUGU_QUOTA_EXHAUSTED`：免费额度或套餐额度已用完，需要购买或输入激活码。
- 订阅页显示 `check_failed`：桌面端能读到 Gateway URL，但无法连通 Gateway，检查域名、HTTPS、Nginx、端口和防火墙。
- SQLite 文件无法创建：检查 `GUGU_GATEWAY_DB_PATH` 所在目录权限。

## 内测上线检查

- `.env` 已填写 DeepSeek 和 GLM Key。
- `/health` 返回 `{"ok":true}`。
- `POST /v1/devices` 能返回 `deviceToken` 和免费额度。
- Nginx/HTTPS/防火墙已允许公网访问。
- 桌面构建时设置了 `GUGU_DESKTOP_DEFAULT_GATEWAY_URL=https://gateway.example.com`。
- 新机器安装后无配置即可发起一轮对话。
- 免费额度耗尽后被 `402` 拦截。
- 管理员签发激活码后，用户在订阅页填码能继续使用。
