import { api } from './client'
import type { SavedProvider } from '../types/provider'

export type ChatGPTOAuthStatus =
  | { loggedIn: false }
  | {
      loggedIn: true
      expiresAt: number
      accountId: string | null
    }

export type ChatGPTDeviceSession = {
  authorizeUrl: string
  userCode: string
  deviceAuthId: string
  intervalMs: number
}

export const chatgptOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string; state: string; callbackUrl: string }>(
      '/api/chatgpt-oauth/start',
      {},
    )
  },

  startDevice() {
    return api.post<ChatGPTDeviceSession>('/api/chatgpt-oauth/device', {})
  },

  status() {
    return api.get<ChatGPTOAuthStatus>('/api/chatgpt-oauth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/chatgpt-oauth')
  },

  ensureProvider(options?: { activate?: boolean }) {
    return api.post<{ provider: SavedProvider }>('/api/chatgpt-oauth/provider', options ?? {})
  },
}
