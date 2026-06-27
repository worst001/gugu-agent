import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { writeZipEntries } from './zip.js'

export type DocxCreationInput = {
  outputPath: string
  content: string
  title?: string
  sourcePath?: string
}

export type DocxCreationResult = {
  type: 'document'
  operation: 'create_docx'
  sourcePath?: string
  outputPath: string
  fileType: 'docx'
  paragraphCount: number
  originalModified: false
  summary: string
  warnings: string[]
}

export function buildDocxOutputPath(sourcePath: string, outputPath?: string): string {
  if (outputPath?.trim()) return path.resolve(outputPath)

  const parsed = path.parse(path.resolve(sourcePath))
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
  return path.join(parsed.dir, `${parsed.name}.gugu-${stamp}.docx`)
}

export async function createDocxDocument(
  input: DocxCreationInput,
): Promise<DocxCreationResult> {
  const outputPath = path.resolve(input.outputPath)
  if (path.extname(outputPath).toLowerCase() !== '.docx') {
    throw new Error('Output file must end with .docx.')
  }

  await assertOutputCanBeCreated(outputPath)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const paragraphs = parseParagraphs(input.content)
  const documentXml = buildDocumentXml(paragraphs)

  await fs.writeFile(outputPath, writeZipEntries([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(contentTypesXml(), 'utf8'),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(rootRelsXml(), 'utf8'),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(documentXml, 'utf8'),
    },
  ]))

  return {
    type: 'document',
    operation: 'create_docx',
    ...(input.sourcePath ? { sourcePath: path.resolve(input.sourcePath) } : {}),
    outputPath,
    fileType: 'docx',
    paragraphCount: paragraphs.length,
    originalModified: false,
    summary: `Created a new DOCX file with ${paragraphs.length} paragraphs. The source file was not modified.`,
    warnings: ['DOCX V1 creates a basic text document only; rich templates and complex layout are not preserved.'],
  }
}

function parseParagraphs(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const paragraphs = lines
    .map(line => line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '- ').trim())
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs : ['']
}

function buildDocumentXml(paragraphs: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    ...paragraphs.map(paragraph => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    '</w:body>',
    '</w:document>',
  ].join('')
}

function contentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join('')
}

function rootRelsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join('')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function assertOutputCanBeCreated(outputPath: string) {
  try {
    await fs.stat(outputPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  throw new Error(`Output file already exists: ${outputPath}. Choose a new output path to avoid overwriting files.`)
}
