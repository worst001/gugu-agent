import { api } from './client'

export type AudioTranscriptionRequest = {
  audio: string
  language?: string
  enableItn?: boolean
  context?: string
}

export type AudioTranscriptionResponse = {
  text: string
  model: string
  language?: string
  emotion?: string
  usage?: unknown
}

export type AudioTranscriptionStatus = {
  available: boolean
  model: string
  provider: 'dashscope'
  reason?: 'missing_api_key'
}

export const audioTranscriptionApi = {
  status() {
    return api.get<AudioTranscriptionStatus>('/api/audio-transcription/status', {
      timeout: 10_000,
    })
  },

  transcribe(input: AudioTranscriptionRequest) {
    return api.post<AudioTranscriptionResponse>('/api/audio-transcription', input, {
      timeout: 120_000,
    })
  },
}
