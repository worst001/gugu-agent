import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { ConfigBackupService } from '../services/configBackupService.js'

describe('ConfigBackupService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-config-backup-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('exports providers and GLM parser config with secrets masked by default', async () => {
    await writeJson(path.join(tmpDir, 'cc-haha', 'providers.json'), {
      activeId: 'provider-1',
      providers: [{
        id: 'provider-1',
        presetId: 'deepseek',
        name: 'DeepSeek',
        apiKey: 'deepseek-secret-key',
        baseUrl: 'https://api.deepseek.com',
        apiFormat: 'openai_chat',
        authKind: 'api_key',
        models: {
          main: 'deepseek-v4-pro',
          haiku: 'deepseek-v4-flash',
          sonnet: 'deepseek-v4-pro',
          opus: 'deepseek-v4-pro',
        },
      }],
    })
    await writeJson(path.join(tmpDir, 'cc-haha', 'attachment-parser.json'), {
      enabled: true,
      apiKey: 'glm-secret-key',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      visionModel: 'glm-5v-turbo',
      ocrModel: 'glm-ocr',
      summarizeModel: 'glm-5.1',
    })

    const service = new ConfigBackupService()
    const exported = await service.exportConfig()
    const serialized = JSON.stringify(exported)

    expect(exported.secretsIncluded).toBe(false)
    expect(serialized).not.toContain('deepseek-secret-key')
    expect(serialized).not.toContain('glm-secret-key')
    expect(exported.sections.providers?.providers[0]?.apiKey).toBe('')
    expect(exported.sections.providers?.providers[0]?.apiKeyMasked).toBe('deep...-key')
    expect(exported.sections.attachmentParser?.apiKey).toBe('')
    expect(exported.sections.attachmentParser?.apiKeyMasked).toBe('glm-...-key')
  })

  test('import preserves existing provider API key when the package omits secrets', async () => {
    await writeJson(path.join(tmpDir, 'cc-haha', 'providers.json'), {
      activeId: 'provider-1',
      providers: [{
        id: 'provider-1',
        presetId: 'deepseek',
        name: 'Old DeepSeek',
        apiKey: 'existing-secret',
        baseUrl: 'https://old.example.com',
        apiFormat: 'openai_chat',
        authKind: 'api_key',
        models: {
          main: 'old-main',
          haiku: 'old-haiku',
          sonnet: 'old-sonnet',
          opus: 'old-opus',
        },
      }],
    })

    const service = new ConfigBackupService()
    await service.importConfig({
      format: 'gugu-config-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      app: { name: 'Gugu Agent', configDir: tmpDir },
      secretsIncluded: false,
      sections: {
        providers: {
          activeId: 'provider-1',
          providers: [{
            id: 'provider-1',
            presetId: 'deepseek',
            name: 'New DeepSeek',
            apiKey: '',
            apiKeyMasked: 'exis...cret',
            hasApiKey: true,
            baseUrl: 'https://new.example.com',
            apiFormat: 'openai_chat',
            authKind: 'api_key',
            models: {
              main: 'new-main',
              haiku: 'new-haiku',
              sonnet: 'new-sonnet',
              opus: 'new-opus',
            },
          }],
        },
      },
    })

    const index = await readJson(path.join(tmpDir, 'cc-haha', 'providers.json'))
    expect(index.providers[0].name).toBe('New DeepSeek')
    expect(index.providers[0].apiKey).toBe('existing-secret')
    expect(index.providers[0].baseUrl).toBe('https://new.example.com')
  })

  test('registers config backup export through the API router', async () => {
    const url = new URL('http://127.0.0.1:3456/api/config-backup/export')
    const response = await handleApiRequest(new Request(url), url)

    expect(response.status).toBe(200)
    const body = await response.json() as { format?: string; version?: number }
    expect(body).toMatchObject({
      format: 'gugu-config-export',
      version: 1,
    })
  })
})

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'))
}
