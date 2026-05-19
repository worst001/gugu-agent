import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import {
  AttachmentParserError,
  AttachmentParserService,
} from '../services/attachmentParserService.js'

describe('AttachmentParserService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-attachment-parser-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('saves config and masks the API key when reading public config', async () => {
    const service = new AttachmentParserService(mockFetchText('ok'))

    const config = await service.updateConfig({
      enabled: true,
      mode: 'custom',
      apiKey: 'glm-secret-123456',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      visionModel: 'glm-5v-turbo',
      ocrModel: 'glm-ocr',
      summarizeModel: 'glm-5.1',
    })

    expect(config.enabled).toBe(true)
    expect(config.mode).toBe('custom')
    expect(config.hasApiKey).toBe(true)
    expect(config.apiKey).toBe('glm-...3456')
    expect(JSON.stringify(config)).not.toContain('glm-secret-123456')
  })

  test('tests GLM connection with thinking disabled for short health checks', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const service = new AttachmentParserService(async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })

    const result = await service.testConfig({
      mode: 'custom',
      apiKey: 'glm-key',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      visionModel: 'glm-5v-turbo',
      ocrModel: 'glm-ocr',
      summarizeModel: 'glm-5.1',
    })

    expect(result.success).toBe(true)
    expect(calls[0]!.url).toEndWith('/chat/completions')
    const body = JSON.parse(String(calls[0]!.body)) as {
      max_tokens?: number
      thinking?: { type?: string }
    }
    expect(body.max_tokens).toBeGreaterThanOrEqual(64)
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  test('fails with a friendly error when custom mode is enabled without a GLM key', async () => {
    const service = new AttachmentParserService(mockFetchText('unused'))
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: '' })

    await expect(service.prepareMessageContent('what is this?', 'session-1', [{
      type: 'image',
      name: 'screen.png',
      data: Buffer.from('image').toString('base64'),
      mimeType: 'image/png',
    }])).rejects.toBeInstanceOf(AttachmentParserError)
  })

  test('parses markdown files locally without a GLM key or network call', async () => {
    let called = false
    const service = new AttachmentParserService(async () => {
      called = true
      return jsonResponse({ content: 'should not be used' })
    })
    await service.updateConfig({ enabled: true, apiKey: '' })

    const result = await service.prepareMessageContent('read this file', 'session-1', [{
      type: 'file',
      name: 'PLAN.md',
      data: Buffer.from('# Plan\n\n- Phase one\n- Phase two', 'utf8').toString('base64'),
      mimeType: 'text/markdown',
    }])

    expect(called).toBe(false)
    expect(result.usedParser).toBe(true)
    expect(result.attachments).toBeUndefined()
    expect(result.content).toContain('attachment_parse_results')
    expect(result.content).toContain('# Plan')
    expect(result.preview?.results[0]).toMatchObject({
      name: 'PLAN.md',
      method: 'local-text',
      markdown: '# Plan\n\n- Phase one\n- Phase two',
    })
  })

  test('parses image attachments with glm-5v-turbo and removes raw attachments for the CLI', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const service = new AttachmentParserService(async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      return jsonResponse({
        choices: [{ message: { content: '# Image Analysis\nSaw a screenshot.' } }],
      })
    })
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: 'glm-key' })

    const result = await service.prepareMessageContent('what is this?', 'session-1', [{
      type: 'image',
      name: 'screen.png',
      data: Buffer.from('image').toString('base64'),
      mimeType: 'image/png',
    }])

    expect(result.usedParser).toBe(true)
    expect(result.attachments).toBeUndefined()
    expect(result.content).toContain('attachment_parse_results')
    expect(result.content).toContain('# Image Analysis')
    expect(result.preview).toMatchObject({
      promptText: result.content,
      results: [
        {
          name: 'screen.png',
          type: 'image',
          mimeType: 'image/png',
          method: 'vision',
          markdown: '# Image Analysis\nSaw a screenshot.',
        },
      ],
    })
    expect(calls[0]!.url).toEndWith('/chat/completions')
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>
    expect(body.model).toBe('glm-5v-turbo')
  })

  test('parses PDFs with glm-ocr layout parsing', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const service = new AttachmentParserService(async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      return jsonResponse({ md_results: '# PDF OCR\nImportant rows' })
    })
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: 'glm-key' })

    const result = await service.prepareMessageContent('read PDF', 'session-1', [{
      type: 'file',
      name: 'report.pdf',
      data: Buffer.from('%PDF').toString('base64'),
      mimeType: 'application/pdf',
    }])

    expect(result.content).toContain('# PDF OCR')
    expect(calls[0]!.url).toEndWith('/layout_parsing')
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>
    expect(body.model).toBe('glm-ocr')
  })

  test('parses nested glm-ocr markdown results', async () => {
    const service = new AttachmentParserService(async () => jsonResponse({
      data: {
        md_results: '# Nested PDF OCR\nImportant rows',
      },
    }))
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: 'glm-key' })

    const result = await service.prepareMessageContent('read nested PDF', 'session-1', [{
      type: 'file',
      name: 'nested.pdf',
      data: Buffer.from('%PDF').toString('base64'),
      mimeType: 'application/pdf',
    }])

    expect(result.content).toContain('# Nested PDF OCR')
    expect(result.preview?.results[0]?.method).toBe('ocr')
  })

  test('parses office files with the GLM sync file parser', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const service = new AttachmentParserService(async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      return jsonResponse({ content: '# Sheet\nRevenue table' })
    })
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: 'glm-key' })

    const result = await service.prepareMessageContent('read workbook', 'session-1', [{
      type: 'file',
      name: 'sheet.xlsx',
      data: Buffer.from('xlsx').toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }])

    expect(result.content).toContain('# Sheet')
    expect(calls[0]!.url).toEndWith('/files/parser/sync')
    expect(calls[0]!.body).toBeInstanceOf(FormData)
  })

  test('summarizes very long parsed results with glm-5.1', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const service = new AttachmentParserService(async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      if (calls.length === 1) {
        return jsonResponse({
          choices: [{ message: { content: 'x'.repeat(25_000) } }],
        })
      }
      return jsonResponse({
        choices: [{ message: { content: '# Summary' } }],
      })
    })
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: 'glm-key' })

    const result = await service.prepareMessageContent('summarize', 'session-1', [{
      type: 'image',
      name: 'big.png',
      data: Buffer.from('image').toString('base64'),
      mimeType: 'image/png',
    }])

    expect(calls).toHaveLength(2)
    const summaryBody = JSON.parse(String(calls[1]!.body)) as Record<string, unknown>
    expect(summaryBody.model).toBe('glm-5.1')
    expect(result.content).toContain('# Summary')
  })

  test('registers attachment parser config through the API router', async () => {
    const url = new URL('http://127.0.0.1:3456/api/attachment-parser/config')
    const response = await handleApiRequest(new Request(url), url)

    expect(response.status).toBe(200)
    const body = await response.json() as { config?: { enabled?: boolean; mode?: string; hasApiKey?: boolean } }
    expect(body.config).toMatchObject({
      enabled: true,
      mode: 'managed',
      hasApiKey: false,
    })
  })
})

function mockFetchText(text: string): typeof fetch {
  return async () => jsonResponse({ choices: [{ message: { content: text } }] })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
