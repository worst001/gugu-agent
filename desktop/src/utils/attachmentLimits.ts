export const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_LOCAL_ARCHIVE_FILE_BYTES = 512 * 1024 * 1024
export const MAX_LOCAL_ARCHIVE_TOTAL_BYTES = 512 * 1024 * 1024

const ARCHIVE_EXTENSIONS = new Set([
  '7z',
  'bz2',
  'gz',
  'rar',
  'tar',
  'tgz',
  'xz',
  'zip',
])

export type AttachmentSizeLike = {
  size?: number
  data?: string
}

export type AttachmentLimitIssue = {
  key:
    | 'chat.attachmentRejectedTooLarge'
    | 'chat.attachmentRejectedTotalTooLarge'
  params: Record<string, string | number>
}

export type AttachmentFileLike = {
  name: string
  size: number
  type?: string
}

export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    const value = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10
    return `${value} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function isArchiveFileName(name: string): boolean {
  const lower = name.toLowerCase()
  const parts = lower.split('.').filter(Boolean)
  const ext = parts[parts.length - 1] ?? ''
  if (ARCHIVE_EXTENSIONS.has(ext)) return true
  return lower.endsWith('.tar.gz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz')
}

export function estimateDataUrlBytes(data?: string): number {
  if (!data) return 0
  const encoded = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
  if (!encoded) return 0
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding)
}

export function getAttachmentBytes(attachments: AttachmentSizeLike[]): number {
  return attachments.reduce((total, attachment) => {
    if (typeof attachment.size === 'number' && Number.isFinite(attachment.size)) {
      return total + Math.max(0, attachment.size)
    }
    return total + estimateDataUrlBytes(attachment.data)
  }, 0)
}

export function validateAttachmentFile(
  file: AttachmentFileLike,
  currentAttachments: AttachmentSizeLike[],
  acceptedBytes = 0,
  options: { allowLargeLocalArchive?: boolean } = {},
): AttachmentLimitIssue | null {
  const isArchive = isArchiveFileName(file.name)
  const fileLimit = options.allowLargeLocalArchive && isArchive
    ? MAX_LOCAL_ARCHIVE_FILE_BYTES
    : MAX_ATTACHMENT_FILE_BYTES
  const totalLimit = options.allowLargeLocalArchive && isArchive
    ? MAX_LOCAL_ARCHIVE_TOTAL_BYTES
    : MAX_ATTACHMENT_TOTAL_BYTES

  if (file.size > fileLimit) {
    return {
      key: 'chat.attachmentRejectedTooLarge',
      params: {
        name: file.name,
        size: formatAttachmentBytes(file.size),
        limit: formatAttachmentBytes(fileLimit),
      },
    }
  }

  const totalBytes = getAttachmentBytes(currentAttachments) + acceptedBytes + file.size
  if (totalBytes > totalLimit) {
    return {
      key: 'chat.attachmentRejectedTotalTooLarge',
      params: {
        size: formatAttachmentBytes(totalBytes),
        limit: formatAttachmentBytes(totalLimit),
      },
    }
  }

  return null
}
