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

export function appendVoiceTranscript(baseText: string, transcript: string): string {
  const cleanTranscript = transcript.trim()
  if (!cleanTranscript) return baseText
  if (!baseText.trim()) return cleanTranscript
  return `${baseText}${/\s$/.test(baseText) ? '' : '\n'}${cleanTranscript}`
}
