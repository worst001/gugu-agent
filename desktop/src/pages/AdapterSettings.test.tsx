import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AdapterSettings } from './AdapterSettings'
import { adaptersApi } from '../api/adapters'
import { useAdapterStore } from '../stores/adapterStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { AdapterFileConfig } from '../types/adapter'

vi.mock('../api/adapters', () => ({
  adaptersApi: {
    getConfig: vi.fn(),
    getStatus: vi.fn(),
    updateConfig: vi.fn(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const loadedConfig: AdapterFileConfig = {
  defaultProjectDir: 'D:\\work',
  telegram: {
    botToken: '****oken',
    allowedUsers: [123],
    pairedUsers: [],
  },
  feishu: {
    appId: 'cli_abc',
    appSecret: '****cret',
    encryptKey: '',
    verificationToken: '',
    allowedUsers: ['ou_abc'],
    pairedUsers: [{ userId: 'ou_user', displayName: 'Feishu User', pairedAt: 1 }],
    streamingCard: true,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({ locale: 'en' })
  useAdapterStore.setState({ config: {}, isLoading: false, error: null })
  vi.mocked(adaptersApi.getConfig).mockResolvedValue(loadedConfig)
  vi.mocked(adaptersApi.getStatus).mockResolvedValue({
    configLocation: '~/.claude/adapters.json',
    defaultProjectConfigured: true,
    pairingActive: false,
    pairingExpiresAt: null,
    channels: [
      {
        platform: 'telegram',
        status: 'ready',
        credentialsReady: true,
        missingCredentials: [],
        allowedUsersCount: 1,
        pairedUsersCount: 0,
      },
      {
        platform: 'feishu',
        status: 'ready',
        credentialsReady: true,
        missingCredentials: [],
        allowedUsersCount: 1,
        pairedUsersCount: 1,
      },
      {
        platform: 'dingtalk',
        status: 'not_configured',
        credentialsReady: false,
        missingCredentials: ['clientId/clientSecret or webhookUrl'],
        allowedUsersCount: 0,
        pairedUsersCount: 0,
      },
      {
        platform: 'wecom',
        status: 'not_configured',
        credentialsReady: false,
        missingCredentials: ['corpId/agentId/secret or webhookUrl'],
        allowedUsersCount: 0,
        pairedUsersCount: 0,
      },
      {
        platform: 'qq',
        status: 'not_configured',
        credentialsReady: false,
        missingCredentials: ['appId/token or oneBotUrl'],
        allowedUsersCount: 0,
        pairedUsersCount: 0,
      },
    ],
    notes: [],
  })
  vi.mocked(adaptersApi.updateConfig).mockImplementation(async (patch) => ({
    ...loadedConfig,
    ...patch,
    telegram: { ...(loadedConfig.telegram ?? {}), ...(patch.telegram ?? {}) },
    feishu: { ...(loadedConfig.feishu ?? {}), ...(patch.feishu ?? {}) },
    dingtalk: { ...(loadedConfig.dingtalk ?? {}), ...(patch.dingtalk ?? {}) },
    wecom: { ...(loadedConfig.wecom ?? {}), ...(patch.wecom ?? {}) },
    qq: { ...(loadedConfig.qq ?? {}), ...(patch.qq ?? {}) },
  }))
})

describe('AdapterSettings', () => {
  it('shows credential, pairing, and allowlist boundaries without exposing raw secrets', async () => {
    render(<AdapterSettings />)

    expect(await screen.findByText('Remote channel boundary')).toBeInTheDocument()
    expect(screen.getByText('1 channel(s) configured')).toBeInTheDocument()
    expect(screen.getByText('1 paired user(s)')).toBeInTheDocument()
    expect(screen.getByText('1 allowlisted user(s)')).toBeInTheDocument()
    expect(screen.getByText('Feishu app credentials configured')).toBeInTheDocument()
    expect(screen.getByText('Comma-separated. Empty means paired users only; adding IDs narrows access to those users.')).toBeInTheDocument()
    expect(screen.queryByText('telegram-secret-token')).not.toBeInTheDocument()

    expect(screen.queryByRole('tab', { name: 'Telegram' })).not.toBeInTheDocument()
  })

  it('saves masked credentials back through the existing config API', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(adaptersApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        defaultProjectDir: 'D:\\work',
        feishu: expect.objectContaining({
          appId: 'cli_abc',
          appSecret: '****cret',
          allowedUsers: ['ou_abc'],
          streamingCard: true,
        }),
      }))
      expect(vi.mocked(adaptersApi.updateConfig).mock.calls[0]?.[0]).not.toHaveProperty('telegram')
    })
  })

  it('checks local adapter diagnostics without saving credentials', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')
    fireEvent.click(screen.getByRole('button', { name: 'Check config' }))

    expect(await screen.findByText('Local diagnostics')).toBeInTheDocument()
    expect(screen.getByText('Default project set')).toBeInTheDocument()
    expect(screen.getByText('No active pairing code')).toBeInTheDocument()
    expect(screen.getAllByText('Ready')).toHaveLength(1)
    expect(screen.getByText('Allowlist 1, paired 1, missing None')).toBeInTheDocument()
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument()
    expect(adaptersApi.updateConfig).not.toHaveBeenCalled()
  })
})
