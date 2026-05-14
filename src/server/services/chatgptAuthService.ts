import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { setTimeout as sleep } from 'timers/promises'

export const CHATGPT_CODEX_API_ENDPOINT =
  'https://chatgpt.com/backend-api/codex/responses'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const OAUTH_PORT = 1455
const OAUTH_CALLBACK_PATH = '/auth/callback'
const OAUTH_CALLBACK_URL = `http://localhost:${OAUTH_PORT}${OAUTH_CALLBACK_PATH}`
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const DEVICE_POLLING_SAFETY_MARGIN_MS = 3000
const PENDING_BROWSER_SESSION_TTL_MS = 10 * 60 * 1000

type FetchFn = typeof fetch

type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type PkceCodes = {
  verifier: string
  challenge: string
}

type PendingBrowserSession = {
  state: string
  pkce: PkceCodes
  createdAt: number
}

export type StoredChatGPTTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
}

export type ChatGPTBrowserSession = {
  authorizeUrl: string
  state: string
  callbackUrl: string
}

export type ChatGPTDeviceSession = {
  authorizeUrl: string
  userCode: string
  deviceAuthId: string
  intervalMs: number
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(
  claims: IdTokenClaims,
): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  const claims = parseJwtClaims(tokens.access_token)
  return claims ? extractAccountIdFromClaims(claims) : undefined
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((byte) => chars[byte % chars.length])
    .join('')
}

