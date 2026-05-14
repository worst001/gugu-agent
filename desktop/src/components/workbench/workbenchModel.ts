import type { UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

export type ToolActivityStatus = 'running' | 'done' | 'error'

export type ToolActivity = {
  id: string
  toolUseId: string
  toolName: string
  timestamp: number
  status: ToolActivityStatus
  summary: string
  filePath?: string
  input: unknown
  result?: ToolResult
  parentToolUseId?: string
}

export type FileChangeKind = 'created' | 'edited' | 'multi_edit' | 'read'

export type WorkbenchFileChange = {
  id: string
  filePath: string
  toolUseId: string
  toolName: string
  kind: FileChangeKind
  summary: string
  oldText?: string
  newText?: string
  timestamp: number
}

export type FilePreview = {
  id: string
  title: string
  filePath?: string
  toolUseId: string
  language: string
  content: string
  timestamp: number
}

export type AttachmentPreviewKind = 'image' | 'markdown' | 'pdf' | 'text' | 'file'

export type WorkbenchAttachmentPreview = {
  id: string
  messageId: string
  name: string
  type: 'file' | 'image'
  mimeType?: string
  data?: string
  kind: AttachmentPreviewKind
  parserMethod?: 'vision' | 'ocr' | 'file-parser'
  parsedMarkdown?: string
  promptText?: string
  timestamp: number
}

export type WorkbenchModel = {
  activities: ToolActivity[]
  fileChanges: WorkbenchFileChange[]
  previews: FilePreview[]
  attachmentPreviews: WorkbenchAttachmentPreview[]
  resultMap: Map<string, ToolResult>
}

export function buildWorkbenchModel(messages: UIMessage[]): WorkbenchModel {
  const resultMap = new Map<string, ToolResult>()
  for (const message of messages) {
    if (message.type === 'tool_result') {
      resultMap.set(message.toolUseId, message)
    }
  }

  const activities: ToolActivity[] = []
  const fileChanges: WorkbenchFileChange[] = []
  const previews: FilePreview[] = []
  const attachmentPreviews: WorkbenchAttachmentPreview[] = []

  for (const message of messages) {
    if (message.type === 'user_text') {
      attachmentPreviews.push(...getAttachmentPreviews(message))
      continue
    }

    if (message.type !== 'tool_use') continue

    const result = resultMap.get(message.toolUseId)
    const input = asRecord(message.input)
    const filePath = getToolFilePath(input)

    activities.push({
      id: message.id,
      toolUseId: message.toolUseId,
      toolName: message.toolName,
      timestamp: message.timestamp,
      status: result ? result.isError ? 'error' : 'done' : 'running',
      summary: getToolSummary(message.toolName, input, result),
      ...(filePath ? { filePath } : {}),
      input: message.input,
      result,
      parentToolUseId: message.parentToolUseId,
    })

    const change = getFileChange(message, input)
    if (change) fileChanges.push(change)

    const preview = getFilePreview(message, input, result)
    if (preview) previews.push(preview)
  }

  return {
    activities,
    fileChanges,
    previews,
    attachmentPreviews,
    resultMap,
  }
}

export function findSelectedActivity(
  model: WorkbenchModel,
  selectedToolUseId: string | null,
): ToolActivity | null {
  if (selectedToolUseId) {
    return model.activities.find((activity) => activity.toolUseId === selectedToolUseId) ?? null
  }
  return model.activities[0] ?? null
}

export function findSelectedFileChange(
  model: WorkbenchModel,
  selectedFilePath: string | null,
  selectedToolUseId: string | null,
): WorkbenchFileChange | null {
  if (selectedFilePath) {
    const byPath = [...model.fileChanges]
      .reverse()
      .find((change) => change.filePath === selectedFilePath)
    if (byPath) return byPath
  }

  if (selectedToolUseId) {
    const byTool = model.fileChanges.find((change) => change.toolUseId === selectedToolUseId)
    if (byTool) return byTool
  }

  return model.fileChanges[0] ?? null
}

export function findSelectedPreview(
  model: WorkbenchModel,
  selectedToolUseId: string | null,
  selectedFilePath: string | null,
): FilePreview | null {
  if (selectedToolUseId) {
    const byTool = model.previews.find((preview) => preview.toolUseId === selectedToolUseId)
    if (byTool) return byTool
  }

  if (selectedFilePath) {
    const byPath = [...model.previews]
      .reverse()
      .find((preview) => preview.filePath === selectedFilePath)
    if (byPath) return byPath
  }

  return model.previews[0] ?? null
}

export function findSelectedAttachmentPreview(
  model: WorkbenchModel,
  selectedAttachmentId: string | null,
): WorkbenchAttachmentPreview | null {
  if (selectedAttachmentId) {
    return model.attachmentPreviews.find((preview) => preview.id === selectedAttachmentId) ?? null
  }
  return model.attachmentPreviews[0] ?? null
}

export function getToolFilePath(input: Record<string, unknown>): string {
  return (
    stringValue(input.file_path) ||
    stringValue(input.path) ||
    stringValue(input.notebook_path)
  )
}

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk
        if (chunk && typeof chunk === 'object' && 'text' in chunk) {
          return typeof chunk.text === 'string' ? chunk.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return ''
}

function getAttachmentPreviews(
  message: Extract<UIMessage, { type: 'user_text' }>,
): WorkbenchAttachmentPreview[] {
  if (!message.attachments?.length) return []

  return message.attachments.map((attachment, index) => {
    const parsed = findParsedAttachment(message, attachment.name, index)
    return {
      id: `${message.id}:attachment-${index}`,
      messageId: message.id,
      name: attachment.name,
      type: attachment.type,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.data ? { data: attachment.data } : {}),
      kind: inferAttachmentKind(attachment.name, attachment.mimeType, attachment.type),
      ...(parsed?.method ? { parserMethod: parsed.method } : {}),
      ...(parsed?.markdown ? { parsedMarkdown: parsed.markdown } : {}),
      ...(message.attachmentParser?.promptText ? { promptText: message.attachmentParser.promptText } : {}),
      timestamp: message.timestamp,
    }
  })
}

