import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { Settings } from '../pages/Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useUpdateStore } from '../stores/updateStore'
import type { SavedProvider } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'
import type { BillingConfigResponse, BillingStatusResponse } from '../types/billing'

const MOCK_DELETE_PROVIDER = vi.fn()
const MOCK_GET_SETTINGS = vi.fn()
const MOCK_UPDATE_SETTINGS = vi.fn()
const {
  MOCK_GET_ATTACHMENT_CONFIG,
  MOCK_UPDATE_ATTACHMENT_CONFIG,
  MOCK_TEST_ATTACHMENT_CONFIG,
  MOCK_EXPORT_CONFIG,
  MOCK_PREVIEW_IMPORT,
  MOCK_IMPORT_CONFIG,
} = vi.hoisted(() => ({
  MOCK_GET_ATTACHMENT_CONFIG: vi.fn(),
  MOCK_UPDATE_ATTACHMENT_CONFIG: vi.fn(),
  MOCK_TEST_ATTACHMENT_CONFIG: vi.fn(),
  MOCK_EXPORT_CONFIG: vi.fn(),
  MOCK_PREVIEW_IMPORT: vi.fn(),
  MOCK_IMPORT_CONFIG: vi.fn(),
}))
const providerStoreState = {
  providers: [] as SavedProvider[],
  activeId: null as string | null,
  hasLoadedProviders: true,
  presets: [] as ProviderPreset[],
  isLoading: false,
  isPresetsLoading: false,
  fetchProviders: vi.fn(),
  fetchPresets: vi.fn(),
  deleteProvider: MOCK_DELETE_PROVIDER,
  activateProvider: vi.fn(),
  activateOfficial: vi.fn(),
  testProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  testConfig: vi.fn(),
}
const billingStoreState = {
  status: null as BillingStatusResponse | null,
  config: null as BillingConfigResponse | null,
  isLoading: false,
  isSaving: false,
  error: null as string | null,
  message: null as string | null,
  fetchBilling: vi.fn(),
  activateLicense: vi.fn(),
  refresh: vi.fn(),
  clearLicense: vi.fn(),
}

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }),
  },
}))

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => providerStoreState,
}))

vi.mock('../stores/billingStore', () => ({
  useBillingStore: (selector: (state: typeof billingStoreState) => unknown) => selector(billingStoreState),
}))

vi.mock('../api/providers', () => ({
  providersApi: {
    getSettings: MOCK_GET_SETTINGS,
    updateSettings: MOCK_UPDATE_SETTINGS,
  },
}))

vi.mock('../api/attachmentParser', () => ({
  attachmentParserApi: {
    getConfig: MOCK_GET_ATTACHMENT_CONFIG,
    updateConfig: MOCK_UPDATE_ATTACHMENT_CONFIG,
    test: MOCK_TEST_ATTACHMENT_CONFIG,
  },
}))

vi.mock('../api/configBackup', () => ({
  configBackupApi: {
    exportConfig: MOCK_EXPORT_CONFIG,
    previewImport: MOCK_PREVIEW_IMPORT,
    importConfig: MOCK_IMPORT_CONFIG,
  },
}))

vi.mock('../components/settings/ClaudeOfficialLogin', () => ({
  ClaudeOfficialLogin: () => <div data-testid="claude-official-login" />,
}))

vi.mock('../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div>Adapter Settings Mock</div>,
}))

vi.mock('../stores/agentStore', () => ({
  useAgentStore: () => ({
    activeAgents: [],
    allAgents: [],
    isLoading: false,
    error: null,
    selectedAgent: null,
    fetchAgents: vi.fn(),
    selectAgent: vi.fn(),
  }),
}))

vi.mock('../stores/skillStore', () => ({
  useSkillStore: () => ({
    skills: [],
    selectedSkill: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    fetchSkills: vi.fn(),
    fetchSkillDetail: vi.fn(),
    clearSelection: vi.fn(),
  }),
}))

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-viewer">{code}</pre>,
}))

