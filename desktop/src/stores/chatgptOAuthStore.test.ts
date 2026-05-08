import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  start: vi.fn(),
  status: vi.fn(),
  logout: vi.fn(),
  ensureProvider: vi.fn(),
}))

vi.mock('../api/chatgptOAuth', () => ({
  chatgptOAuthApi: apiMock,
}))

describe('chatgptOAuthStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('loads logged-in status without exposing tokens', async () => {
    apiMock.status.mockResolvedValue({
      loggedIn: true,
      expiresAt: 123,
      accountId: 'acc_123',
    })
    const { useChatGPTOAuthStore } = await import('./chatgptOAuthStore')

    await useChatGPTOAuthStore.getState().fetchStatus()

    expect(useChatGPTOAuthStore.getState().status).toEqual({
      loggedIn: true,
      expiresAt: 123,
      accountId: 'acc_123',
    })
  })

  it('logout clears status and stops polling', async () => {
    apiMock.logout.mockResolvedValue({ ok: true })
    const { useChatGPTOAuthStore } = await import('./chatgptOAuthStore')

    useChatGPTOAuthStore.setState({ isPolling: true })
    await useChatGPTOAuthStore.getState().logout()

    expect(apiMock.logout).toHaveBeenCalled()
    expect(useChatGPTOAuthStore.getState().isPolling).toBe(false)
    expect(useChatGPTOAuthStore.getState().status).toEqual({ loggedIn: false })
  })
})
