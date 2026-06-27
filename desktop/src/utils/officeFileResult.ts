export type OfficeFileResultInfo = {
  summary: string
  outputPath: string
  sourcePath?: string
  originalModified?: boolean
  warnings: string[]
}

export function parseOfficeFileResult(content: unknown): OfficeFileResultInfo | null {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>
    const outputPath = stringValue(record.outputPath) || stringValue(record.output_path)
    if (!outputPath) return null

    return {
      summary: stringValue(record.summary) || 'Office file generated',
      outputPath,
      ...(stringValue(record.sourcePath) || stringValue(record.source_path)
        ? { sourcePath: stringValue(record.sourcePath) || stringValue(record.source_path) }
        : {}),
      ...(typeof record.originalModified === 'boolean'
        ? { originalModified: record.originalModified }
        : typeof record.original_modified === 'boolean'
          ? { originalModified: record.original_modified }
          : {}),
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
        : [],
    }
  }

  const text = extractTextContent(content)
  if (!text.trim()) return null

  const outputPath = matchLineValue(text, /^Output path:\s*(.+)$/im)
  if (!outputPath) return null

  const sourcePath = matchLineValue(text, /^Source path:\s*(.+)$/im)
  const originalModifiedText = matchLineValue(text, /^Original modified:\s*(.+)$/im)
  const warnings = [...text.matchAll(/^Warning:\s*(.+)$/gim)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean)
  const summary = firstSummaryLine(text) || 'Office file generated'

  return {
    summary,
    outputPath,
    ...(sourcePath ? { sourcePath } : {}),
    ...(originalModifiedText
      ? { originalModified: /^(yes|true)$/i.test(originalModifiedText) }
      : {}),
    warnings,
  }
}

export function formatOfficeFileResultPreview(info: OfficeFileResultInfo): string {
  return [
    info.summary,
    '',
    `Output file: ${info.outputPath}`,
    ...(info.sourcePath ? [`Source file: ${info.sourcePath}`] : []),
    ...(typeof info.originalModified === 'boolean'
      ? [`Original modified: ${info.originalModified ? 'yes' : 'no'}`]
      : []),
    ...info.warnings.map(warning => `Warning: ${warning}`),
  ].join('\n')
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(chunk => {
        if (typeof chunk === 'string') return chunk
        if (chunk && typeof chunk === 'object' && 'text' in chunk) {
          return typeof chunk.text === 'string' ? chunk.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function matchLineValue(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() ?? ''
}

function firstSummaryLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line =>
      line &&
      !/^Output path:/i.test(line) &&
      !/^Source path:/i.test(line) &&
      !/^Original modified:/i.test(line) &&
      !/^Warning:/i.test(line)
    ) ?? ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
