import { t } from '../i18n'
import { isTauriRuntime } from '../lib/desktopRuntime'

const DEDUPE_WINDOW_MS = 1500
const lastNotificationBySession = new Map<string, number>()
let chimeContext: AudioContext | null = null

type TaskCompletionNotificationInput = {
  sessionId: string
  sessionTitle?: string | null
}

export async function notifyChatTaskComplete({
  sessionId,
  sessionTitle,
}: TaskCompletionNotificationInput) {
  if (!isTauriRuntime()) return

  const now = Date.now()
  const lastNotificationAt = lastNotificationBySession.get(sessionId) ?? 0
  if (now - lastNotificationAt < DEDUPE_WINDOW_MS) return
  lastNotificationBySession.set(sessionId, now)

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      /* @vite-ignore */ '@tauri-apps/plugin-notification'
    )

    let granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === 'granted'
    }
    if (!granted) return

    const title = sessionTitle?.trim()
    const sound = getCompletionNotificationSound()
    sendNotification({
      title: t('chat.taskCompleteNotification.title'),
      body: title
        ? t('chat.taskCompleteNotification.bodyWithTitle', { title })
        : t('chat.taskCompleteNotification.body'),
      silent: false,
      ...(sound ? { sound } : {}),
    })
    void playCompletionChime()
  } catch (error) {
    console.warn('[notifications] Failed to show task completion notification', error)
    void playCompletionChime()
  }
}

function getCompletionNotificationSound() {
  if (typeof navigator === 'undefined') return undefined
  if (/Mac/i.test(navigator.platform)) return 'Ping'
  if (/Win/i.test(navigator.platform)) return 'IM'
  return undefined
}

async function playCompletionChime() {
  if (typeof window === 'undefined') return

  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return

  try {
    const context = chimeContext ?? new AudioContextCtor()
    chimeContext = context
    if (context.state === 'suspended') {
      await context.resume()
    }

    const now = context.currentTime
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46)
    gain.connect(context.destination)

    for (const [index, frequency] of [880, 1174].entries()) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.12)
      oscillator.connect(gain)
      oscillator.start(now + index * 0.12)
      oscillator.stop(now + index * 0.12 + 0.18)
      oscillator.addEventListener('ended', () => oscillator.disconnect(), { once: true })
    }

    window.setTimeout(() => gain.disconnect(), 600)
  } catch (error) {
    console.warn('[notifications] Failed to play completion chime', error)
  }
}
