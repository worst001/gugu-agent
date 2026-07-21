import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handlePluginsApi } from '../api/plugins.js'
import { normalizeGitRepositoryUrl } from '../services/gitExtensionInstallService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalPackDir: string | undefined

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
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('Plugins API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-plugins-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalPackDir = process.env.GUGU_AGENT_PACK_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.GUGU_AGENT_PACK_DIR = path.join(tmpDir, 'missing-agent-pack')
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    if (originalPackDir === undefined) {
      delete process.env.GUGU_AGENT_PACK_DIR
    } else {
      process.env.GUGU_AGENT_PACK_DIR = originalPackDir
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('GET /api/plugins returns an empty plugin list for a clean config', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/plugins')
    const res = await handlePluginsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      plugins: unknown[]
      marketplaces: unknown[]
      summary: { total: number; enabled: number; errorCount: number }
    }

    expect(body.plugins).toEqual([])
    expect(Array.isArray(body.marketplaces)).toBe(true)
    expect(body.summary.total).toBe(0)
    expect(body.summary.enabled).toBe(0)
    expect(body.summary.errorCount).toBe(0)
  })

  it('POST /api/plugins/reload returns numeric counters', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/plugins/reload', {})
    const res = await handlePluginsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      summary: Record<string, number>
    }

    expect(body.ok).toBe(true)
    expect(typeof body.summary.enabled).toBe('number')
    expect(typeof body.summary.skills).toBe('number')
    expect(typeof body.summary.errors).toBe('number')
  })

  it('requires trust confirmation before installing a Git source', async () => {
    const { req, url, segments } = makeRequest(
      'POST',
      '/api/plugins/install-source',
      { source: 'https://github.com/heygen-com/hyperframes' },
    )
    const res = await handlePluginsApi(req, url, segments)
    expect(res.status).toBe(400)
  })

  it('rejects text/plain bodies for Git source installation', async () => {
    const url = new URL('/api/plugins/install-source', 'http://localhost:3456')
    const req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ source: 'https://github.com/example/repo', confirmed: true }),
    })
    const segments = url.pathname.split('/').filter(Boolean)
    const res = await handlePluginsApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  it('accepts supported HTTPS Git hosts and rejects unsafe sources', () => {
    expect(normalizeGitRepositoryUrl(
      'https://gitee.com/example/video-skills/?utm_source=test#readme',
    )).toBe('https://gitee.com/example/video-skills')
    expect(() => normalizeGitRepositoryUrl(
      'http://github.com/example/repo',
    )).toThrow('HTTPS')
    expect(() => normalizeGitRepositoryUrl(
      'https://user:secret@github.com/example/repo',
    )).toThrow('credentials')
    expect(() => normalizeGitRepositoryUrl(
      'https://example.com/example/repo',
    )).toThrow('Supported Git hosts')
  })
})
