import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-presets-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('provider presets API', () => {
  test('GET /api/providers/presets returns the configured presets', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ presets: PROVIDER_PRESETS })
  })

  test('configured presets only expose Gugu Managed and Custom', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual(['gugu-managed', 'custom'])
  })

  test('Gugu Managed is the only built-in managed preset', () => {
    const gugu = PROVIDER_PRESETS.find((preset) => preset.id === 'gugu-managed')

    expect(gugu).toMatchObject({
      name: 'Gugu Managed',
      baseUrl: 'gugu://managed',
      apiFormat: 'gugu_managed',
      needsApiKey: false,
      category: 'official',
      protocol: 'gugu_managed',
      agentCompatible: true,
      routingHint: {
        fast: 'haiku',
        balanced: 'main',
        pro: 'opus',
      },
    })
    expect(gugu?.defaultModels).toEqual({
      main: 'gugu-managed-main',
      haiku: 'gugu-managed-fast',
      sonnet: 'gugu-managed-main',
      opus: 'gugu-managed-strong',
    })
  })

  test('Custom remains available for users who bring their own endpoint', () => {
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(custom).toMatchObject({
      name: 'Custom',
      baseUrl: '',
      apiFormat: 'anthropic',
      needsApiKey: true,
      websiteUrl: '',
      category: 'custom',
      defaultModels: {
        main: '',
        haiku: '',
        sonnet: '',
        opus: '',
      },
    })
    expect(custom?.apiKeyUrl).toBeUndefined()
    expect(custom?.promoText).toBeUndefined()
  })

  test('GET and PUT /api/providers/settings read and write cc-haha settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5.1',
      },
      model: 'glm-5.1',
    }
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'cc-haha', 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getReq = makeRequest('GET', '/api/providers/settings')
    const getRes = await handleProvidersApi(getReq.req, getReq.url, getReq.segments)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual(initial)

    const updateBody = {
      model: 'custom-main',
      env: {
        ANTHROPIC_MODEL: 'custom-main',
      },
    }
    const putReq = makeRequest('PUT', '/api/providers/settings', updateBody)
    const putRes = await handleProvidersApi(putReq.req, putReq.url, putReq.segments)
    expect(putRes.status).toBe(200)

    const updatedRaw = await fs.readFile(path.join(tmpDir, 'cc-haha', 'settings.json'), 'utf-8')
    expect(JSON.parse(updatedRaw)).toEqual(updateBody)
  })
})
