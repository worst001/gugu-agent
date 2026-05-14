import { loadConfig } from '../common/config.js'

const config = loadConfig()
const hasOfficialBot = Boolean(config.qq.appId && config.qq.token)
const hasOneBotBridge = Boolean(config.qq.oneBotUrl)

if (!hasOfficialBot && !hasOneBotBridge) {
  console.error('[QQ] Missing QQ_APP_ID / QQ_TOKEN or QQ_ONEBOT_URL. Set env or ~/.claude/adapters.json')
  process.exitCode = 1
} else {
  console.log('[QQ] Configuration detected. Runtime connector scaffold is enabled.')
  console.log('[QQ] Official Bot and OneBot/NapCat message handlers will be wired in the next integration step.')
  setInterval(() => {}, 60_000)
}
