import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdapterSettings } from './AdapterSettings'

const store = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  restartAdapters: vi.fn(),
}))

vi.mock('../i18n', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('../stores/adapterStore', () => ({
  useAdapterStore: () => store,
}))

vi.mock('../components/settings/WeixinConnectionCard', () => ({
  WeixinConnectionCard: ({
    onConnectionChanged,
  }: {
    onConnectionChanged?: () => Promise<void>
  }) => (
    <button type="button" onClick={() => void onConnectionChanged?.()}>
      Weixin connection
    </button>
  ),
}))

vi.mock('../components/settings/FeishuConnectionCard', () => ({
  FeishuConnectionCard: ({
    onConnectionChanged,
  }: {
    onConnectionChanged?: () => Promise<void>
  }) => (
    <button type="button" onClick={() => void onConnectionChanged?.()}>
      Feishu connection
    </button>
  ),
}))

describe('AdapterSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.fetchConfig.mockResolvedValue(undefined)
    store.restartAdapters.mockResolvedValue(undefined)
  })

  it('shows only the compact Weixin and Feishu connection cards', () => {
    render(<AdapterSettings />)

    expect(screen.getByText('Weixin connection')).toBeInTheDocument()
    expect(screen.getByText('Feishu connection')).toBeInTheDocument()
    expect(screen.queryByText('Remote channel boundary')).not.toBeInTheDocument()
    expect(screen.queryByText('Generate pairing code')).not.toBeInTheDocument()
    expect(screen.queryByText('DingTalk')).not.toBeInTheDocument()
  })

  it('restarts adapters and refreshes config after a connection changes', async () => {
    render(<AdapterSettings />)

    fireEvent.click(screen.getByText('Feishu connection'))

    await waitFor(() => {
      expect(store.restartAdapters).toHaveBeenCalledOnce()
      expect(store.fetchConfig).toHaveBeenCalledOnce()
    })
    expect(store.restartAdapters.mock.invocationCallOrder[0]!)
      .toBeLessThan(store.fetchConfig.mock.invocationCallOrder[0]!)
  })
})
