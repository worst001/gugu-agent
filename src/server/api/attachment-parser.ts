import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  attachmentParserService,
  type AttachmentParserConfig,
} from '../services/attachmentParserService.js'

export async function handleAttachmentParserApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]
    if (sub === 'config') {
      if (req.method === 'GET') {
        return Response.json({ config: await attachmentParserService.getConfig() })
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        return Response.json({
          config: await attachmentParserService.updateConfig(body),
        })
      }
      return methodNotAllowed(req.method)
    }

    if (sub === 'test') {
      if (req.method !== 'POST') return methodNotAllowed(req.method)
      const body = await parseJsonBody(req)
      return Response.json({
        result: await attachmentParserService.testConfig(body),
      })
    }

    throw ApiError.notFound(`Unknown attachment parser endpoint: ${url.pathname}`)
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Partial<AttachmentParserConfig>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object'
      ? body as Partial<AttachmentParserConfig>
      : {}
  } catch {
    throw ApiError.badRequest('Invalid JSON in request body')
  }
}

function methodNotAllowed(method: string): Response {
  return Response.json(
    { error: 'METHOD_NOT_ALLOWED', message: `Method ${method} not allowed` },
    { status: 405 },
  )
}
