import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptersApi } from '../../api/adapters'
import { FeishuConnectionCard } from './FeishuConnectionCard'
import { openExternalFromAppAction } from '../../utils/appActions'

vi.mock('../../api/adapters', () => ({
  adaptersApi: {
    getFeishuConnection: vi.fn(),
    startFeishuInstallation: vi.fn(),
    getFeishuInstallation: vi.fn(),
    cancelFeishuInstallation: vi.fn(),
    disconnectFeishu: vi.fn(),
  },
}))

vi.mock('../../utils/appActions', () => ({
  openExternalFromAppAction: vi.fn(),
}))

describe('FeishuConnectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adaptersApi.getFeishuConnection).mockResolvedValue({
      connected: false,
      appId: null,
    })
  })

  test('starts a QR installation and opens the official browser fallback', async () => {
    vi.mocked(adaptersApi.startFeishuInstallation).mockResolvedValue({
      installationId: 'install-1',
      state: 'waiting',
      expiresAt: Date.now() + 300_000,
      qrCodeDataUrl: 'data:image/png;base64,local-feishu-qr',
      authorizationUrl: 'https://open.feishu.cn/page/launcher?user_code=test',
    })
    vi.mocked(adaptersApi.getFeishuInstallation).mockImplementation(
      () => new Promise(() => {}),
    )

    render(<FeishuConnectionCard onConnectionChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '连接飞书' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: '连接飞书' }))

    const qr = await screen.findByRole('img', { name: '飞书连接二维码' })
    expect(qr.getAttribute('src')).toBe(
      'data:image/png;base64,local-feishu-qr',
    )
    fireEvent.click(screen.getByRole('button', { name: '在浏览器打开授权页' }))
    expect(openExternalFromAppAction).toHaveBeenCalledWith(
      'https://open.feishu.cn/page/launcher?user_code=test',
    )
  })

  test('restarts the adapter and refreshes connection after authorization', async () => {
    vi.mocked(adaptersApi.getFeishuConnection)
      .mockResolvedValueOnce({ connected: false, appId: null })
      .mockResolvedValue({ connected: true, appId: 'cli_gugu' })
    vi.mocked(adaptersApi.startFeishuInstallation).mockResolvedValue({
      installationId: 'install-1',
      state: 'waiting',
      expiresAt: Date.now() + 300_000,
      qrCodeDataUrl: 'data:image/png;base64,local-feishu-qr',
      authorizationUrl: 'https://open.feishu.cn/page/launcher?user_code=test',
    })
    vi.mocked(adaptersApi.getFeishuInstallation).mockResolvedValue({
      installationId: 'install-1',
      state: 'authorized',
      expiresAt: Date.now() + 300_000,
      appId: 'cli_gugu',
    })
    const onConnectionChanged = vi.fn().mockResolvedValue(undefined)

    render(
      <FeishuConnectionCard onConnectionChanged={onConnectionChanged} />,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '连接飞书' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: '连接飞书' }))

    await waitFor(() => expect(onConnectionChanged).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByText('已连接')).toBeInTheDocument())
    expect(screen.getByText('应用：cli_gugu')).toBeInTheDocument()
  })

  test('retries polling after a temporary status error', async () => {
    vi.mocked(adaptersApi.startFeishuInstallation).mockResolvedValue({
      installationId: 'install-2',
      state: 'waiting',
      expiresAt: Date.now() + 300_000,
      qrCodeDataUrl: 'data:image/png;base64,local-feishu-qr',
      authorizationUrl: 'https://open.feishu.cn/page/launcher?user_code=test',
    })
    vi.mocked(adaptersApi.getFeishuInstallation)
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValue({
        installationId: 'install-2',
        state: 'authorized',
        expiresAt: Date.now() + 300_000,
        appId: 'cli_gugu',
      })
    vi.mocked(adaptersApi.getFeishuConnection)
      .mockResolvedValueOnce({ connected: false, appId: null })
      .mockResolvedValue({ connected: true, appId: 'cli_gugu' })
    const onConnectionChanged = vi.fn().mockResolvedValue(undefined)

    render(
      <FeishuConnectionCard onConnectionChanged={onConnectionChanged} />,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '连接飞书' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: '连接飞书' }))

    expect(await screen.findByText('temporary network failure'))
      .toBeInTheDocument()
    await waitFor(
      () => expect(onConnectionChanged).toHaveBeenCalledOnce(),
      { timeout: 2500 },
    )
  })

  test('restarts the adapter after disconnecting', async () => {
    vi.mocked(adaptersApi.getFeishuConnection)
      .mockResolvedValueOnce({ connected: true, appId: 'cli_gugu' })
      .mockResolvedValue({ connected: false, appId: null })
    vi.mocked(adaptersApi.disconnectFeishu).mockResolvedValue({ ok: true })
    const onConnectionChanged = vi.fn().mockResolvedValue(undefined)

    render(
      <FeishuConnectionCard onConnectionChanged={onConnectionChanged} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '断开连接' }))

    await waitFor(() => expect(onConnectionChanged).toHaveBeenCalledOnce())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '连接飞书' }))
        .toBeInTheDocument()
    })
  })
})
