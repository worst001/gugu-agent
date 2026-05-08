import { create } from 'zustand'
import { chatgptOAuthApi, type ChatGPTOAuthStatus } from '../api/chatgptOAuth'

const POLL_INTERVAL_MS = 2_000

type ChatGPTOAuthState = {
  status: ChatGPTOAuthStatus | null
  isPolling: boolean
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<ChatGPTOAuthStatus | null>
  login: () => Promise<{ authorizeUrl: string }>
  logout: () => Promise<void>
  ensureProvider: (options?: { activate?: boolean }) => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useChatGPTOAuthStore = create<ChatGPTOAuthState>((set, get) => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  return {
    status: null,
    isPolling: false,
    isLoading: false,
    error: null,

    fetchStatus: async () => {
      try {
        const status = await chatgptOAuthApi.status()
        set({ status, error: null })
        return status
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },

    login: async () => {
      set({ isLoading: true, error: null })
      try {
        const res = await chatgptOAuthApi.start()
        set({ isLoading: false })
        return { authorizeUrl: res.authorizeUrl }
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },

    logout: async () => {
      get().stopPolling()
      set({ isLoading: true, error: null })
      try {
        await chatgptOAuthApi.logout()
        set({ status: { loggedIn: false }, isLoading: false })
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },

    ensureProvider: async (options) => {
      await chatgptOAuthApi.ensureProvider(options)
    },

    startPolling: () => {
      if (pollTimer) return
      set({ isPolling: true })

      const scheduleNext = () => {
        pollTimer = setTimeout(async () => {
          await get().fetchStatus()
          const cur = get().status
          if (cur && cur.loggedIn) {
            await get().ensureProvider({ activate: true }).catch((err) => {
              set({ error: err instanceof Error ? err.message : String(err) })
            })
            get().stopPolling()
            return
          }
          if (get().isPolling) {
            scheduleNext()
          }
        }, POLL_INTERVAL_MS)
      }
      scheduleNext()
    },

    stopPolling: () => {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      set({ isPolling: false })
    },
  }
})
