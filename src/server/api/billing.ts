import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { billingService } from '../services/billingService.js'

export async function handleBillingApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    switch (sub) {
      case 'status':
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return Response.json(await billingService.getStatus())

      case 'config':
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return Response.json(await billingService.getConfig())

      case 'license':
        if (req.method === 'PUT') {
          const body = await parseJsonBody(req)
          if (typeof body.licenseKey !== 'string') {
            throw ApiError.badRequest('licenseKey is required')
          }
          return Response.json(await billingService.activateLicense(body.licenseKey))
        }
        if (req.method === 'DELETE') {
          return Response.json(await billingService.clearLicense())
        }
        throw methodNotAllowed(req.method)

      case 'refresh':
        if (req.method !== 'POST') throw methodNotAllowed(req.method)
        return Response.json(await billingService.refresh())

      default:
        throw ApiError.notFound(`Unknown billing endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
