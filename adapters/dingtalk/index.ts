import { loadConfig } from '../common/config.js'

const config = loadConfig()
const hasAppCredentials = Boolean(config.dingtalk.clientId && config.dingtalk.clientSecret)
const hasWebhook = Boolean(config.dingtalk.webhookUrl)

if (!hasAppCredentials && !hasWebhook) {
  console.error('[DingTalk] Missing DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET or DINGTALK_WEBHOOK_URL. Set env or ~/.claude/adapters.json')
  process.exitCode = 1
} else {
  console.log('[DingTalk] Configuration detected. Runtime connector scaffold is enabled.')
  console.log('[DingTalk] Event receive/send handlers still require DingTalk callback credentials and will be wired in the next integration step.')
  setInterval(() => {}, 60_000)
}
