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

export const audioTranscriptionApi = {
  transcribe(input: AudioTranscriptionRequest) {
    return api.post<AudioTranscriptionResponse>('/api/audio-transcription', input, {
      timeout: 120_000,
    })
  },
}
