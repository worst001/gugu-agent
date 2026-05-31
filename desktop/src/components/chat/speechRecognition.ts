export type BrowserSpeechRecognitionResult = {
  readonly isFinal?: boolean
  readonly 0?: { readonly transcript?: string }
}

export type BrowserSpeechRecognitionEvent = Event & {
  readonly resultIndex?: number
  readonly results: {
    readonly length: number
    readonly [index: number]: BrowserSpeechRecognitionResult | undefined
  }
}

export type BrowserSpeechRecognitionErrorEvent = Event & {
  readonly error?: string
  readonly message?: string
}

export type BrowserSpeechRecognition = EventTarget & {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitAudioContext?: typeof AudioContext
}

export type VoiceAudioRecorder = {
  stop: () => Promise<string>
  abort: () => Promise<void>
}

export function getSpeechRecognitionConstructor(
  targetWindow: SpeechWindow | undefined = typeof window === 'undefined' ? undefined : window as SpeechWindow,
): BrowserSpeechRecognitionConstructor | null {
  return targetWindow?.SpeechRecognition ?? targetWindow?.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionAvailable(
  targetWindow: SpeechWindow | undefined = typeof window === 'undefined' ? undefined : window as SpeechWindow,
): boolean {
  return getSpeechRecognitionConstructor(targetWindow) !== null
}

export function isCloudVoiceInputAvailable(
  targetWindow: SpeechWindow | undefined = typeof window === 'undefined' ? undefined : window as SpeechWindow,
  targetNavigator: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  return Boolean(
    targetNavigator?.mediaDevices?.getUserMedia &&
    (targetWindow?.AudioContext || targetWindow?.webkitAudioContext),
  )
}

export async function startCloudVoiceRecorder(
  targetWindow: SpeechWindow = window as SpeechWindow,
  targetNavigator: Navigator = navigator,
): Promise<VoiceAudioRecorder> {
  const AudioContextCtor = targetWindow.AudioContext || targetWindow.webkitAudioContext
  if (!AudioContextCtor || !targetNavigator.mediaDevices?.getUserMedia) {
    throw new Error('Cloud voice input is not available')
  }

  const stream = await targetNavigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  let audioContext: AudioContext
  try {
    audioContext = new AudioContextCtor()
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {})
    }
  } catch (error) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    throw error
  }

  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let stopped = false

  processor.onaudioprocess = (event) => {
    if (stopped) return
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }

  source.connect(processor)
  processor.connect(audioContext.destination)

  const cleanup = async () => {
    stopped = true
    try {
      processor.disconnect()
    } catch {
      // Already disconnected.
    }
    try {
      source.disconnect()
    } catch {
      // Already disconnected.
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    if (audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {})
    }
  }

  return {
    async stop() {
      await cleanup()
      return encodeWavDataUrl(chunks, audioContext.sampleRate)
    },
    async abort() {
      await cleanup()
    },
  }
}

export function appendVoiceTranscript(baseText: string, transcript: string): string {
  const cleanTranscript = transcript.trim()
  if (!cleanTranscript) return baseText
  if (!baseText.trim()) return cleanTranscript
  return `${baseText}${/\s$/.test(baseText) ? '' : '\n'}${cleanTranscript}`
}

export function resolveAsrLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase()
  if (!normalized) return undefined
  const primary = normalized.split('-')[0] ?? ''
  return ['zh', 'en', 'ja', 'ko'].includes(primary) ? primary : undefined
}

function encodeWavDataUrl(chunks: Float32Array[], sampleRate: number): string {
  const sampleCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, sampleCount * 2, true)

  let offset = 44
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}
