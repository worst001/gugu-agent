import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createPptxPresentation } from './pptxProcessor.js'
import { readZipEntries } from './zip.js'

describe('createPptxPresentation', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-pptx-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('creates a minimal PPTX from markdown headings', async () => {
    const outputPath = path.join(tmpDir, 'deck.pptx')

    const result = await createPptxPresentation({
      outputPath,
      content: '# Intro\n- first <point>\n- second & third\n# Next\nplain line',
    })

    expect(result.fileType).toBe('pptx')
    expect(result.slideCount).toBe(2)

    const entries = readZipEntries(await fs.readFile(outputPath))
    expect(entries.some(entry => entry.name === 'ppt/presentation.xml')).toBe(true)
    expect(entries.some(entry => entry.name === 'ppt/slides/slide1.xml')).toBe(true)
    expect(entries.some(entry => entry.name === 'ppt/slides/slide2.xml')).toBe(true)

    const slideXml = entries
      .find(entry => entry.name === 'ppt/slides/slide1.xml')!
      .data.toString('utf8')

    expect(slideXml).toContain('Intro')
    expect(slideXml).toContain('first &lt;point&gt;')
    expect(slideXml).toContain('second &amp; third')
  })
})
