import { isTauriRuntime } from '../lib/desktopRuntime'

export type NativeBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type NativeBrowserCommandResult = {
  sessionId: string
  url: string
}

export type NativeBrowserEventType =
  | 'download-finished'
  | 'download-requested'
  | 'loading-finished'
  | 'loading-started'
  | 'navigation'
  | 'navigation-blocked'
  | 'new-window'
  | 'title-changed'

export type NativeBrowserEvent = {
  sessionId: string
  event: NativeBrowserEventType
  url?: string | null
  title?: string | null
  message?: string | null
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('Native browser is available in the desktop app runtime.')
  }
  const api = await import(/* @vite-ignore */ '@tauri-apps/api/core')
  return api.invoke<T>(command, args)
}

export const nativeBrowserApi = {
  isAvailable: isTauriRuntime,

  create(input: { sessionId: string; url: string; bounds: NativeBrowserBounds }) {
    return invoke<NativeBrowserCommandResult>('browser_create', { input })
  },

  navigate(input: { sessionId: string; url: string }) {
    return invoke<NativeBrowserCommandResult>('browser_navigate', { input })
  },

  goBack(sessionId: string) {
    return invoke<void>('browser_go_back', { input: { sessionId } })
  },

  goForward(sessionId: string) {
    return invoke<void>('browser_go_forward', { input: { sessionId } })
  },

  reload(sessionId: string) {
    return invoke<void>('browser_reload', { input: { sessionId } })
  },

  stop(sessionId: string) {
    return invoke<void>('browser_stop', { input: { sessionId } })
  },

  setBounds(input: { sessionId: string; bounds: NativeBrowserBounds }) {
    return invoke<void>('browser_set_bounds', { input })
  },

  show(sessionId: string) {
    return invoke<void>('browser_show', { input: { sessionId } })
  },

  hide(sessionId: string) {
    return invoke<void>('browser_hide', { input: { sessionId } })
  },

  close(sessionId: string) {
    return invoke<void>('browser_close', { input: { sessionId } })
  },

  async listen(handler: (event: NativeBrowserEvent) => void): Promise<() => void> {
    if (!isTauriRuntime()) return () => {}
    const api = await import(/* @vite-ignore */ '@tauri-apps/api/event')
    return api.listen<NativeBrowserEvent>('browser-event', (event) => handler(event.payload))
  },
}
