import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  configBackupService,
  type ConfigBackupImportOptions,
} from '../services/configBackupService.js'

export async function handleConfigBackupApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    if (sub === 'export') {
      if (req.method !== 'GET' && req.method !== 'POST') {
        return methodNotAllowed(req.method)
      }
      const body = req.method === 'POST' ? await parseJsonBody(req) : {}
      return Response.json(await configBackupService.exportConfig({
        includeSecrets: readBoolean(body.includeSecrets, url.searchParams.get('includeSecrets')),
        cwd: readString(body.cwd) ?? url.searchParams.get('cwd') ?? undefined,
      }))
    }

    if (sub === 'preview') {
      if (req.method !== 'POST') return methodNotAllowed(req.method)
      const body = await parseJsonBody(req)
      return Response.json({
        preview: await configBackupService.previewImport(
          body.package,
          readImportOptions(body),
        ),
      })
    }

    if (sub === 'import') {
      if (req.method !== 'POST') return methodNotAllowed(req.method)
      const body = await parseJsonBody(req)
      return Response.json(await configBackupService.importConfig(
        body.package,
        readImportOptions(body),
      ))
    }

    throw ApiError.notFound(`Unknown config backup endpoint: ${url.pathname}`)
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object'
      ? body as Record<string, unknown>
      : {}
  } catch {
    throw ApiError.badRequest('Invalid JSON in request body')
  }
}

function readImportOptions(body: Record<string, unknown>): ConfigBackupImportOptions {
  return {
    overwrite: body.overwrite !== false,
    cwd: readString(body.cwd),
  }
}

function readBoolean(value: unknown, fallback: string | null): boolean {
  if (typeof value === 'boolean') return value
  if (fallback == null) return false
  return fallback === '1' || fallback.toLowerCase() === 'true'
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined
}

function methodNotAllowed(method: string): Response {
  return Response.json(
    { error: 'METHOD_NOT_ALLOWED', message: `Method ${method} not allowed` },
    { status: 405 },
  )
}
