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
    expect((calls[0]!.body as FormData).get('file_type')).toBe('XLSX')
  })

  test('fetches parser result text when GLM returns a task id for a Word document', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const service = new AttachmentParserService(async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      if (String(url).endsWith('/files/parser/sync')) {
        return jsonResponse({
          success: true,
          message: 'created',
          task_id: 'task-docx',
        })
      }
      return jsonResponse({
        data: {
          content: '# Word Document\nParsed from fallback result.',
        },
      })
    })
    await service.updateConfig({ enabled: true, mode: 'custom', apiKey: 'glm-key' })

    const result = await service.prepareMessageContent('read Word', 'session-1', [{
      type: 'file',
      name: 'contract.docx',
      data: Buffer.from('docx').toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }])

    expect(result.content).toContain('# Word Document')
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toEndWith('/files/parser/sync')
    expect((calls[0]!.body as FormData).get('file_type')).toBe('DOCX')
    expect(calls[1]!.url).toEndWith('/files/parser/result/task-docx/text')
  })

  test('keeps compressed archives as local metadata instead of sending them to GLM', async () => {
    const service = new AttachmentParserService(async () => {
      throw new Error('archive attachment should not reach GLM')
    })

    const result = await service.prepareMessageContent('read this zip', 'session-1', [{
      type: 'file',
      name: 'ESP32-project.zip',
      data: Buffer.from('zip').toString('base64'),
      mimeType: 'application/zip',
    }])

    expect(result.usedParser).toBe(true)
    expect(result.content).toContain('Compressed archive attached: ESP32-project.zip')
    expect(result.content).toContain('was not uploaded to Gugu Managed or GLM')
  })

  test('does not send unsupported archive formats to Gugu Managed or GLM', async () => {
    const service = new AttachmentParserService(async () => {
      throw new Error('unsupported archive should not reach GLM')
    })
    const workDir = path.join(tmpDir, 'workspace-rar')
    await fs.mkdir(workDir)
    const archivePath = path.join(tmpDir, 'assets.rar')
    await fs.writeFile(archivePath, Buffer.from('not-a-real-rar'))

    const result = await service.prepareMessageContent('read this archive', 'session-1', [{
      type: 'file',
      name: 'assets.rar',
      path: archivePath,
      mimeType: 'application/vnd.rar',
    }], workDir)

    expect(result.usedParser).toBe(true)
    expect(result.content).toContain('Compressed archive attached: assets.rar')
    expect(result.content).toContain('was not uploaded to Gugu Managed or GLM')
    expect(result.content).toContain('not supported for automatic local extraction')
  })

  test('extracts supported zip archives into the current workspace for local analysis', async () => {
    const service = new AttachmentParserService(async () => {
      throw new Error('zip archive should not reach GLM')
    })
    const workDir = path.join(tmpDir, 'workspace')
    await fs.mkdir(workDir)
    const archivePath = path.join(tmpDir, 'demo.zip')
    await fs.writeFile(archivePath, createStoredZip({
      'README.md': '# Demo\n',
      'src/main.ts': 'console.log("hello")\n',
    }))

    const result = await service.prepareMessageContent('看看这个压缩包', 'session-1', [{
      type: 'file',
      name: 'demo.zip',
      path: archivePath,
      mimeType: 'application/zip',
    }], workDir)

    expect(result.usedParser).toBe(true)
    expect(result.content).toContain('Compressed archive extracted locally: demo.zip')
    expect(result.content).toContain('Analyze the extracted directory with local filesystem tools')

    const extractedDir = result.content.match(/Extracted directory: (.+)/)?.[1]?.trim()
    expect(extractedDir).toBeTruthy()
    expect(extractedDir!.startsWith(path.join(workDir, '.gugu', 'archive-extracts'))).toBe(true)
    expect(await fs.readFile(path.join(extractedDir!, 'README.md'), 'utf-8')).toBe('# Demo\n')
    expect(await fs.readFile(path.join(extractedDir!, 'src', 'main.ts'), 'utf-8')).toContain('hello')
  })

  test('rejects oversized file paths before reading them into memory', async () => {
    const service = new AttachmentParserService(mockFetchText('unused'))
    const filePath = path.join(tmpDir, 'large.pdf')
    await fs.writeFile(filePath, Buffer.alloc((20 * 1024 * 1024) + 1))

    await expect(service.prepareMessageContent('read this file', 'session-1', [{
      type: 'file',
      name: 'large.pdf',
      path: filePath,
      mimeType: 'application/pdf',
    }])).rejects.toThrow('per-file limit')
  })

  test('keeps managed binary parsing on a small-file path so gateway does not carry large uploads', async () => {
    const service = new AttachmentParserService(mockFetchText('unused'))

    await expect(service.prepareMessageContent('read this file', 'session-1', [{
      type: 'file',
      name: 'large.pdf',
      data: Buffer.alloc((8 * 1024 * 1024) + 1).toString('base64'),
      mimeType: 'application/pdf',
    }])).rejects.toThrow('Gugu Managed only parses small')
  })

  test('keeps managed image parsing under the stricter GLM image limit', async () => {
    const service = new AttachmentParserService(mockFetchText('unused'))

    await expect(service.prepareMessageContent('read this image', 'session-1', [{
      type: 'image',
      name: 'large.png',
      data: Buffer.alloc((5 * 1024 * 1024) + 1).toString('base64'),
      mimeType: 'image/png',
    }])).rejects.toThrow('managed image limit')
  })

  test('rejects unsupported managed image formats before they reach GLM', async () => {
    const service = new AttachmentParserService(async () => {
      throw new Error('unsupported image should not reach GLM')
    })

    await expect(service.prepareMessageContent('read this image', 'session-1', [{
      type: 'image',
      name: 'diagram.webp',
      data: Buffer.from('webp').toString('base64'),
      mimeType: 'image/webp',
    }])).rejects.toThrow('not a supported managed image format')
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

function createStoredZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt32LE(0, 10)
    localHeader.writeUInt32LE(0, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localParts.push(localHeader, nameBytes, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt32LE(0, 12)
    centralHeader.writeUInt32LE(0, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBytes)

    offset += localHeader.length + nameBytes.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralDirectory, end])
}
