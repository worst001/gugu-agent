import { loadConfig } from '../common/config.js'

const config = loadConfig()
const hasAppCredentials = Boolean(config.wecom.corpId && config.wecom.agentId && config.wecom.secret)
const hasWebhook = Boolean(config.wecom.webhookUrl)

if (!hasAppCredentials && !hasWebhook) {
  console.error('[WeCom] Missing WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET or WECOM_WEBHOOK_URL. Set env or ~/.claude/adapters.json')
  process.exitCode = 1
} else {
  console.log('[WeCom] Configuration detected. Runtime connector scaffold is enabled.')
  console.log('[WeCom] Event receive/send handlers still require WeCom callback credentials and will be wired in the next integration step.')
  setInterval(() => {}, 60_000)
}
