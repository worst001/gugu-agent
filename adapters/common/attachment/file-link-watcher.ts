/**
 * Stateful extractor for local file links in assistant text.
 *
 * We intentionally only accept absolute local paths and file:// URLs. Plain
 * web links usually point to pages, not downloadable files, and should remain
 * visible as text instead of being fetched and uploaded unexpectedly.
 */

import * as path from 'node:path'
import type { PendingFileUpload } from './attachment-types.js'
import { inferMimeType } from '../mime.js'

const LINK_RE = /(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)/g

function fingerprint(raw: string): string {
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16)
}

function classify(target: string): PendingFileUpload['source'] | null {
  if (target.startsWith('file://')) {
    const filePath = decodeURIComponent(target.slice('file://'.length))
    return { kind: 'path', path: filePath, mime: inferMimeType(filePath) }
  }
  if (target.startsWith('/')) {
    const filePath = decodeURIComponent(target)
    return { kind: 'path', path: filePath, mime: inferMimeType(filePath) }
  }
  return null
}

export class FileLinkWatcher {
  private buffer = ''
  private seen = new Set<string>()
  private accumulated: PendingFileUpload[] = []

  feed(chunk: string): PendingFileUpload[] {
    this.buffer += chunk
    const out: PendingFileUpload[] = []

    LINK_RE.lastIndex = 0
    let lastConsumedEnd = 0
    let m: RegExpExecArray | null
    while ((m = LINK_RE.exec(this.buffer)) !== null) {
      const [, , label, target] = m
      const source = classify(target!)
      if (source) {
        const id = fingerprint(`${source.kind}:${source.path}`)
        if (!this.seen.has(id)) {
          this.seen.add(id)
          const pending: PendingFileUpload = {
            id,
            source,
            label: label?.trim() || path.basename(source.path),
          }
          out.push(pending)
          this.accumulated.push(pending)
        }
      }
      lastConsumedEnd = m.index + m[0].length
    }

    if (lastConsumedEnd > 0) {
      this.buffer = this.buffer.slice(lastConsumedEnd)
    }
    if (this.buffer.length > 4096) {
      this.buffer = this.buffer.slice(-2048)
    }

    return out
  }

  drain(): PendingFileUpload[] {
    return [...this.accumulated]
  }

  reset(): void {
    this.buffer = ''
    this.seen.clear()
    this.accumulated = []
  }
}
