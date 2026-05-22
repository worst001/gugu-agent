import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AdapterSettings } from './AdapterSettings'
import { adaptersApi } from '../api/adapters'
import { useAdapterStore } from '../stores/adapterStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { AdapterFileConfig } from '../types/adapter'
import { invoke } from '@tauri-apps/api/core'

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
  vi.mocked(invoke).mockResolvedValue(undefined)
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
        missingCredentials: ['clientId', 'clientSecret'],
        allowedUsersCount: 0,
        pairedUsersCount: 0,
      },
      {
        platform: 'wecom',
        status: 'not_configured',
        credentialsReady: false,
        missingCredentials: ['corpId', 'agentId', 'secret', 'token', 'encodingAesKey'],
        allowedUsersCount: 0,
        pairedUsersCount: 0,
      },
      {
        platform: 'qq',
        status: 'not_configured',
        credentialsReady: false,
        missingCredentials: ['appId/appSecret or oneBotUrl'],
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
    expect(screen.queryByRole('tab', { name: 'Telegram' })).not.toBeInTheDocument()
    expect(screen.getByText('Feishu setup checklist')).toBeInTheDocument()
    expect(screen.getByText('First-run steps, console permissions, and troubleshooting. Keep it collapsed during daily use.')).toBeInTheDocument()
    expect(screen.queryByText('Feishu Developer Console (web)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Feishu setup checklist/ }))
    expect(screen.getByText('Feishu Developer Console (web)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Feishu Developer Console/ })).toBeInTheDocument()
    expect(screen.getByText('A. First finish this in Feishu Developer Console (web)')).toBeInTheDocument()
    expect(screen.getByText('B. Then finish this in Gugu Agent')).toBeInTheDocument()
    expect(screen.getByText('Start local adapter')).toBeInTheDocument()
    expect(screen.getByText('im:message.p2p_msg:readonly')).toBeInTheDocument()
    expect(screen.getByText('im:message:send_as_bot')).toBeInTheDocument()
    expect(screen.getByText('im:message:update')).toBeInTheDocument()
    expect(screen.getByText('Comma-separated. Empty means paired users only; adding IDs narrows access to those users.')).toBeInTheDocument()
    expect(screen.queryByText('telegram-secret-token')).not.toBeInTheDocument()
  })

  it('saves masked credentials back through the existing config API', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(adaptersApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        defaultProjectDir: 'D:\\work',
        telegram: expect.objectContaining({
          botToken: '****oken',
          allowedUsers: [123],
        }),
        feishu: expect.objectContaining({
          appId: 'cli_abc',
          appSecret: '****cret',
          allowedUsers: ['ou_abc'],
          streamingCard: true,
        }),
      }))
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
    expect(adaptersApi.updateConfig).not.toHaveBeenCalled()
  })

  it('restarts local adapters from the settings page without terminal commands', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')
    const restartButton = screen.getAllByRole('button', { name: /Start\/Restart local adapters/ })[0]
    expect(restartButton).toBeDefined()
    fireEvent.click(restartButton!)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('restart_adapters_sidecar')
    })
    expect(await screen.findByText('Start request sent. Go back to the IM private chat and send the pairing code or a test message.')).toBeInTheDocument()
    expect(adaptersApi.updateConfig).not.toHaveBeenCalled()
  })

  it('presents WeCom as an admin callback integration instead of a webhook shortcut', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')

    fireEvent.click(screen.getByRole('tab', { name: 'WeCom' }))
    expect(screen.getByText('WeCom setup checklist')).toBeInTheDocument()
    expect(screen.getByText('Admin app, public callback, local adapter, and troubleshooting steps. Keep it collapsed during daily use.')).toBeInTheDocument()
    expect(screen.getByText('Corp ID, Agent ID, Secret, Token, and EncodingAESKey required')).toBeInTheDocument()
    expect(screen.getByText('Public callback URL')).toBeInTheDocument()
    expect(screen.queryByText('Webhook URL')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /WeCom setup checklist/ }))
    expect(screen.getByText('WeCom Admin Console (web)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open WeCom Admin Console/ })).toBeInTheDocument()
    expect(screen.getByText('In WeCom Admin Console, open Apps, then find the Self-built section.')).toBeInTheDocument()
    expect(screen.getByText('Secret: click view Secret on the app detail page. WeCom may send it to the admin mobile app.')).toBeInTheDocument()
    expect(screen.getByText('When you save, WeCom immediately verifies the URL. Save success means the callback chain is reachable.')).toBeInTheDocument()
    expect(screen.getByText('Start public HTTPS forwarding')).toBeInTheDocument()
    expect(screen.getByText('http://127.0.0.1:3478/wecom/events')).toBeInTheDocument()
    expect(screen.getByText('After “paired successfully”, send “hello” to test text chat, then “screenshot” to test image replies.')).toBeInTheDocument()
  })

  it('shows detailed DingTalk Stream setup steps behind a collapsed guide', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')

    fireEvent.click(screen.getByRole('tab', { name: 'DingTalk' }))
    expect(screen.getByText('DingTalk setup checklist')).toBeInTheDocument()
    expect(screen.getByText('Open Platform, Stream mode, local adapter, and troubleshooting. Keep it collapsed during daily use.')).toBeInTheDocument()
    expect(screen.getByText('DingTalk Client ID and Client Secret required')).toBeInTheDocument()
    expect(screen.queryByText('DingTalk Open Platform (web)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /DingTalk setup checklist/ }))
    expect(screen.getByText('DingTalk Open Platform (web)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open DingTalk Open Platform/ })).toBeInTheDocument()
    expect(screen.getByText('A. First finish this in DingTalk Open Platform (web)')).toBeInTheDocument()
    expect(screen.getByText('Client ID / AppKey')).toBeInTheDocument()
    expect(screen.getByText('Client Secret / AppSecret')).toBeInTheDocument()
    expect(screen.getByText('This must be an app bot under the internal app, not a normal group robot webhook.')).toBeInTheDocument()
    expect(screen.getByText('Do not choose Outgoing Webhook or HTTP callback. The local edition receives messages through the Stream connection.')).toBeInTheDocument()
    expect(screen.getByText('/v1.0/im/bot/messages/get')).toBeInTheDocument()
    expect(screen.getByText('B. Then finish this in local Gugu Agent')).toBeInTheDocument()
    expect(screen.getByText(/DingTalk messages reach Gu Agent only while it is running/)).toBeInTheDocument()
    expect(screen.getByText('The current DingTalk Stream adapter first guarantees text chat. Images/files and screenshot replies need an extra media path, so do not present them as production-ready yet.')).toBeInTheDocument()
  })

  it('shows detailed QQ official bot and OneBot setup steps behind a collapsed guide', async () => {
    render(<AdapterSettings />)

    await screen.findByText('Remote channel boundary')

    fireEvent.click(screen.getByRole('tab', { name: 'QQ' }))
    expect(screen.getByText('QQ setup checklist')).toBeInTheDocument()
    expect(screen.getByText('Official Bot, sandbox testing, local adapter, OneBot/NapCat, and troubleshooting. Keep it collapsed during daily use.')).toBeInTheDocument()
    expect(screen.getByText('QQ App ID + App Secret, or OneBot/NapCat URL required')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('From QQ Bot Open Platform')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('From Feishu Open Platform')).not.toBeInTheDocument()
    expect(screen.queryByText('QQ Bot Open Platform (web)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /QQ setup checklist/ }))
    expect(screen.getByText('QQ Bot Open Platform (web)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open QQ Bot Open Platform/ })).toBeInTheDocument()
    expect(screen.getByText('A. Official QQ Bot path')).toBeInTheDocument()
    expect(screen.getByText('In the console, open Sandbox Config and add your QQ account to sandbox single chat or direct messages.')).toBeInTheDocument()
    expect(screen.getByText('In Developer Settings / IP Allowlist, add the public egress IP of the machine running the local adapter.')).toBeInTheDocument()
    expect(screen.getByText('B. Then finish this in local Gugu Agent')).toBeInTheDocument()
    expect(screen.getByText('OneBot/NapCat local testing path')).toBeInTheDocument()
    expect(screen.getByText('ws://127.0.0.1:3001')).toBeInTheDocument()
    expect(screen.getByText('After “paired successfully”, send “hello” to test text chat, send an image/file to test attachment understanding, then send “screenshot” to test image replies.')).toBeInTheDocument()
    expect(screen.getByText('Image/file issues: official Bot can directly reply with images, audio, and video; generic file sending is limited by QQ platform support. OneBot/NapCat file sending depends on upload_private_file / upload_group_file support.')).toBeInTheDocument()
    expect(screen.getByText('This local edition fits personal or beta testing. For many regular users, a shared server relay is a better future path than asking each user to create a QQ Bot.')).toBeInTheDocument()
  })
})
