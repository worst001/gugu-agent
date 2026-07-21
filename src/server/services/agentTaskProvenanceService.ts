import { createHash, randomUUID } from 'crypto'
import { basename, isAbsolute, resolve } from 'path'
import { AgentTaskProvenanceStore } from '../../agentTask/provenance/provenanceStore.js'
import type {
  AgentTask,
  ProvenancePack,
  SourceLocator,
  SourceRef,
} from '../../agentTask/types.js'
import { deriveWorkspaceId } from '../../agentTask/workspaceId.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '../../tools/WebFetchTool/prompt.js'
import { normalizePathForConfigKey } from '../../utils/path.js'
import { SessionService, type MessageEntry } from './sessionService.js'

const MAX_SOURCE_TITLE_CHARS = 120
const MAX_SOURCE_EXCERPT_CHARS = 1_000

type ContentBlock = Record<string, unknown>
type ToolUseObservation = {
  message: MessageEntry
  name: string
  input: Record<string, unknown>
}
type ToolResultObservation = {
  message: MessageEntry
  block: ContentBlock
}
type TranscriptIndex = {
  messages: Map<string, MessageEntry | null>
  toolUses: Map<string, ToolUseObservation | null>
  toolResults: Map<string, ToolResultObservation | null>
}

export class AgentTaskProvenanceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTaskProvenanceValidationError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function contentBlocks(content: unknown): ContentBlock[] {
  return Array.isArray(content)
    ? content.flatMap((block) => asRecord(block) ?? [])
    : []
}

function setUnique<T>(map: Map<string, T | null>, key: string, value: T): void {
  map.set(key, map.has(key) ? null : value)
}

function indexTranscript(messages: MessageEntry[]): TranscriptIndex {
  const index: TranscriptIndex = {
    messages: new Map(),
    toolUses: new Map(),
    toolResults: new Map(),
  }

  for (const message of messages) {
    setUnique(index.messages, message.id, message)
    for (const block of contentBlocks(message.content)) {
      if (
        message.type === 'tool_use' &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        setUnique(index.toolUses, block.id, {
          message,
          name: block.name,
          input: asRecord(block.input) ?? {},
        })
      }
      if (
        message.type === 'tool_result' &&
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        setUnique(index.toolResults, block.tool_use_id, { message, block })
      }
    }
  }

  return index
}

function requireUnique<T>(
  map: Map<string, T | null>,
  id: string,
  label: string,
): T {
  if (!map.has(id)) {
    throw new AgentTaskProvenanceValidationError(`${label} not found: ${id}`)
  }
  const value = map.get(id)
  if (!value) {
    throw new AgentTaskProvenanceValidationError(`${label} is ambiguous: ${id}`)
  }
  return value
}

function requireSuccessfulTool(
  index: TranscriptIndex,
  toolUseId: string,
): { use: ToolUseObservation; result: ToolResultObservation } {
  const use = requireUnique(index.toolUses, toolUseId, 'Tool use')
  const result = requireUnique(index.toolResults, toolUseId, 'Tool result')
  if (result.block.is_error === true) {
    throw new AgentTaskProvenanceValidationError(
      `Tool result is an error: ${toolUseId}`,
    )
  }
  return { use, result }
}

function extractText(value: unknown): string {
  const parts: string[] = []
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      parts.push(item)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    const record = asRecord(item)
    if (!record) return
    if (typeof record.text === 'string') parts.push(record.text)
    else if ('content' in record) visit(record.content)
  }
  visit(value)
  return parts.join('\n').trim()
}

function textMetadata(value: unknown): Pick<SourceRef, 'contentHash' | 'excerpt'> {
  const text = extractText(value)
  if (!text) return {}
  return {
    contentHash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    excerpt: text.slice(0, MAX_SOURCE_EXCERPT_CHARS),
  }
}



