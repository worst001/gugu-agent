import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createDocxDocument } from './docxProcessor.js'
import { readZipEntries } from './zip.js'

describe('createDocxDocument', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-docx-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('creates a minimal DOCX from markdown text', async () => {
    const outputPath = path.join(tmpDir, 'summary.docx')

    const result = await createDocxDocument({
      outputPath,
      content: '# Summary\n- first <item>\nsecond & third',
    })

    expect(result.fileType).toBe('docx')
    expect(result.paragraphCount).toBe(3)

    const entries = readZipEntries(await fs.readFile(outputPath))
    expect(entries.some(entry => entry.name === '[Content_Types].xml')).toBe(true)

    const documentXml = entries
      .find(entry => entry.name === 'word/document.xml')!
      .data.toString('utf8')

    expect(documentXml).toContain('<w:t xml:space="preserve">Summary</w:t>')
    expect(documentXml).toContain('- first &lt;item&gt;')
    expect(documentXml).toContain('second &amp; third')
  })
})
