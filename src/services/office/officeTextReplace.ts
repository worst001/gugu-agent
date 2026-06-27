import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { readZipEntries, writeZipEntries } from './zip.js'

export type OfficeTextReplacementInput = {
  filePath: string
  outputPath?: string
  findText: string
  replacementText: string
}

export type OfficeTextReplacementResult = {
  type: 'document' | 'presentation'
  operation: 'replace_text'
  sourcePath: string
  outputPath: string
  fileType: 'docx' | 'pptx'
  replacedCount: number
  originalModified: false
  summary: string
  warnings: string[]
}

export async function replaceOfficeText(
  input: OfficeTextReplacementInput,
): Promise<OfficeTextReplacementResult> {
  const sourcePath = path.resolve(input.filePath)
  const outputPath = buildOfficeReplacementOutputPath(sourcePath, input.outputPath)
  const fileType = getOfficeZipFileType(sourcePath)

  if (samePath(sourcePath, outputPath)) {
    throw new Error('Output path cannot be the same as the source file.')
  }
  if (path.extname(outputPath).toLowerCase() !== `.${fileType}`) {
    throw new Error(`Output path must end with .${fileType}.`)
  }

  await assertOutputCanBeCreated(outputPath)

  const entries = readZipEntries(await fs.readFile(sourcePath))
  const targetEntry = fileType === 'docx'
    ? (name: string) => name === 'word/document.xml'
    : (name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name)

  const escapedFind = escapeXml(input.findText)
  const escapedReplacement = escapeXml(input.replacementText)
  let replacedCount = 0

  for (const entry of entries) {
    if (!targetEntry(entry.name)) continue
    const xml = entry.data.toString('utf8')
    const next = xml.split(escapedFind).join(escapedReplacement)
    replacedCount += countOccurrences(xml, escapedFind)
    entry.data = Buffer.from(next, 'utf8')
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, writeZipEntries(entries))

  return {
    type: fileType === 'docx' ? 'document' : 'presentation',
    operation: 'replace_text',
    sourcePath,
    outputPath,
    fileType,
    replacedCount,
    originalModified: false,
    summary: `Created a new ${fileType.toUpperCase()} file with ${replacedCount} text replacements. The source file was not modified.`,
    warnings: replacedCount === 0
      ? ['No matching text was found. Office text split across runs may need a richer parser later.']
      : ['Text replacement is XML-text based; complex Office runs may not all be replaced in V1.'],
  }
}

export function buildOfficeReplacementOutputPath(sourcePath: string, outputPath?: string): string {
  if (outputPath?.trim()) return path.resolve(outputPath)

  const parsed = path.parse(path.resolve(sourcePath))
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
  return path.join(parsed.dir, `${parsed.name}.gugu-${stamp}${parsed.ext}`)
}

export function getOfficeZipFileType(sourcePath: string): 'docx' | 'pptx' {
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension === '.docx') return 'docx'
  if (extension === '.pptx') return 'pptx'
  throw new Error('Text replacement supports DOCX and PPTX files only.')
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0
  return value.split(needle).length - 1
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

function samePath(left: string, right: string): boolean {
  if (process.platform === 'win32') {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  }
  return path.resolve(left) === path.resolve(right)
}
