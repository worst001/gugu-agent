import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { writeZipEntries, type ZipEntry } from './zip.js'

export type PptxCreationInput = {
  outputPath: string
  content: string
  title?: string
  sourcePath?: string
}

export type PptxCreationResult = {
  type: 'presentation'
  operation: 'create_pptx'
  sourcePath?: string
  outputPath: string
  fileType: 'pptx'
  slideCount: number
  originalModified: false
  summary: string
  warnings: string[]
}

type Slide = {
  title: string
  bullets: string[]
}

export function buildPptxOutputPath(sourcePath: string, outputPath?: string): string {
  if (outputPath?.trim()) return path.resolve(outputPath)

  const parsed = path.parse(path.resolve(sourcePath))
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
  return path.join(parsed.dir, `${parsed.name}.gugu-${stamp}.pptx`)
}

export async function createPptxPresentation(
  input: PptxCreationInput,
): Promise<PptxCreationResult> {
  const outputPath = path.resolve(input.outputPath)
  if (path.extname(outputPath).toLowerCase() !== '.pptx') {
    throw new Error('Output file must end with .pptx.')
  }

  await assertOutputCanBeCreated(outputPath)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const slides = parseSlides(input.content, input.title)
  await fs.writeFile(outputPath, writeZipEntries(buildEntries(slides)))

  return {
    type: 'presentation',
    operation: 'create_pptx',
    ...(input.sourcePath ? { sourcePath: path.resolve(input.sourcePath) } : {}),
    outputPath,
    fileType: 'pptx',
    slideCount: slides.length,
    originalModified: false,
    summary: `Created a new PPTX file with ${slides.length} slides. The source file was not modified.`,
    warnings: ['PPTX V1 creates a basic title-and-bullets deck only; templates and rich design are not preserved.'],
  }
}

function parseSlides(content: string, fallbackTitle?: string): Slide[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n').map(line => line.trim())
  const slides: Slide[] = []
  let current: Slide | null = null

  for (const line of lines) {
    if (!line) continue

    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      current = { title: heading[1]!.trim(), bullets: [] }
      slides.push(current)
      continue
    }

    if (!current) {
      current = { title: fallbackTitle || line.replace(/^[-*]\s+/, ''), bullets: [] }
      slides.push(current)
      if (!fallbackTitle && current.title === line) continue
    }

    const bullet = line
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim()
    if (bullet && bullet !== current.title) current.bullets.push(bullet)
  }

  if (slides.length === 0) return [{ title: fallbackTitle || 'Presentation', bullets: [] }]
  return slides.map(slide => ({
    title: slide.title,
    bullets: slide.bullets.slice(0, 8),
  }))
}

function buildEntries(slides: Slide[]): ZipEntry[] {
  return [
    entry('[Content_Types].xml', contentTypesXml(slides.length)),
    entry('_rels/.rels', rootRelsXml()),
    entry('ppt/presentation.xml', presentationXml(slides.length)),
    entry('ppt/_rels/presentation.xml.rels', presentationRelsXml(slides.length)),
    ...slides.flatMap((slide, index) => [
      entry(`ppt/slides/slide${index + 1}.xml`, slideXml(slide)),
      entry(`ppt/slides/_rels/slide${index + 1}.xml.rels`, emptyRelsXml()),
    ]),
  ]
}

function entry(name: string, xml: string): ZipEntry {
  return { name, data: Buffer.from(xml, 'utf8') }
}

function contentTypesXml(slideCount: number): string {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('')
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    slideOverrides,
    '</Types>',
  ].join('')
}

function rootRelsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>',
    '</Relationships>',
  ].join('')
}

function presentationXml(slideCount: number): string {
  const slideIds = Array.from({ length: slideCount }, (_, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`,
  ).join('')
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    `<p:sldIdLst>${slideIds}</p:sldIdLst>`,
    '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>',
    '<p:notesSz cx="6858000" cy="9144000"/>',
    '</p:presentation>',
  ].join('')
}

function presentationRelsXml(slideCount: number): string {
  const slideRels = Array.from({ length: slideCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
  ).join('')
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    slideRels,
    '</Relationships>',
  ].join('')
}

function slideXml(slide: Slide): string {
  const bullets = slide.bullets.length ? slide.bullets : ['']
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '<p:cSld><p:spTree>',
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    textShape(2, 'Title', 700000, 500000, 10800000, 900000, [slide.title], 3600),
    textShape(3, 'Body', 900000, 1700000, 10400000, 4200000, bullets, 2200),
    '</p:spTree></p:cSld>',
    '</p:sld>',
  ].join('')
}

function textShape(id: number, name: string, x: number, y: number, cx: number, cy: number, lines: string[], fontSize: number): string {
  const paragraphs = lines.map(line => `<a:p><a:r><a:rPr lang="zh-CN" sz="${fontSize}"/><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${fontSize}"/></a:p>`).join('')
  return [
    '<p:sp>',
    `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`,
    `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody>`,
    '</p:sp>',
  ].join('')
}

function emptyRelsXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
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
