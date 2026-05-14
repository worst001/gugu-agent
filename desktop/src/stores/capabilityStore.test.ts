import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachmentParserApi } from '../api/attachmentParser'
import { mcpApi } from '../api/mcp'
import { modelsApi } from '../api/models'
import { pluginsApi } from '../api/plugins'
import { skillsApi } from '../api/skills'
import { useCapabilityStore } from './capabilityStore'

vi.mock('../api/attachmentParser', () => ({
  attachmentParserApi: {
    getConfig: vi.fn(),
  },
}))

vi.mock('../api/mcp', () => ({
  mcpApi: {
    list: vi.fn(),
  },
}))

vi.mock('../api/models', () => ({
  modelsApi: {
    list: vi.fn(),
    getCurrent: vi.fn(),
    getEffort: vi.fn(),
  },
}))

vi.mock('../api/plugins', () => ({
  pluginsApi: {
    list: vi.fn(),
  },
}))

vi.mock('../api/skills', () => ({
  skillsApi: {
    list: vi.fn(),
  },
}))

const initialState = useCapabilityStore.getState()
const refreshCapabilities = initialState.refreshCapabilities

describe('capabilityStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCapabilityStore.setState({
      summary: initialState.summary,
      isLoading: false,
      refreshCapabilities,
    })

    vi.mocked(modelsApi.list).mockResolvedValue({
      models: [],
      provider: { id: 'deepseek', name: 'DeepSeek' },
    })
    vi.mocked(modelsApi.getCurrent).mockResolvedValue({
      model: {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        description: '',
        context: '128k',
      },
    })
    vi.mocked(modelsApi.getEffort).mockResolvedValue({
      level: 'max',
      available: ['low', 'medium', 'high', 'max'],
    })
    vi.mocked(attachmentParserApi.getConfig).mockResolvedValue({
      config: {
        enabled: true,
        hasApiKey: true,
        apiKey: '******',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        visionModel: 'glm-5v-turbo',
        ocrModel: 'glm-ocr',
        summarizeModel: 'glm-5.1',
      },
    })
    vi.mocked(mcpApi.list).mockResolvedValue({
      servers: [
        {
          name: 'ready',
          scope: 'user',
          transport: 'http',
          enabled: true,
          status: 'connected',
          statusLabel: 'Connected',
          configLocation: 'User',
          summary: '',
          canEdit: true,
          canRemove: true,
          canReconnect: true,
          canToggle: true,
          config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
        },
        {
          name: 'broken',
          scope: 'user',
          transport: 'stdio',
          enabled: true,
          status: 'failed',
          statusLabel: 'Unavailable',
          configLocation: 'User',
          summary: '',
          canEdit: true,
          canRemove: true,
          canReconnect: true,
          canToggle: true,
          config: { type: 'stdio', command: 'missing', args: [], env: {} },
        },
      ],
    })
    vi.mocked(skillsApi.list).mockResolvedValue({
      skills: [
        {
          name: 'ce-plan',
          description: '',
          source: 'user',
          userInvocable: true,
          contentLength: 10,
          hasDirectory: true,
        },
        {
          name: 'internal',
          description: '',
          source: 'user',
          userInvocable: false,
          contentLength: 10,
          hasDirectory: true,
        },
      ],
    })
    vi.mocked(pluginsApi.list).mockResolvedValue({
      plugins: [],
      marketplaces: [],
      summary: {
        total: 3,
        enabled: 2,
        errorCount: 1,
        marketplaceCount: 1,
      },
    })
  })

  it('aggregates provider, model, parser, MCP, skills, and plugin status', async () => {
    await useCapabilityStore.getState().refreshCapabilities('D:/repo', { force: true })

    const summary = useCapabilityStore.getState().summary
    expect(summary.providerName).toBe('DeepSeek')
    expect(summary.model?.id).toBe('deepseek-v4-pro')
    expect(summary.effort).toBe('max')
    expect(summary.attachmentParser.status).toBe('ready')
    expect(summary.mcp).toEqual({ total: 2, connected: 1, attention: 1 })
    expect(summary.skills).toEqual({ total: 2, invocable: 1 })
    expect(summary.plugins).toEqual({ total: 3, enabled: 2, errors: 1 })
  })

  it('marks enabled GLM parser without an API key as needing configuration', async () => {
    vi.mocked(attachmentParserApi.getConfig).mockResolvedValueOnce({
      config: {
        enabled: true,
        hasApiKey: false,
        apiKey: '',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        visionModel: 'glm-5v-turbo',
        ocrModel: 'glm-ocr',
        summarizeModel: 'glm-5.1',
      },
    })

    await useCapabilityStore.getState().refreshCapabilities(undefined, { force: true })

    expect(useCapabilityStore.getState().summary.attachmentParser.status).toBe('needs_config')
  })

  it('keeps a partial summary when one capability endpoint fails', async () => {
    vi.mocked(skillsApi.list).mockRejectedValueOnce(new Error('skills unavailable'))

    await useCapabilityStore.getState().refreshCapabilities(undefined, { force: true })

    const summary = useCapabilityStore.getState().summary
    expect(summary.providerName).toBe('DeepSeek')
    expect(summary.errors.skills).toBe('skills unavailable')
    expect(summary.skills).toEqual({ total: 0, invocable: 0 })
  })
})
