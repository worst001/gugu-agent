import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createDocxDocument } from './docxProcessor.js'
import { replaceOfficeText } from './officeTextReplace.js'
import { createPptxPresentation } from './pptxProcessor.js'
import { readZipEntries } from './zip.js'

describe('replaceOfficeText', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-office-replace-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('replaces text in a DOCX copy', async () => {
    const sourcePath = path.join(tmpDir, 'source.docx')
    const outputPath = path.join(tmpDir, 'output.docx')
    await createDocxDocument({
      outputPath: sourcePath,
      content: 'Hello old name',
    })

    const result = await replaceOfficeText({
      filePath: sourcePath,
      outputPath,
      findText: 'old name',
      replacementText: 'new name',
    })

    expect(result.replacedCount).toBe(1)
    const documentXml = await getEntryText(outputPath, 'word/document.xml')
    expect(documentXml).toContain('Hello new name')
  })

  test('replaces text in a PPTX copy', async () => {
    const sourcePath = path.join(tmpDir, 'source.pptx')
    const outputPath = path.join(tmpDir, 'output.pptx')
    await createPptxPresentation({
      outputPath: sourcePath,
      content: '# old title\n- old point',
    })

    const result = await replaceOfficeText({
      filePath: sourcePath,
      outputPath,
      findText: 'old',
      replacementText: 'new',
    })

    expect(result.replacedCount).toBe(2)
    const slideXml = await getEntryText(outputPath, 'ppt/slides/slide1.xml')
    expect(slideXml).toContain('new title')
    expect(slideXml).toContain('new point')
  })
})

async function getEntryText(archivePath: string, entryName: string): Promise<string> {
  const entries = readZipEntries(await fs.readFile(archivePath))
  return entries.find(entry => entry.name === entryName)!.data.toString('utf8')
}
