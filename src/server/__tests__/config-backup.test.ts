import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { ConfigBackupService } from '../services/configBackupService.js'
import { DesktopProfileService } from '../services/desktopProfileService.js'

describe('ConfigBackupService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalDesktopConfigDir: string | undefined
  let originalDesktopDataDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-config-backup-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalDesktopConfigDir = process.env.GUGU_DESKTOP_CONFIG_DIR
    originalDesktopDataDir = process.env.GUGU_DESKTOP_DATA_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.GUGU_DESKTOP_CONFIG_DIR = path.join(tmpDir, 'desktop-config')
    process.env.GUGU_DESKTOP_DATA_DIR = path.join(tmpDir, 'desktop-data')
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalDesktopConfigDir === undefined) delete process.env.GUGU_DESKTOP_CONFIG_DIR
    else process.env.GUGU_DESKTOP_CONFIG_DIR = originalDesktopConfigDir
    if (originalDesktopDataDir === undefined) delete process.env.GUGU_DESKTOP_DATA_DIR
    else process.env.GUGU_DESKTOP_DATA_DIR = originalDesktopDataDir
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

  test('exports desktop preferences without private workspace state by default', async () => {
    const profileService = new DesktopProfileService()
    await profileService.updateBundle({
      profile: {
        preferences: {
          appearance: { theme: 'green-dark', locale: 'en' },
          layout: { sidebarWidth: 320 },
        },
      },
      workspaceState: {
        projects: { pinned: ['D:/work'] },
        drafts: { session: { text: 'recover me', updatedAt: 10 } },
      },
    })
    const service = new ConfigBackupService()
    const exported = await service.exportConfig()
    const desktop = exported.sections.guiPreferences?.desktop as Record<string, unknown>

    expect(exported.version).toBe(2)
    expect(desktop).toHaveProperty('profile')
    expect(desktop).not.toHaveProperty('workspaceState')
    expect(JSON.stringify(exported)).not.toContain('recover me')
    expect(JSON.stringify(exported)).not.toContain('D:/work')
    expect(JSON.stringify(exported)).not.toContain(tmpDir)
    await profileService.reset()
    await service.importConfig(exported)

    const restored = await profileService.getBundle()
    expect(restored.profile.preferences.appearance).toEqual({ theme: 'green-dark', locale: 'en' })
    expect(restored.profile.preferences.layout.sidebarWidth).toBe(320)
    expect(restored.workspaceState.projects.pinned).toEqual([])
    expect(restored.workspaceState.drafts).toEqual({})
  })

  test('round-trips private desktop workspace state when explicitly included', async () => {
    const profileService = new DesktopProfileService()
    await profileService.updateBundle({
      profile: {
        preferences: {
          appearance: { theme: 'green-dark', locale: 'en' },
        },
      },
      workspaceState: {
        projects: { pinned: ['D:/work'] },
        drafts: { session: { text: 'recover me', updatedAt: 10 } },
      },
    })
    const service = new ConfigBackupService()
    const exported = await service.exportConfig({ includeSecrets: true })

    expect(exported.secretsIncluded).toBe(true)
    expect(exported.sections.guiPreferences).toHaveProperty(
      'desktop.workspaceState',
    )
    await profileService.reset()
    await service.importConfig(exported)

    const restored = await profileService.getBundle()
    expect(restored.workspaceState.projects.pinned).toEqual(['D:/work'])
    expect(restored.workspaceState.drafts.session?.text).toBe('recover me')
  })

  test('migrates a version 1 backup theme into the desktop profile', async () => {
    const service = new ConfigBackupService()
    await service.importConfig({
      format: 'gugu-config-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      app: { name: 'Gugu Agent', configDir: tmpDir },
      secretsIncluded: false,
      sections: {
        guiPreferences: {
          theme: 'gray-dark',
          model: 'deepseek-v4',
        },
      },
    })

    const restored = await new DesktopProfileService().getBundle()
    expect(restored.profile.preferences.appearance.theme).toBe('gray-dark')
  })

  test('registers config backup export through the API router', async () => {
    const url = new URL('http://127.0.0.1:3456/api/config-backup/export')
    const response = await handleApiRequest(new Request(url), url)

    expect(response.status).toBe(200)
    const body = await response.json() as { format?: string; version?: number }
    expect(body).toMatchObject({
      format: 'gugu-config-export',
      version: 2,
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