const DEFAULT_ATTACHMENT_CONFIG = {
  enabled: false,
  mode: 'managed',
  apiKey: '',
  hasApiKey: false,
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  visionModel: 'glm-5v-turbo',
  ocrModel: 'glm-ocr',
  summarizeModel: 'glm-5.1',
}

describe('Settings > General tab', () => {
  beforeEach(() => {
    MOCK_DELETE_PROVIDER.mockReset()
    MOCK_GET_SETTINGS.mockResolvedValue({})
    MOCK_UPDATE_SETTINGS.mockResolvedValue({})
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true
    providerStoreState.presets = []
    providerStoreState.isLoading = false
    providerStoreState.isPresetsLoading = false
    providerStoreState.fetchProviders = vi.fn()
    providerStoreState.fetchPresets = vi.fn()
    providerStoreState.activateProvider = vi.fn()
    providerStoreState.activateOfficial = vi.fn()
    providerStoreState.testProvider = vi.fn()
    providerStoreState.createProvider = vi.fn()
    providerStoreState.updateProvider = vi.fn()
    providerStoreState.testConfig = vi.fn()

    useSettingsStore.setState({
      locale: 'en',
      skipWebFetchPreflight: true,
      setSkipWebFetchPreflight: vi.fn().mockImplementation(async (enabled: boolean) => {
        useSettingsStore.setState({ skipWebFetchPreflight: enabled })
      }),
    })

    useUIStore.setState({ pendingSettingsTab: null })
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('shows WebFetch preflight toggle enabled by default', () => {
    render(<Settings />)

    fireEvent.click(screen.getByText('General'))

    const toggle = screen.getByLabelText('Skip WebFetch domain preflight')
    expect(toggle).toBeChecked()
  })

  it('lets the user disable WebFetch preflight skipping', () => {
    render(<Settings />)

    fireEvent.click(screen.getByText('General'))

    const toggle = screen.getByLabelText('Skip WebFetch domain preflight')
    fireEvent.click(toggle)

    expect(useSettingsStore.getState().setSkipWebFetchPreflight).toHaveBeenCalledWith(false)
  })

  it('keeps extension tabs available alongside the terminal tab', () => {
    render(<Settings />)

    expect(screen.queryByText('Install')).not.toBeInTheDocument()
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByText('Plugins')).toBeInTheDocument()
  })
})

describe('Settings > Providers tab', () => {
  beforeEach(() => {
    MOCK_DELETE_PROVIDER.mockReset()
    MOCK_GET_SETTINGS.mockResolvedValue({})
    MOCK_UPDATE_SETTINGS.mockResolvedValue({})
    providerStoreState.providers = [
      {
        id: 'provider-1',
        name: 'MiniMax-M2.7-highspeed(openai)',
        presetId: 'custom',
        apiKey: '***',
        baseUrl: 'https://api.minimaxi.com',
        apiFormat: 'openai_chat',
        models: {
          main: 'MiniMax-M2.7-highspeed',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        notes: '',
      },
    ]
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true
  })

  it('hides official OAuth while providers finish loading', () => {
    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = false

    render(<Settings />)

    expect(screen.queryByTestId('claude-official-login')).not.toBeInTheDocument()
  })

  it('hides Claude Official and ChatGPT Connect from the provider list', () => {
    providerStoreState.providers = [
      {
        id: 'gugu-managed',
        name: 'Gugu Managed',
        presetId: 'gugu-managed',
        apiKey: '',
        baseUrl: 'gugu://managed',
        apiFormat: 'gugu_managed',
        authKind: 'gugu_managed',
        models: {
          main: 'gugu-managed-main',
          haiku: 'gugu-managed-fast',
          sonnet: 'gugu-managed-main',
          opus: 'gugu-managed-strong',
        },
        notes: '',
      },
      {
        id: 'chatgpt-provider',
        name: 'ChatGPT Connect',
        presetId: 'chatgpt',
        apiKey: '',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        apiFormat: 'chatgpt_codex',
        authKind: 'chatgpt_oauth',
        models: {
          main: 'gpt-5.4',
          haiku: 'gpt-5.4-mini',
          sonnet: 'gpt-5.4',
          opus: 'gpt-5.4',
        },
        notes: '',
      },
    ]
    providerStoreState.activeId = 'gugu-managed'
    providerStoreState.hasLoadedProviders = true

    render(<Settings />)

    expect(screen.getByText('Gugu Managed')).toBeInTheDocument()
    expect(screen.queryByText('Claude Official')).not.toBeInTheDocument()
    expect(screen.queryByText('ChatGPT Connect')).not.toBeInTheDocument()
    expect(screen.queryByTestId('claude-official-login')).not.toBeInTheDocument()
  })

  it('requires confirmation before deleting a provider', async () => {
    render(<Settings />)

    fireEvent.click(screen.getAllByText('Delete')[0]!)

    expect(MOCK_DELETE_PROVIDER).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Delete provider "MiniMax-M2.7-highspeed(openai)"? This cannot be undone.')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(MOCK_DELETE_PROVIDER).toHaveBeenCalledWith('provider-1')
  })

  it('uses the shared dropdown for API format in the provider form', () => {
    providerStoreState.presets = [
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://api.example.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'custom-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<Settings />)

    fireEvent.click(screen.getByRole('button', { name: /Add Provider/i }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Anthropic Messages \(native\)/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: /OpenAI Responses API \(proxy\)/i }))

    expect(within(dialog).getByRole('button', { name: /OpenAI Responses API \(proxy\)/i })).toBeInTheDocument()
    expect(within(dialog).getByText('Requests will be translated via the local proxy')).toBeInTheDocument()
    expect(within(dialog).getByText('Resolved endpoint: https://api.example.com/anthropic/v1/responses')).toBeInTheDocument()
  })

  it('warns when custom provider base URL includes the concrete upstream endpoint', () => {
    providerStoreState.presets = [
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://api.example.com/v1/chat/completions',
        apiFormat: 'openai_chat',
        defaultModels: {
          main: 'custom-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
        category: 'custom',
      },
    ]

    render(<Settings />)

    fireEvent.click(screen.getByRole('button', { name: /Add Provider/i }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Use the base URL before /chat/completions. The local proxy appends the chat endpoint automatically.')).toBeInTheDocument()
  })

  it('shows provider preset protocol and fast/pro routing metadata', () => {
    providerStoreState.presets = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'deepseek-v4-pro',
          haiku: 'deepseek-v4-flash',
          sonnet: 'deepseek-v4-pro',
          opus: 'deepseek-v4-pro',
        },
        needsApiKey: true,
        websiteUrl: 'https://platform.deepseek.com',
        category: 'domestic',
        protocol: 'anthropic_compatible',
        agentCompatible: true,
        routingHint: {
          fast: 'haiku',
          balanced: 'main',
          pro: 'sonnet',
        },
      },
      {
        id: 'qwen-dashscope',
        name: 'Qwen / DashScope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiFormat: 'openai_chat',
        defaultModels: {
          main: 'qwen3.6-plus',
          haiku: 'qwen3.6-flash',
          sonnet: 'qwen3.6-plus',
          opus: 'qwen3.6-max-preview',
        },
        needsApiKey: true,
        websiteUrl: 'https://help.aliyun.com/zh/model-studio/',
        category: 'domestic',
        protocol: 'openai_chat_proxy',
        agentCompatible: true,
        routingHint: {
          fast: 'haiku',
          balanced: 'sonnet',
          pro: 'opus',
        },
      },
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: '',
        apiFormat: 'anthropic',
        defaultModels: {
          main: '',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
        category: 'custom',
      },
    ]

    render(<Settings />)

    fireEvent.click(screen.getByRole('button', { name: /Add Provider/i }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Domestic')).toBeInTheDocument()
    expect(within(dialog).getByText('Anthropic-compatible')).toBeInTheDocument()
    expect(within(dialog).getByText('Agent ready')).toBeInTheDocument()
    expect(within(dialog).getByText('Fast: deepseek-v4-flash · Balanced: deepseek-v4-pro · Pro: deepseek-v4-pro')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Qwen / DashScope' }))

    expect(within(dialog).getByText('OpenAI chat via proxy')).toBeInTheDocument()
    expect(within(dialog).getByText('Agent ready via proxy')).toBeInTheDocument()
    expect(within(dialog).getByText('Fast: qwen3.6-flash · Balanced: qwen3.6-plus · Pro: qwen3.6-max-preview')).toBeInTheDocument()
    expect(within(dialog).getByText('Resolved endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')).toBeInTheDocument()
  })

  it('hides the API key by default and reveals it from the eye button', () => {
    providerStoreState.presets = [
      {
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://api.example.com/anthropic',
        apiFormat: 'anthropic',
        defaultModels: {
          main: 'custom-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
        needsApiKey: true,
        websiteUrl: '',
      },
    ]

    render(<Settings />)

    fireEvent.click(screen.getByRole('button', { name: /Add Provider/i }))

    const dialog = screen.getByRole('dialog')
    const apiKeyInput = within(dialog).getByPlaceholderText('sk-...')

    expect(apiKeyInput).toHaveAttribute('type', 'password')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show API Key' }))

    expect(apiKeyInput).toHaveAttribute('type', 'text')
    expect(within(dialog).getByRole('button', { name: 'Hide API Key' })).toBeInTheDocument()
  })
})

describe('Settings > Attachment parser tab', () => {
  beforeEach(() => {
    MOCK_GET_ATTACHMENT_CONFIG.mockReset()
    MOCK_UPDATE_ATTACHMENT_CONFIG.mockReset()
    MOCK_TEST_ATTACHMENT_CONFIG.mockReset()
    MOCK_GET_ATTACHMENT_CONFIG.mockResolvedValue({ config: DEFAULT_ATTACHMENT_CONFIG })
    MOCK_UPDATE_ATTACHMENT_CONFIG.mockResolvedValue({
      config: {
        ...DEFAULT_ATTACHMENT_CONFIG,
        enabled: true,
        hasApiKey: true,
        apiKey: 'glm-...3456',
      },
    })
    MOCK_TEST_ATTACHMENT_CONFIG.mockResolvedValue({
      result: {
        success: true,
        latencyMs: 42,
        modelUsed: 'glm-5.1',
      },
    })

    providerStoreState.providers = []
    providerStoreState.activeId = null
    providerStoreState.hasLoadedProviders = true
    providerStoreState.presets = []
    providerStoreState.isLoading = false
    providerStoreState.isPresetsLoading = false
    providerStoreState.fetchProviders = vi.fn()
    providerStoreState.fetchPresets = vi.fn()

    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ pendingSettingsTab: 'attachmentParser' })
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('loads and saves GLM attachment parser settings', async () => {
    render(<Settings />)

    expect(await screen.findByText('GLM File & Image Parser')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('Custom GLM'))
    fireEvent.change(screen.getByLabelText('GLM API Key'), {
      target: { value: 'glm-secret-123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(MOCK_UPDATE_ATTACHMENT_CONFIG).toHaveBeenCalledWith(expect.objectContaining({
        enabled: true,
        mode: 'custom',
        apiKey: 'glm-secret-123456',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        visionModel: 'glm-5v-turbo',
        ocrModel: 'glm-ocr',
        summarizeModel: 'glm-5.1',
      }))
    })
    expect(await screen.findByText('GLM parser settings saved.')).toBeInTheDocument()
  })

  it('tests the GLM parser connection from the current form values', async () => {
    render(<Settings />)

    await screen.findByText('GLM File & Image Parser')
    fireEvent.click(screen.getByText('Custom GLM'))
    fireEvent.change(screen.getByLabelText('GLM API Key'), {
      target: { value: 'glm-secret-123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))

    await waitFor(() => {
      expect(MOCK_TEST_ATTACHMENT_CONFIG).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'custom',
        apiKey: 'glm-secret-123456',
        summarizeModel: 'glm-5.1',
      }))
    })
    expect(await screen.findAllByText('GLM parser connected (42ms)')).toHaveLength(1)
  })
})

describe('Settings > Config backup tab', () => {
  beforeEach(() => {
    MOCK_EXPORT_CONFIG.mockReset()
    MOCK_PREVIEW_IMPORT.mockReset()
    MOCK_IMPORT_CONFIG.mockReset()
    MOCK_EXPORT_CONFIG.mockResolvedValue({
      format: 'gugu-config-export',
      version: 1,
      exportedAt: '2026-05-15T00:00:00.000Z',
      app: { name: 'Gugu Agent', configDir: 'D:/tmp/.claude' },
      secretsIncluded: false,
      sections: {},
    })
    MOCK_PREVIEW_IMPORT.mockResolvedValue({
      preview: {
        valid: true,
        format: 'gugu-config-export',
        version: 1,
        secretsIncluded: false,
        summary: { add: 1, overwrite: 1, skip: 1, preserve: 0 },
        items: [
          { section: 'providers', name: 'DeepSeek', action: 'overwrite', reason: 'API key is masked and will not be imported.' },
          { section: 'mcp', name: 'rtk', action: 'add' },
          { section: 'plugins', name: 'grill-me', action: 'skip', reason: 'Plugin inventory is exported for sharing.' },
        ],
      },
    })
    MOCK_IMPORT_CONFIG.mockResolvedValue({
      ok: true,
      preview: {
        valid: true,
        format: 'gugu-config-export',
        version: 1,
        secretsIncluded: false,
        summary: { add: 1, overwrite: 1, skip: 1, preserve: 0 },
        items: [],
      },
    })

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:gugu-config'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ pendingSettingsTab: 'configBackup' })
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('exports a config package without secrets by default', async () => {
    render(<Settings />)

    expect(await screen.findByText('Config Backup')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Export JSON/i }))

    await waitFor(() => {
      expect(MOCK_EXPORT_CONFIG).toHaveBeenCalledWith(false)
    })
    expect(await screen.findByText('Configuration export downloaded.')).toBeInTheDocument()
  })

  it('previews a selected config package before applying import', async () => {
    const { container } = render(<Settings />)
    expect(await screen.findByText('Config Backup')).toBeInTheDocument()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([
      JSON.stringify({
        format: 'gugu-config-export',
        version: 1,
        exportedAt: '2026-05-15T00:00:00.000Z',
        app: { name: 'Gugu Agent', configDir: 'D:/tmp/.claude' },
        secretsIncluded: false,
        sections: {},
      }),
    ], 'gugu-config-export.json', { type: 'application/json' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('Import Preview')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek')).toBeInTheDocument()
    expect(screen.getByText('rtk')).toBeInTheDocument()
    expect(screen.getByText('grill-me')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apply Import' }))

    await waitFor(() => {
      expect(MOCK_IMPORT_CONFIG).toHaveBeenCalledWith(expect.objectContaining({
        format: 'gugu-config-export',
      }), true)
    })
    expect(await screen.findByText('Configuration import applied.')).toBeInTheDocument()
  })
})

describe('Settings > Billing tab', () => {
  beforeEach(() => {
    billingStoreState.status = {
      status: 'not_configured',
      plan: null,
      expiresAt: null,
      maskedLicenseKey: null,
      purchaseUrl: null,
      lastCheckedAt: null,
      message: 'Subscription is coming soon.',
      deviceId: null,
      creditsTotal: null,
      creditsRemaining: null,
      isTrial: false,
      quotaReason: null,
    }
    billingStoreState.config = {
      purchaseUrl: null,
      verifyUrlConfigured: false,
      gatewayUrlConfigured: false,
    }
    billingStoreState.isLoading = false
    billingStoreState.isSaving = false
    billingStoreState.error = null
    billingStoreState.message = null
    billingStoreState.fetchBilling = vi.fn().mockResolvedValue(undefined)
    billingStoreState.activateLicense = vi.fn().mockResolvedValue(undefined)
    billingStoreState.refresh = vi.fn().mockResolvedValue(undefined)
    billingStoreState.clearLicense = vi.fn().mockResolvedValue(undefined)

    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ pendingSettingsTab: 'billing' })
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('shows disabled purchase and activation controls when URLs are not configured', async () => {
    render(<Settings />)

    expect(await screen.findByRole('heading', { name: 'Subscription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Purchase/i })).toBeDisabled()
    expect(screen.getByLabelText('Activation code')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled()
    expect(screen.getByText('Activation service is not configured yet.')).toBeInTheDocument()
  })

  it('opens the configured purchase URL from the purchase button', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    billingStoreState.status = {
      ...billingStoreState.status!,
      purchaseUrl: 'https://billing.example.com/gugu',
    }
    billingStoreState.config = {
      purchaseUrl: 'https://billing.example.com/gugu',
      verifyUrlConfigured: false,
      gatewayUrlConfigured: false,
    }

    render(<Settings />)

    await screen.findByRole('heading', { name: 'Subscription' })
    fireEvent.click(screen.getByRole('button', { name: /Purchase/i }))

    expect(openSpy).toHaveBeenCalledWith('https://billing.example.com/gugu', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('submits activation codes only when verification is configured', async () => {
    billingStoreState.config = {
      purchaseUrl: null,
      verifyUrlConfigured: true,
      gatewayUrlConfigured: false,
    }

    render(<Settings />)

    await screen.findByRole('heading', { name: 'Subscription' })
    fireEvent.change(screen.getByLabelText('Activation code'), {
      target: { value: 'license-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => {
      expect(billingStoreState.activateLicense).toHaveBeenCalledWith('license-123')
    })
  })

  it('shows remaining usage percentage without trial quota copy', async () => {
    billingStoreState.status = {
      ...billingStoreState.status!,
      status: 'active',
      creditsTotal: 50,
      creditsRemaining: 38,
      isTrial: true,
      message: 'Gateway entitlement is active.',
    }
    billingStoreState.message = 'Gateway entitlement is active.'
    billingStoreState.config = {
      purchaseUrl: 'https://billing.example.com/gugu',
      verifyUrlConfigured: false,
      gatewayUrlConfigured: true,
    }

    render(<Settings />)

    await screen.findByRole('heading', { name: 'Subscription' })

    expect(screen.getByText('76% left')).toBeInTheDocument()
    expect(screen.getByText('Your current plan can be used normally.')).toBeInTheDocument()
    expect(screen.queryByText('Trial credits are active on this device.')).not.toBeInTheDocument()
    expect(screen.queryByText('Gateway entitlement is active.')).not.toBeInTheDocument()
  })
})

describe('Settings > About tab', () => {
  beforeEach(() => {
    useUIStore.setState({ pendingSettingsTab: 'about' })
    useUpdateStore.setState({
      status: 'available',
      availableVersion: '0.1.5',
      releaseNotes: '# Gugu Agent v0.1.5\n\n- Fixed updater rendering\n- Added markdown support',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('renders release notes with markdown formatting', async () => {
    render(<Settings />)

    expect(await screen.findByRole('heading', { name: 'Gugu Agent v0.1.5' })).toBeInTheDocument()
    expect(screen.getByText('Fixed updater rendering')).toBeInTheDocument()
    expect(screen.getByText('Added markdown support')).toBeInTheDocument()
  })

  it('shows downloaded bytes instead of a fake zero percent when total size is unknown', async () => {
    useUpdateStore.setState({
      status: 'downloading',
      availableVersion: '0.1.5',
      releaseNotes: '# Gugu Agent v0.1.5',
      progressPercent: 0,
      downloadedBytes: 1536,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })

    render(<Settings />)

    expect(await screen.findByText('Downloading update... 1.5 KB downloaded')).toBeInTheDocument()
    expect(screen.queryByText('Downloading update... 0%')).not.toBeInTheDocument()
  })
})
