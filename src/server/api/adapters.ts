/**
 * Adapters API — IM Adapter 配置读写
 *
 * GET  /api/adapters  → 返回配置（敏感字段脱敏）
 * PUT  /api/adapters  → 更新配置（浅合并），返回更新后的脱敏配置
 */

import { adapterService } from '../services/adapterService.js'
import {
  deleteWeixinCredentials,
  getWeixinRuntimeStatus,
  loadWeixinCredentials,
  updateWeixinRuntimeStatus,
  weixinInstallService,
} from '../services/weixinInstallService.js'
import { feishuInstallService } from '../services/feishuInstallService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const ALLOWED_TOP_KEYS = new Set([
  'serverUrl',
  'defaultProjectDir',
  'telegram',
  'feishu',
  'dingtalk',
  'wecom',
  'qq',
  'weixin',
  'pairing',
])

export async function handleAdaptersApi(
  req: Request,
  _url: URL,
  _segments: string[],
): Promise<Response> {
  try {
    const action = _segments[2]
    if (action === 'weixin') {
      return await handleWeixinApi(req, _segments)
    }
    if (action === 'feishu') {
      return await handleFeishuApi(req, _segments)
    }

    if (action === 'status') {
      if (req.method !== 'GET') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const diagnostics = await adapterService.getDiagnostics()
      return Response.json(diagnostics)
    }

    if (req.method === 'GET') {
      const config = await adapterService.getConfig()
      return Response.json(config)
    }

    if (req.method === 'PUT') {
      const body = (await req.json()) as Record<string, unknown>
      // Basic validation: only allow known top-level keys
      for (const key of Object.keys(body)) {
        if (!ALLOWED_TOP_KEYS.has(key)) {
          throw ApiError.badRequest(`Unknown config key: ${key}`)
        }
      }
      await adapterService.updateConfig(body)
      const config = await adapterService.getConfig()
      return Response.json(config)
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleFeishuApi(req: Request, segments: string[]): Promise<Response> {
  const resource = segments[3]
  const installationId = segments[4]

  if (resource === 'installations' && !installationId && req.method === 'POST') {
    return Response.json(await feishuInstallService.startInstallation(), {
      status: 201,
    })
  }

  if (resource === 'installations' && installationId) {
    if (req.method === 'GET') {
      return Response.json(
        feishuInstallService.getInstallation(installationId),
      )
    }
    if (req.method === 'DELETE') {
      return Response.json(
        feishuInstallService.cancelInstallation(installationId),
      )
    }
  }

  if (resource === 'connection' && req.method === 'GET') {
    return Response.json(await feishuInstallService.getConnection())
  }

  if (resource === 'connection' && req.method === 'DELETE') {
    await feishuInstallService.disconnect()
    return Response.json({ ok: true })
  }

  throw new ApiError(
    405,
    'Method ' + req.method + ' not allowed',
    'METHOD_NOT_ALLOWED',
  )
}

async function handleWeixinApi(req: Request, segments: string[]): Promise<Response> {
  const resource = segments[3]
  const installationId = segments[4]
  const subResource = segments[5]

  if (resource === 'installations' && !installationId && req.method === 'POST') {
    return Response.json(await weixinInstallService.startInstallation(), {
      status: 201,
    })
  }

  if (resource === 'installations' && installationId) {
    if (!subResource && req.method === 'GET') {
      return Response.json(
        await weixinInstallService.getInstallation(installationId),
      )
    }
    if (!subResource && req.method === 'DELETE') {
      return Response.json(
        weixinInstallService.cancelInstallation(installationId),
      )
    }
    if (subResource === 'verification' && req.method === 'POST') {
      const body = await req.json() as { code?: unknown }
      if (typeof body.code !== 'string') {
        throw ApiError.badRequest('WeChat verification code is required')
      }
      return Response.json(
        await weixinInstallService.submitVerification(installationId, body.code),
      )
    }
  }

  if (resource === 'runtime' && req.method === 'POST') {
    const body = await req.json() as Record<string, unknown>
    const allowedStates = new Set(['starting', 'online', 'degraded', 'offline'])
    if (typeof body.state !== 'string' || !allowedStates.has(body.state)) {
      throw ApiError.badRequest('Invalid WeChat runtime state')
    }
    if (body.lastPollAt !== undefined && typeof body.lastPollAt !== 'number') {
      throw ApiError.badRequest('Invalid WeChat lastPollAt')
    }
    if (body.error !== undefined && typeof body.error !== 'string') {
      throw ApiError.badRequest('Invalid WeChat runtime error')
    }
    return Response.json(updateWeixinRuntimeStatus({
      state: body.state as 'starting' | 'online' | 'degraded' | 'offline',
      ...(typeof body.lastPollAt === 'number'
        ? { lastPollAt: body.lastPollAt }
        : {}),
      ...(typeof body.error === 'string'
        ? { error: body.error.slice(0, 500) }
        : { error: null }),
    }))
  }

  if (resource === 'connection' && req.method === 'GET') {
    const credentials = await loadWeixinCredentials()
    return Response.json({
      connected: Boolean(credentials),
      accountId: credentials?.accountId ?? null,
      runtime: getWeixinRuntimeStatus(),
    })
  }

  if (resource === 'connection' && req.method === 'DELETE') {
    await deleteWeixinCredentials()
    updateWeixinRuntimeStatus({ state: 'offline', lastPollAt: null, error: null })
    let metadataCleaned = true
    try {
      await adapterService.updateConfig({
        weixin: {
          accountId: undefined,
          baseUrl: undefined,
          allowedUsers: [],
          pairedUsers: [],
        },
      })
    } catch (error) {
      metadataCleaned = false
      console.warn(
        '[WeChat] Credentials deleted but adapter metadata cleanup failed:',
        error instanceof Error ? error.message : String(error),
      )
    }
    return Response.json({ ok: true, metadataCleaned })
  }

  throw new ApiError(
    405,
    'Method ' + req.method + ' not allowed',
    'METHOD_NOT_ALLOWED',
  )
}
