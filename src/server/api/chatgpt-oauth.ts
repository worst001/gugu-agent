/**
 * ChatGPT OAuth REST API
 *
 * POST   /api/chatgpt-oauth/start     — start browser OAuth flow
 * POST   /api/chatgpt-oauth/device    — start device-code flow
 * POST   /api/chatgpt-oauth/provider  — ensure ChatGPT provider exists
 * GET    /api/chatgpt-oauth           — status, without token material
 * DELETE /api/chatgpt-oauth           — logout
 */

import { chatgptAuthService } from '../services/chatgptAuthService.js'
import { ProviderService } from '../services/providerService.js'
import { errorResponse } from '../middleware/errorHandler.js'

const providerService = new ProviderService()

export async function handleChatGPTOAuthApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (action === 'start' && req.method === 'POST') {
      const session = await chatgptAuthService.startBrowserSession()
      return Response.json(session)
    }

    if (action === 'device' && req.method === 'POST') {
      const session = await chatgptAuthService.startDeviceSession()
      return Response.json(session)
    }

    if (action === 'provider' && req.method === 'POST') {
      let activate = false
      try {
        const body = await req.json()
        activate =
          !!body &&
          typeof body === 'object' &&
          (body as Record<string, unknown>).activate === true
      } catch {
        // Empty body keeps the current default provider unchanged.
      }
      const provider = await providerService.ensureChatGPTProvider({ activate })
      return Response.json({ provider })
    }

    if ((action === undefined || action === 'status') && req.method === 'GET') {
      const tokens = await chatgptAuthService.ensureFreshTokens()
      if (!tokens) return Response.json({ loggedIn: false })
      return Response.json({
        loggedIn: true,
        expiresAt: tokens.expiresAt,
        accountId: tokens.accountId ?? null,
      })
    }

    if (action === undefined && req.method === 'DELETE') {
      await chatgptAuthService.deleteTokens()
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}
