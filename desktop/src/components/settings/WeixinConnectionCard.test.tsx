import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptersApi } from '../../api/adapters'
import { WeixinConnectionCard } from './WeixinConnectionCard'

vi.mock('../../api/adapters', () => ({
  adaptersApi: {
    getWeixinConnection: vi.fn(),
    startWeixinInstallation: vi.fn(),
    getWeixinInstallation: vi.fn(),
    submitWeixinVerification: vi.fn(),
    cancelWeixinInstallation: vi.fn(),
    disconnectWeixin: vi.fn(),
  },
}))

describe('WeixinConnectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adaptersApi.getWeixinConnection).mockResolvedValue({
      connected: false,
      accountId: null,
      runtime: { state: 'offline', lastPollAt: null, error: null },
    })
  })

  test('starts a QR installation and renders only the local data URL', async () => {
    vi.mocked(adaptersApi.startWeixinInstallation).mockResolvedValue({
      installationId: 'install-1',
      state: 'waiting',
      expiresAt: Date.now() + 300_000,
      qrCodeDataUrl: 'data:image/png;base64,local-qr',
    })
    vi.mocked(adaptersApi.getWeixinInstallation).mockImplementation(
      () => new Promise(() => {}),
    )

    render(<WeixinConnectionCard onConnectionChanged={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: '连接微信' }))

    const qr = await screen.findByRole('img', { name: '微信连接二维码' })
    expect(qr.getAttribute('src')).toBe('data:image/png;base64,local-qr')
    expect(document.body.textContent).not.toContain('provider-secret')
    expect(screen.queryByRole('button', { name: '连接微信' })).not.toBeInTheDocument()
  })

  test('restarts the adapter and refreshes connection after authorization', async () => {
    vi.mocked(adaptersApi.getWeixinConnection)
      .mockResolvedValueOnce({
        connected: false,
        accountId: null,
        runtime: { state: 'offline', lastPollAt: null, error: null },
      })
      .mockResolvedValue({
        connected: true,
        accountId: 'bot-1',
        runtime: { state: 'online', lastPollAt: 1, error: null },
      })
    vi.mocked(adaptersApi.startWeixinInstallation).mockResolvedValue({
      installationId: 'install-1',
      state: 'waiting',
      expiresAt: Date.now() + 300_000,
      qrCodeDataUrl: 'data:image/png;base64,local-qr',
    })
    vi.mocked(adaptersApi.getWeixinInstallation).mockResolvedValue({
      installationId: 'install-1',
      state: 'authorized',
      expiresAt: Date.now() + 300_000,
      accountId: 'bot-1',
    })
    const onConnectionChanged = vi.fn().mockResolvedValue(undefined)

    render(<WeixinConnectionCard onConnectionChanged={onConnectionChanged} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '连接微信' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '连接微信' }))

    await waitFor(() => expect(onConnectionChanged).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByText('在线')).toBeInTheDocument())
  })

  test('retries QR polling after a transient status error', async () => {
    vi.mocked(adaptersApi.startWeixinInstallation).mockResolvedValue({
      installationId: 'install-2',
      state: 'waiting',
      expiresAt: Date.now() + 300_000,
      qrCodeDataUrl: 'data:image/png;base64,local-qr',
    })
    vi.mocked(adaptersApi.getWeixinInstallation)
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValue({
        installationId: 'install-2',
        state: 'authorized',
        expiresAt: Date.now() + 300_000,
        accountId: 'bot-2',
      })
    const onConnectionChanged = vi.fn().mockResolvedValue(undefined)

    render(<WeixinConnectionCard onConnectionChanged={onConnectionChanged} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '连接微信' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '连接微信' }))

    expect(await screen.findByText('temporary network failure')).toBeInTheDocument()
    await waitFor(
      () => expect(onConnectionChanged).toHaveBeenCalledOnce(),
      { timeout: 2000 },
    )
  })

  test('restarts the adapter after disconnecting', async () => {
    vi.mocked(adaptersApi.getWeixinConnection)
      .mockResolvedValueOnce({
        connected: true,
        accountId: 'bot-1',
        runtime: { state: 'online', lastPollAt: 1, error: null },
      })
      .mockResolvedValue({
        connected: false,
        accountId: null,
        runtime: { state: 'offline', lastPollAt: null, error: null },
      })
    vi.mocked(adaptersApi.disconnectWeixin).mockResolvedValue({ ok: true })
    const onConnectionChanged = vi.fn().mockResolvedValue(undefined)

    render(<WeixinConnectionCard onConnectionChanged={onConnectionChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: '断开连接' }))

    await waitFor(() => expect(onConnectionChanged).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '连接微信' })).toBeInTheDocument())
  })
})