function comparablePath(value: string): string {
  const normalized = normalizePathForConfigKey(resolve(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function normalizedUrl(value: string): string {
  try {
    return new URL(value).href
  } catch {
    throw new AgentTaskProvenanceValidationError(`Invalid source URL: ${value}`)
  }
}

function makeSource(
  sessionId: string,
  title: string,
  locator: SourceLocator,
  observedAt: string,
  content?: unknown,
): SourceRef {
  return {
    id: randomUUID(),
    sessionId,
    title: title.slice(0, MAX_SOURCE_TITLE_CHARS),
    locator,
    observedAt,
    ...(content === undefined ? {} : textMetadata(content)),
  }
}

function resolveSource(
  sessionId: string,
  index: TranscriptIndex,
  locator: SourceLocator,
): SourceRef {
  switch (locator.kind) {
    case 'message': {
      const message = requireUnique(index.messages, locator.messageId, 'Message')
      if (message.type !== 'user' && message.type !== 'assistant') {
        throw new AgentTaskProvenanceValidationError(
          `Message is not a citable conversation message: ${locator.messageId}`,
        )
      }
      return makeSource(
        sessionId,
        `${message.type} message`,
        locator,
        message.timestamp,
      )
    }

    case 'attachment': {
      const message = requireUnique(index.messages, locator.messageId, 'Message')
      if (message.type !== 'user') {
        throw new AgentTaskProvenanceValidationError(
          `Attachment message is not a user message: ${locator.messageId}`,
        )
      }
      if (!Number.isInteger(locator.attachmentIndex) || locator.attachmentIndex < 0) {
        throw new AgentTaskProvenanceValidationError('attachmentIndex must be non-negative')
      }
      if (locator.path) {
        throw new AgentTaskProvenanceValidationError(
          'Attachment path is not verifiable from the Session transcript',
        )
      }
      const attachments = contentBlocks(message.content).filter(
        (block) => block.type === 'image' || block.type === 'document',
      )
      const attachment = attachments[locator.attachmentIndex]
      if (!attachment) {
        throw new AgentTaskProvenanceValidationError(
          `Attachment not found: ${locator.messageId}[${locator.attachmentIndex}]`,
        )
      }
      const source = asRecord(attachment.source)
      const mediaType = typeof source?.media_type === 'string'
        ? source.media_type
        : String(attachment.type)
      const data = typeof source?.data === 'string' ? source.data : undefined
      const ref = makeSource(
        sessionId,
        `Attachment ${locator.attachmentIndex + 1} (${mediaType})`,
        { kind: 'attachment', messageId: locator.messageId, attachmentIndex: locator.attachmentIndex },
        message.timestamp,
      )
      return data
        ? {
            ...ref,
            contentHash: `sha256:${createHash('sha256').update(data).digest('hex')}`,
          }
        : ref
    }

    case 'tool_result': {
      const { use, result } = requireSuccessfulTool(index, locator.toolUseId)
      if (locator.messageId && locator.messageId !== result.message.id) {
        throw new AgentTaskProvenanceValidationError(
          `Tool result message does not match ${locator.toolUseId}`,
        )
      }
      return makeSource(
        sessionId,
        `${use.name} result`,
        { kind: 'tool_result', toolUseId: locator.toolUseId, messageId: result.message.id },
        result.message.timestamp,
        result.block.content,
      )
    }

    case 'file': {
      const { use, result } = requireSuccessfulTool(index, locator.toolUseId)
      const observedPath = typeof use.input.file_path === 'string'
        ? use.input.file_path
        : ''
      if (
        use.name !== FILE_READ_TOOL_NAME ||
        !observedPath ||
        !isAbsolute(observedPath) ||
        comparablePath(locator.path) !== comparablePath(observedPath)
      ) {
        throw new AgentTaskProvenanceValidationError(
          `File source does not match Read tool use: ${locator.toolUseId}`,
        )
      }
      return makeSource(
        sessionId,
        basename(observedPath),
        { kind: 'file', path: observedPath, toolUseId: locator.toolUseId },
        result.message.timestamp,
        result.block.content,
      )
    }

    case 'url': {
      const { use, result } = requireSuccessfulTool(index, locator.toolUseId)
      const observedUrl = typeof use.input.url === 'string' ? use.input.url : ''
      if (
        use.name !== WEB_FETCH_TOOL_NAME ||
        !observedUrl ||
        normalizedUrl(locator.url) !== normalizedUrl(observedUrl)
      ) {
        throw new AgentTaskProvenanceValidationError(
          `URL source does not match WebFetch tool use: ${locator.toolUseId}`,
        )
      }
      const url = normalizedUrl(observedUrl)
      return makeSource(
        sessionId,
        url,
        { kind: 'url', url, toolUseId: locator.toolUseId },
        result.message.timestamp,
        result.block.content,
      )
    }
  }
}

export class AgentTaskProvenanceService {
  constructor(private readonly sessions = new SessionService()) {}

  async buildPack(
    task: AgentTask,
    locators: SourceLocator[],
  ): Promise<ProvenancePack> {
    const sessionId = task.sessionId?.trim()
    if (!sessionId) {
      throw new AgentTaskProvenanceValidationError('AgentTask sessionId is required')
    }
    if (!task.workspacePath?.trim()) {
      throw new AgentTaskProvenanceValidationError('AgentTask workspacePath is required')
    }
    if (locators.length === 0) {
      throw new AgentTaskProvenanceValidationError('At least one source is required')
    }

    const index = indexTranscript(await this.sessions.getSessionMessages(sessionId))
    const seen = new Set<string>()
    const sources = locators.flatMap((locator) => {
      const source = resolveSource(sessionId, index, locator)
      const key = JSON.stringify(source.locator)
      if (seen.has(key)) return []
      seen.add(key)
      return [source]
    })

    return {
      schemaVersion: 1,
      id: randomUUID(),
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      workspaceId: await deriveWorkspaceId(task.workspacePath),
      sessionId,
      createdAt: new Date().toISOString(),
      sources,
    }
  }
}

export async function recordAgentTaskProvenance(
  task: AgentTask,
  locators: SourceLocator[],
  store: AgentTaskProvenanceStore,
  resolver = new AgentTaskProvenanceService(),
): Promise<ProvenancePack> {
  if (
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled'
  ) {
    throw new AgentTaskProvenanceValidationError(
      'Cannot record provenance for ' + task.status + ' AgentTask',
    )
  }
  const pack = await resolver.buildPack(task, locators)
  await store.persist(pack)
  return pack
}