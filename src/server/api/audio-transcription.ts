import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { AudioTranscriptionService } from '../services/audioTranscriptionService.js'

const audioTranscriptionService = new AudioTranscriptionService()

type AudioTranscriptionRequest = {
  audio?: unknown
  language?: unknown
  enableItn?: unknown
  context?: unknown
}

export async function handleAudioTranscriptionApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    if (segments.length === 3 && segments[2] === 'status') {
      if (req.method !== 'GET') {
        return Response.json(
          { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
          { status: 405 },
        )
      }
      return Response.json(await audioTranscriptionService.getStatus())
    }

    if (segments.length !== 2) {
      throw ApiError.notFound(`Unknown audio transcription endpoint: ${url.pathname}`)
    }
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
        { status: 405 },
      )
    }

    const body = await parseJsonBody(req)
    const result = await audioTranscriptionService.transcribe({
      audio: body.audio,
      language: typeof body.language === 'string' ? body.language : undefined,
      enableItn: typeof body.enableItn === 'boolean' ? body.enableItn : undefined,
      context: typeof body.context === 'string' ? body.context : undefined,
    })

    return Response.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<AudioTranscriptionRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object'
      ? body as AudioTranscriptionRequest
      : {}
  } catch {
    throw ApiError.badRequest('Invalid JSON in request body')
  }
}