async function generatePkce(): Promise<PkceCodes> {
  const verifier = randomString(43)
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function buildAuthorizeUrl(pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: OAUTH_CALLBACK_URL,
    scope: 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'cc-haha',
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

function renderCallbackPage(success: boolean, message: string): string {
  const color = success ? '#16a34a' : '#dc2626'
  const title = success ? 'ChatGPT Connected' : 'ChatGPT Connect Failed'
  const body = success
    ? 'You can close this window and return to Gugu Agent.'
    : message
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333}.card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{color:${color};margin:0 0 12px}pre{color:#666;white-space:pre-wrap;word-break:break-word;text-align:left;background:#f5f5f5;padding:12px;border-radius:6px}</style>
</head><body><div class="card"><h1>${title}</h1>${success ? `<p>${body}</p>` : `<pre>${escapeHtml(body)}</pre>`}</div>
${success ? '<script>setTimeout(() => window.close(), 1500)</script>' : ''}
</body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class ChatGPTAuthService {
  private fetchFn: FetchFn = fetch
  private oauthServer: ReturnType<typeof createServer> | null = null
  private pendingBrowserSession: PendingBrowserSession | null = null

  setFetchFn(fn: FetchFn): void {
    this.fetchFn = fn
  }

  private getTokenFilePath(): string {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(configDir, 'cc-haha', 'chatgpt-oauth.json')
  }

  async loadTokens(): Promise<StoredChatGPTTokens | null> {
    try {
      const raw = await fs.readFile(this.getTokenFilePath(), 'utf-8')
      return JSON.parse(raw) as StoredChatGPTTokens
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveTokens(tokens: StoredChatGPTTokens): Promise<void> {
    const filePath = this.getTokenFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    await fs.rename(tmp, filePath)
  }

  async deleteTokens(): Promise<void> {
    try {
      await fs.unlink(this.getTokenFilePath())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async startBrowserSession(): Promise<ChatGPTBrowserSession> {
    if (
      this.pendingBrowserSession &&
      Date.now() - this.pendingBrowserSession.createdAt < PENDING_BROWSER_SESSION_TTL_MS
    ) {
      return {
        authorizeUrl: buildAuthorizeUrl(
          this.pendingBrowserSession.pkce,
          this.pendingBrowserSession.state,
        ),
        state: this.pendingBrowserSession.state,
        callbackUrl: OAUTH_CALLBACK_URL,
      }
    }
    this.pendingBrowserSession = null
    await this.startOAuthServer()
    const pkce = await generatePkce()
    const state = generateState()
    this.pendingBrowserSession = {
      pkce,
      state,
      createdAt: Date.now(),
    }
    return {
      authorizeUrl: buildAuthorizeUrl(pkce, state),
      state,
      callbackUrl: OAUTH_CALLBACK_URL,
    }
  }

  async startDeviceSession(): Promise<ChatGPTDeviceSession> {
    const response = await this.fetchFn(
      `${ISSUER}/api/accounts/deviceauth/usercode`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'cc-haha',
        },
        body: JSON.stringify({ client_id: CLIENT_ID }),
      },
    )
    if (!response.ok) {
      throw new Error(`Failed to initiate device authorization: ${response.status}`)
    }
    const data = (await response.json()) as {
      device_auth_id: string
      user_code: string
      interval: string
    }
    const intervalMs = Math.max(Number.parseInt(data.interval, 10) || 5, 1) * 1000
    return {
      authorizeUrl: `${ISSUER}/codex/device`,
      userCode: data.user_code,
      deviceAuthId: data.device_auth_id,
      intervalMs,
    }
  }

  async completeDeviceSession(
    session: ChatGPTDeviceSession,
    options?: { timeoutMs?: number },
  ): Promise<StoredChatGPTTokens> {
    const startedAt = Date.now()
    const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000
    while (Date.now() - startedAt < timeoutMs) {
      const response = await this.fetchFn(
        `${ISSUER}/api/accounts/deviceauth/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'cc-haha',
          },
          body: JSON.stringify({
            device_auth_id: session.deviceAuthId,
            user_code: session.userCode,
          }),
        },
      )
      if (response.ok) {
        const data = (await response.json()) as {
          authorization_code: string
          code_verifier: string
        }
        const tokens = await this.exchangeCodeForTokens(
          data.authorization_code,
          `${ISSUER}/deviceauth/callback`,
          { verifier: data.code_verifier, challenge: '' },
        )
        return this.storeTokenResponse(tokens)
      }
      if (response.status !== 403 && response.status !== 404) {
        throw new Error(`Device authorization failed: ${response.status}`)
      }
      await sleep(session.intervalMs + DEVICE_POLLING_SAFETY_MARGIN_MS)
    }
    throw new Error('Device authorization timed out')
  }

  async ensureFreshTokens(): Promise<StoredChatGPTTokens | null> {
    const tokens = await this.loadTokens()
    if (!tokens) return null
    if (tokens.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return tokens
    }
    if (!tokens.refreshToken) return null

    try {
      const refreshed = await this.refreshAccessToken(tokens.refreshToken)
      return await this.storeTokenResponse(refreshed, tokens.accountId)
    } catch (err) {
      console.error(
        '[ChatGPTAuthService] token refresh failed:',
        err instanceof Error ? err.message : err,
      )
      return null
    }
  }

  async ensureFreshAccessToken(): Promise<string | null> {
    const tokens = await this.ensureFreshTokens()
    return tokens?.accessToken ?? null
  }

  private async startOAuthServer(): Promise<void> {
    if (this.oauthServer) return
    this.oauthServer = createServer((req, res) => {
      void this.handleOAuthRequest(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      this.oauthServer!.once('error', reject)
      this.oauthServer!.listen(OAUTH_PORT, () => {
        this.oauthServer!.off('error', reject)
        resolve()
      })
    })
  }

  private stopOAuthServer(): void {
    if (!this.oauthServer) return
    this.oauthServer.close()
    this.oauthServer = null
  }

  private async handleOAuthRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${OAUTH_PORT}`)
    if (url.pathname === '/cancel') {
      this.pendingBrowserSession = null
      this.stopOAuthServer()
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Login cancelled')
      return
    }
    if (url.pathname !== OAUTH_CALLBACK_PATH) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const error = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (error) {
      this.pendingBrowserSession = null
      this.stopOAuthServer()
      this.writeHtml(res, false, errorDescription || error)
      return
    }
    if (!code || !state) {
      this.writeHtml(res, false, 'Missing authorization code or state')
      return
    }
    const pending = this.pendingBrowserSession
    if (!pending || pending.state !== state) {
      this.writeHtml(res, false, 'Invalid state - potential CSRF attack')
      return
    }

    this.pendingBrowserSession = null
    try {
      const tokens = await this.exchangeCodeForTokens(
        code,
        OAUTH_CALLBACK_URL,
        pending.pkce,
      )
      await this.storeTokenResponse(tokens)
      this.writeHtml(res, true, '')
    } catch (err) {
      this.writeHtml(res, false, err instanceof Error ? err.message : String(err))
    } finally {
      this.stopOAuthServer()
    }
  }

  private writeHtml(
    res: ServerResponse,
    success: boolean,
    message: string,
  ): void {
    res.writeHead(success ? 200 : 400, {
      'Content-Type': 'text/html; charset=utf-8',
    })
    res.end(renderCallbackPage(success, message))
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    pkce: PkceCodes,
  ): Promise<TokenResponse> {
    const response = await this.fetchFn(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        code_verifier: pkce.verifier,
      }).toString(),
    })
    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`)
    }
    return (await response.json()) as TokenResponse
  }

  private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const response = await this.fetchFn(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    })
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`)
    }
    return (await response.json()) as TokenResponse
  }

  private async storeTokenResponse(
    response: TokenResponse,
    existingAccountId?: string,
  ): Promise<StoredChatGPTTokens> {
    const accountId = extractAccountId(response) || existingAccountId
    const tokens: StoredChatGPTTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
      ...(accountId ? { accountId } : {}),
    }
    await this.saveTokens(tokens)
    return tokens
  }
}

export const chatgptAuthService = new ChatGPTAuthService()
