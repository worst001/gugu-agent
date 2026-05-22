import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { checkAttachmentLimit } from '../common/attachment/attachment-limits.js'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import type { AttachmentRef } from '../common/ws-bridge.js'
import { inferMimeType, isImageMime } from '../common/mime.js'

export type QqMessageSegment = {
  type: string
  data: Record<string, unknown>
}

export type ParsedQqMessage = {
  text: string
  segments: QqMessageSegment[]
}

export type OneBotFileResolver = (fileId: string) => Promise<unknown>

type DownloadedAttachment = {
  buffer: Buffer
  name: string
  mimeType: string
  kind: 'image' | 'file'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeSegment(value: unknown): QqMessageSegment | null {
  if (typeof value === 'string') {
    return value ? { type: 'text', data: { text: value } } : null
  }
  if (!isRecord(value)) return null
  const type = stringValue(value.type)
  if (!type) return null
  const data = isRecord(value.data) ? value.data : {}
  return { type, data }
}

function stripOfficialMediaTags(raw: string): string {
  return raw
    .replace(/<(?:image|video|audio|application|file)[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripOneBotMediaTags(raw: string): string {
  return raw
    .replace(/\[CQ:(?:image|file|record|video|audio)[^\]]*]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripOneBotControlTags(raw: string): string {
  return raw
    .replace(/\[CQ:at,[^\]]+]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function textFromSegments(segments: QqMessageSegment[]): string {
  return segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => stringValue(segment.data.text) ?? '')
    .join('')
    .trim()
}

export function parseOfficialMessage(rawMessage: unknown, message: unknown): ParsedQqMessage {
  const segments = Array.isArray(message)
    ? message.map(normalizeSegment).filter((segment): segment is QqMessageSegment => Boolean(segment))
    : typeof message === 'string'
      ? [{ type: 'text', data: { text: message } }]
      : []

  const segmentText = textFromSegments(segments)
  if (segmentText) return { text: segmentText, segments }

  if (typeof rawMessage === 'string' && rawMessage.trim()) {
    return { text: stripOfficialMediaTags(rawMessage), segments }
  }
  return { text: '', segments }
}

export function parseOneBotMessage(rawMessage: unknown, message: unknown): ParsedQqMessage {
  const segments = Array.isArray(message)
    ? message.map(normalizeSegment).filter((segment): segment is QqMessageSegment => Boolean(segment))
    : typeof message === 'string'
      ? [{ type: 'text', data: { text: stripOneBotControlTags(message) } }]
      : []

  const segmentText = textFromSegments(segments)
  if (segmentText) return { text: segmentText, segments }

  if (typeof rawMessage === 'string' && rawMessage.trim()) {
    return { text: stripOneBotMediaTags(rawMessage), segments }
  }
  return { text: '', segments }
}

export async function collectQqAttachments(options: {
  segments: QqMessageSegment[]
  sessionId: string
  attachmentStore: AttachmentStore
  resolveOneBotFile?: OneBotFileResolver
}): Promise<{ attachments: AttachmentRef[]; rejections: string[] }> {
  const attachments: AttachmentRef[] = []
  const rejections: string[] = []

  for (const segment of options.segments) {
    if (!isMediaSegment(segment)) continue
    try {
      const downloaded = await downloadSegment(segment, options.resolveOneBotFile)
      const check = checkAttachmentLimit(downloaded.kind, downloaded.buffer.length, downloaded.mimeType)
      if (!check.ok) {
        rejections.push(check.hint)
        continue
      }
      const target = options.attachmentStore.resolvePath('qq', options.sessionId, downloaded.name)
      const localPath = await options.attachmentStore.write(target, downloaded.buffer)
      if (downloaded.kind === 'image') {
        attachments.push({
          type: 'image',
          name: downloaded.name,
          data: downloaded.buffer.toString('base64'),
          mimeType: downloaded.mimeType,
        })
      } else {
        attachments.push({
          type: 'file',
          name: downloaded.name,
          path: localPath,
          mimeType: downloaded.mimeType,
        })
      }
    } catch (err) {
      console.error('[QQ] attachment download failed:', err instanceof Error ? err.message : err)
      rejections.push('📎 附件下载失败，请稍后重试')
    }
  }

  return { attachments, rejections }
}

function isMediaSegment(segment: QqMessageSegment): boolean {
  return ['image', 'file', 'video', 'audio', 'application'].includes(segment.type)
}

async function downloadSegment(
  segment: QqMessageSegment,
  resolveOneBotFile?: OneBotFileResolver,
): Promise<DownloadedAttachment> {
  const data = segment.data
  const name = pickName(segment)
  const declaredMime =
    stringValue(data.mimeType)
    ?? stringValue(data.mime_type)
    ?? stringValue(data.content_type)
    ?? inferMimeType(name)

  const direct = await readDirectSource(data, declaredMime)
  if (direct) {
    return {
      buffer: direct.buffer,
      name,
      mimeType: direct.mimeType,
      kind: classifyKind(segment.type, direct.mimeType, name),
    }
  }

  const fileId = stringValue(data.file_id) ?? stringValue(data.file)
  if (fileId && resolveOneBotFile) {
    const resolved = await resolveOneBotFile(fileId)
    const resolvedRecord = unwrapOneBotData(resolved)
    const fromResolved = await readDirectSource(resolvedRecord, declaredMime)
    if (fromResolved) {
      const resolvedName =
        stringValue(resolvedRecord.name)
        ?? stringValue(resolvedRecord.file_name)
        ?? stringValue(resolvedRecord.filename)
        ?? name
      return {
        buffer: fromResolved.buffer,
        name: resolvedName,
        mimeType: fromResolved.mimeType,
        kind: classifyKind(segment.type, fromResolved.mimeType, resolvedName),
      }
    }
  }

  throw new Error('no downloadable QQ attachment source')
}

async function readDirectSource(
  data: Record<string, unknown>,
  fallbackMime: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const file = data.file
  if (Buffer.isBuffer(file)) {
    return { buffer: Buffer.from(file), mimeType: fallbackMime }
  }

  const url = stringValue(data.url) ?? stringValue(data.download_url)
  if (url) {
    return await readSourceString(url, fallbackMime)
  }

  const base64 = stringValue(data.base64)
  if (base64) {
    return { buffer: Buffer.from(base64, 'base64'), mimeType: fallbackMime }
  }

  const fileString = stringValue(file)
  if (fileString) {
    return await readSourceString(fileString, fallbackMime)
  }

  return null
}

async function readSourceString(source: string, fallbackMime: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (source.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(source)
    if (!m) return null
    return { buffer: Buffer.from(m[2]!, 'base64'), mimeType: m[1]! }
  }
  if (source.startsWith('base64://')) {
    return { buffer: Buffer.from(source.slice('base64://'.length), 'base64'), mimeType: fallbackMime }
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const resp = await fetch(source)
    if (!resp.ok) throw new Error(`fetch ${source} -> ${resp.status}`)
    const mimeType = normalizeMime(resp.headers.get('content-type') ?? fallbackMime)
    return { buffer: Buffer.from(await resp.arrayBuffer()), mimeType }
  }
  const filePath = source.startsWith('file://') ? decodeURIComponent(source.slice('file://'.length)) : source
  if (path.isAbsolute(filePath)) {
    return { buffer: await fs.readFile(filePath), mimeType: inferMimeType(filePath, fallbackMime) }
  }
  return null
}

function normalizeMime(mime: string): string {
  return mime.split(';', 1)[0]!.trim().toLowerCase()
}

function unwrapOneBotData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  if (isRecord(value.data)) return value.data
  return value
}

function pickName(segment: QqMessageSegment): string {
  const data = segment.data
  const explicit =
    stringValue(data.name)
    ?? stringValue(data.file_name)
    ?? stringValue(data.filename)
  if (explicit) return explicit

  const source = stringValue(data.url) ?? stringValue(data.file)
  if (source) {
    try {
      const pathname = source.startsWith('http') ? new URL(source).pathname : source
      const base = path.basename(pathname)
      if (base && base !== '/' && !base.startsWith('base64://')) return decodeURIComponent(base)
    } catch {
      const base = path.basename(source)
      if (base) return base
    }
  }

  const ext = defaultExtForSegment(segment.type)
  return `qq-${segment.type}-${Date.now()}${ext}`
}

function classifyKind(segmentType: string, mimeType: string, name: string): 'image' | 'file' {
  if (segmentType === 'image') return 'image'
  if (isImageMime(mimeType) || isImageMime(inferMimeType(name, ''))) return 'image'
  return 'file'
}

function defaultExtForSegment(segmentType: string): string {
  switch (segmentType) {
    case 'image':
      return '.png'
    case 'audio':
      return '.ogg'
    case 'video':
      return '.mp4'
    default:
      return ''
  }
}