function findParsedAttachment(
  message: Extract<UIMessage, { type: 'user_text' }>,
  name: string,
  index: number,
) {
  const results = message.attachmentParser?.results ?? []
  return results[index] ?? results.find((result) => result.name === name) ?? null
}

function inferAttachmentKind(
  name: string,
  mimeType: string | undefined,
  type: 'file' | 'image',
): AttachmentPreviewKind {
  const normalizedMime = mimeType?.toLowerCase() ?? ''
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (type === 'image' || normalizedMime.startsWith('image/')) return 'image'
  if (normalizedMime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (normalizedMime.includes('markdown') || ext === 'md' || ext === 'markdown') return 'markdown'
  if (normalizedMime.startsWith('text/') || isCodeExtension(ext)) return 'text'
  return 'file'
}

function isCodeExtension(ext: string): boolean {
  return new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'json',
    'css',
    'html',
    'md',
    'py',
    'rs',
    'go',
    'java',
    'c',
    'cpp',
    'cs',
    'sh',
    'ps1',
    'yaml',
    'yml',
    'toml',
    'sql',
  ]).has(ext)
}

function getFileChange(
  toolCall: ToolCall,
  input: Record<string, unknown>,
): WorkbenchFileChange | null {
  const filePath = getToolFilePath(input)
  if (!filePath) return null

  if (toolCall.toolName === 'Write' && typeof input.content === 'string') {
    return {
      id: `${toolCall.toolUseId}:write`,
      filePath,
      toolUseId: toolCall.toolUseId,
      toolName: toolCall.toolName,
      kind: 'created',
      summary: `${lineCount(input.content)} lines`,
      oldText: '',
      newText: input.content,
      timestamp: toolCall.timestamp,
    }
  }

  if (
    toolCall.toolName === 'Edit' &&
    typeof input.old_string === 'string' &&
    typeof input.new_string === 'string'
  ) {
    return {
      id: `${toolCall.toolUseId}:edit`,
      filePath,
      toolUseId: toolCall.toolUseId,
      toolName: toolCall.toolName,
      kind: 'edited',
      summary: '1 replacement',
      oldText: input.old_string,
      newText: input.new_string,
      timestamp: toolCall.timestamp,
    }
  }

  if (toolCall.toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    const edits = input.edits.filter(isEditPair)
    if (edits.length === 0) return null
    return {
      id: `${toolCall.toolUseId}:multi-edit`,
      filePath,
      toolUseId: toolCall.toolUseId,
      toolName: toolCall.toolName,
      kind: 'multi_edit',
      summary: `${edits.length} replacements`,
      oldText: edits.map((edit) => edit.old_string).join('\n\n...\n\n'),
      newText: edits.map((edit) => edit.new_string).join('\n\n...\n\n'),
      timestamp: toolCall.timestamp,
    }
  }

  return null
}

