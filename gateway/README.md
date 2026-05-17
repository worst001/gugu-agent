# Gugu Gateway 部署说明

`gateway/` 是独立可部署的服务端目录。服务器上只需要安装 Bun，把本目录上传后配置环境变量即可运行。真实 DeepSeek / GLM Key 只放在服务器环境变量里，不进入桌面安装包。

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
    admin.ts        # 签发激活码、禁用激活码、调整设备额度
```

## 服务器准备

1. 安装 Bun。

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

2. 上传整个 `gateway/` 目录到服务器，例如：

```bash
scp -r gateway root@your-server:/opt/gugu-gateway
```

当前 Gateway 只依赖 Bun 内置能力和 `bun:sqlite`，没有额外 npm 依赖；上传后可以直接运行。

3. 准备 SQLite 数据目录：

```bash
mkdir -p /var/lib/gugu-gateway
```

## 配置环境变量

在服务器上进入目录：

```bash
cd /opt/gugu-gateway
cp .env.example .env
```

编辑 `.env`，至少填这几个：

```bash
GUGU_GATEWAY_HOST=0.0.0.0
GUGU_GATEWAY_PORT=8787
GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite
GUGU_FREE_CREDITS=50
GUGU_PURCHASE_URL=https://your-company.example.com/gugu-agent-buy
GUGU_DEEPSEEK_API_KEY=你的 DeepSeek Key
GUGU_GLM_API_KEY=你的 GLM Key
```

可选覆盖模型：

```bash
GUGU_DEEPSEEK_MODEL=deepseek-v4-pro
GUGU_DEEPSEEK_FAST_MODEL=deepseek-v4-flash
GUGU_DEEPSEEK_BASE_URL=https://api.deepseek.com/anthropic
GUGU_GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

## 本机启动验证

最稳妥的方式是显式指定 `.env`：

```bash
cd /opt/gugu-gateway
bun --env-file=.env run start
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

期望返回：

```json
{"ok":true}
```

注册一个测试设备：

```bash
curl -X POST http://127.0.0.1:8787/v1/devices \
  -H "Content-Type: application/json" \
  -d '{"platform":"linux","appVersion":"0.1.10"}'
```

返回里会有 `deviceToken` 和免费额度。后续请求用：

```text
Authorization: Bearer <deviceToken>
```

## 签发激活码

进入 `gateway/` 目录，并使用同一份 `.env`：

```bash
cd /opt/gugu-gateway
```

签发一个 Pro 激活码：

```bash
bun --env-file=.env run admin issue --plan pro --credits 1000 --max-activations 1
```

签发带过期时间的激活码：

```bash
bun --env-file=.env run admin issue --plan team --credits 5000 --expires 2027-01-01T00:00:00.000Z --max-activations 10
```

禁用激活码：

```bash
bun --env-file=.env run admin disable GUGU-XXXX
```

调整某个设备额度：

```bash
bun --env-file=.env run admin set-credits --device-token gugu_xxx --remaining 100 --total 1000
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

## Nginx 反向代理

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

配置 HTTPS 后，桌面端/本地服务使用：

```bash
CC_GUGU_GATEWAY_URL=https://gateway.example.com
```

## 桌面端连接 Gateway

用户电脑本地服务需要设置：

```bash
CC_GUGU_GATEWAY_URL=https://gateway.example.com
```

开发环境可用：

```powershell
$env:CC_GUGU_GATEWAY_URL="https://gateway.example.com"
bun run src/server/index.ts
```

正式安装包后续可以在启动脚本或应用配置里内置这个 Gateway URL。注意，只内置 Gateway URL，不内置 DeepSeek/GLM Key。

## 接口清单

- `GET /health`
- `POST /v1/devices`
- `GET /v1/entitlement`
- `POST /v1/activate`
- `POST /v1/messages`
- `POST /v1/attachments/parse`

## 故障排查

- `503 UPSTREAM_NOT_CONFIGURED`：服务器没有配置 `GUGU_DEEPSEEK_API_KEY` 或 `GUGU_GLM_API_KEY`。
- `401 UNAUTHORIZED`：设备 token 缺失或无效，客户端重新启动后会重新注册设备。
- `402 GUGU_QUOTA_EXHAUSTED`：免费额度或套餐额度已用完，需要购买或输入激活码。
- SQLite 文件无法创建：检查 `GUGU_GATEWAY_DB_PATH` 所在目录权限。

## 部署检查清单

- `.env` 已填写 DeepSeek 和 GLM Key。
- `/health` 返回 `{"ok":true}`。
- `POST /v1/devices` 能返回 `deviceToken`。
- Nginx/防火墙已开放公网访问。
- 桌面端配置了 `CC_GUGU_GATEWAY_URL=https://gateway.example.com`。
