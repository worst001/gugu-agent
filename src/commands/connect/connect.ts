import { chatgptAuthService } from '../../server/services/chatgptAuthService.js'
import { ProviderService } from '../../server/services/providerService.js'
import { openBrowser } from '../../utils/browser.js'
import type { LocalCommandResult } from '../../types/command.js'
import type { SavedProvider } from '../../server/types/provider.js'

const POLL_INTERVAL_MS = 2_000
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const PROXY_HOST = '127.0.0.1'
const PROXY_PORT = Number.parseInt(process.env.SERVER_PORT || '3456', 10)

export async function call(args: string): Promise<LocalCommandResult> {
  const useDeviceFlow = args.split(/\s+/).includes('--device')
  const providerService = new ProviderService()

  if (useDeviceFlow) {
    const session = await chatgptAuthService.startDeviceSession()
    const opened = await openBrowser(session.authorizeUrl)
    const tokens = await chatgptAuthService.completeDeviceSession(session, {
      timeoutMs: LOGIN_TIMEOUT_MS,
    })
    const provider = await providerService.ensureChatGPTProvider()
    const proxyStatus = await prepareCurrentTuiRuntime(providerService, provider)
    return {
      type: 'text',
      value: [
        'ChatGPT connected successfully.',
        `Device code: ${session.userCode}`,
        opened ? 'Opened browser for device authorization.' : `Open ${session.authorizeUrl} and enter the code above.`,
        `Activated provider: ${provider.name}`,
        `Account: ${tokens.accountId ?? 'unknown'}`,
        `Model: ${provider.models.main}`,
        proxyStatus,
      ].join('\n'),
    }
  }

  const session = await chatgptAuthService.startBrowserSession()
  const opened = await openBrowser(session.authorizeUrl)
  const startedAt = Date.now()

  while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
    const tokens = await chatgptAuthService.ensureFreshTokens()
    if (tokens) {
      const provider = await providerService.ensureChatGPTProvider()
      const proxyStatus = await prepareCurrentTuiRuntime(providerService, provider)
      return {
        type: 'text',
        value: [
          'ChatGPT connected successfully.',
          opened
            ? 'Opened browser for authorization.'
            : `Open this URL to authorize: ${session.authorizeUrl}`,
          `Activated provider: ${provider.name}`,
          `Account: ${tokens.accountId ?? 'unknown'}`,
          `Model: ${provider.models.main}`,
          proxyStatus,
        ].join('\n'),
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  return {
    type: 'text',
    value: [
      'ChatGPT authorization is still pending.',
      opened
        ? 'Finish the browser flow, then run /connect again if the provider is not active.'
        : `Open this URL to authorize: ${session.authorizeUrl}`,
    ].join('\n'),
  }
}

async function prepareCurrentTuiRuntime(
  providerService: ProviderService,
  provider: SavedProvider,
): Promise<string> {
  ProviderService.setServerPort(PROXY_PORT)
  const serverStatus = await ensureLocalProxyServer()
  const env = await providerService.getProviderRuntimeEnv(provider.id)

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }
  delete process.env.ANTHROPIC_AUTH_TOKEN

  return `${serverStatus}\nCurrent TUI process is now using ${env.ANTHROPIC_MODEL} via ${env.ANTHROPIC_BASE_URL}`
}

async function ensureLocalProxyServer(): Promise<string> {
  if (await isLocalProxyHealthy()) {
    return `Local proxy server is already running at http://${PROXY_HOST}:${PROXY_PORT}`
  }

  try {
    const { startServer } = await import('../../server/index.js')
    startServer(PROXY_PORT, PROXY_HOST)
  } catch (err) {
    if (await isLocalProxyHealthy()) {
      return `Local proxy server is already running at http://${PROXY_HOST}:${PROXY_PORT}`
    }
    return `Warning: could not start local proxy server on ${PROXY_HOST}:${PROXY_PORT}: ${err instanceof Error ? err.message : String(err)}`
  }

  return `Started local proxy server at http://${PROXY_HOST}:${PROXY_PORT}`
}

async function isLocalProxyHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return response.ok
  } catch {
    return false
  }
}