function getFilePreview(
  toolCall: ToolCall,
  input: Record<string, unknown>,
  result?: ToolResult,
): FilePreview | null {
  const filePath = getToolFilePath(input)

  if (toolCall.toolName === 'Write' && typeof input.content === 'string') {
    return {
      id: `${toolCall.toolUseId}:write-preview`,
      title: filePath || 'Created file',
      filePath,
      toolUseId: toolCall.toolUseId,
      language: inferLanguage(filePath),
      content: input.content,
      timestamp: toolCall.timestamp,
    }
  }

  if (toolCall.toolName === 'Read' && result && !result.isError) {
    const content = extractTextContent(result.content)
    if (!content.trim()) return null
    return {
      id: `${toolCall.toolUseId}:read-preview`,
      title: filePath || 'Read result',
      filePath,
      toolUseId: toolCall.toolUseId,
      language: inferLanguage(filePath),
      content,
      timestamp: toolCall.timestamp,
    }
  }

  if (toolCall.toolName === 'Bash' && result) {
    const content = extractTextContent(result.content)
    if (!content.trim()) return null
    return {
      id: `${toolCall.toolUseId}:bash-output`,
      title: stringValue(input.description) || stringValue(input.command) || 'Bash output',
      toolUseId: toolCall.toolUseId,
      language: 'plaintext',
      content,
      timestamp: toolCall.timestamp,
    }
  }

  return null
}

function getToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  result?: ToolResult,
): string {
  switch (toolName) {
    case 'Bash':
      return stringValue(input.description) || stringValue(input.command) || 'Run command'
    case 'Read':
      return `Read ${leafName(getToolFilePath(input)) || 'file'}`
    case 'Write':
      return `Create ${leafName(getToolFilePath(input)) || 'file'}`
    case 'Edit':
      return `Edit ${leafName(getToolFilePath(input)) || 'file'}`
    case 'MultiEdit':
      return `MultiEdit ${leafName(getToolFilePath(input)) || 'file'}`
    case 'Task':
    case 'Agent':
      return stringValue(input.description) || stringValue(input.prompt) || 'Agent task'
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} tasks` : 'Update tasks'
    default: {
      const content = result ? extractTextContent(result.content).trim() : ''
      return content ? compact(content, 80) : toolName
    }
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isEditPair(value: unknown): value is { old_string: string; new_string: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).old_string === 'string' &&
    typeof (value as Record<string, unknown>).new_string === 'string',
  )
}

function leafName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split('\n').length
}

function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}...`
}

function inferLanguage(filePath?: string): string {
  const ext = filePath?.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'markup',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'bash',
    ps1: 'powershell',
  }
  return langMap[ext ?? ''] || 'plaintext'
}
