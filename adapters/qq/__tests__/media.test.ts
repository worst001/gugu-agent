import { describe, it, expect } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { AttachmentStore } from '../../common/attachment/attachment-store.js'
import { collectQqAttachments, parseOfficialMessage, parseOneBotMessage } from '../media.js'

describe('QQ media parsing', () => {
  it('extracts text from official SDK text segments', () => {
    const parsed = parseOfficialMessage('', [
      { type: 'text', data: { text: '你好' } },
      { type: 'image', data: { url: 'https://example.com/a.png' } },
    ])

    expect(parsed.text).toBe('你好')
    expect(parsed.segments.length).toBe(2)
  })

  it('strips official media tags from raw fallback text', () => {
    const parsed = parseOfficialMessage('看这个 <image,url=https://example.com/a.png>', [])
    expect(parsed.text).toBe('看这个')
  })

  it('extracts OneBot text segments and preserves media segments', () => {
    const parsed = parseOneBotMessage('', [
      { type: 'text', data: { text: '分析一下' } },
      { type: 'file', data: { file_id: 'abc', name: 'report.pdf' } },
    ])

    expect(parsed.text).toBe('分析一下')
    expect(parsed.segments[1]!.type).toBe('file')
  })

  it('strips OneBot CQ media tags from raw fallback text', () => {
    const parsed = parseOneBotMessage('看看[CQ:image,file=a.jpg]', [])
    expect(parsed.text).toBe('看看')
  })

  it('strips OneBot at tags from string messages', () => {
    const parsed = parseOneBotMessage('', '[CQ:at,qq=123]截图')
    expect(parsed.text).toBe('截图')
  })

  it('turns local OneBot file segments into AttachmentRefs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-media-test-'))
    const source = path.join(root, 'report.txt')
    await fs.writeFile(source, 'hello')

    const result = await collectQqAttachments({
      segments: [{ type: 'file', data: { file: source, name: 'report.txt' } }],
      sessionId: 'qq:private:123',
      attachmentStore: new AttachmentStore({ root }),
    })

    expect(result.rejections.length).toBe(0)
    expect(result.attachments.length).toBe(1)
    expect(result.attachments[0]!.type).toBe('file')
    expect(result.attachments[0]!.name).toBe('report.txt')
    expect(result.attachments[0]!.path).toContain('report.txt')
  })
})
