import { ApiError } from '../middleware/errorHandler.js'
import { DesktopProfileService } from '../services/desktopProfileService.js'
import { desktopProfileBundlePatchSchema } from '../types/desktopProfile.js'

const desktopProfileService = new DesktopProfileService()

export async function handleDesktopProfileApi(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return Response.json(await desktopProfileService.getBundle())
  }

  if (req.method === 'PATCH') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw ApiError.badRequest('Invalid JSON body')
    }
    const parsed = desktopProfileBundlePatchSchema.safeParse(body)
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => issue.message).join('; ')
      throw ApiError.badRequest(`Invalid desktop profile patch: ${details}`)
    }
    return Response.json(await desktopProfileService.updateBundle(parsed.data))
  }

  if (req.method === 'DELETE') {
    await desktopProfileService.reset()
    return Response.json({ ok: true })
  }

  throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
}
