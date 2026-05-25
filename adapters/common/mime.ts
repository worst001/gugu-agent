const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

export function inferMimeType(name: string | undefined, fallback = 'application/octet-stream'): string {
  if (!name) return fallback
  const match = name.toLowerCase().match(/\.[^.\/\\]+$/)
  if (!match) return fallback
  return MIME_BY_EXT[match[0]!] ?? fallback
}

export function isImageMime(mime: string | undefined): boolean {
  return Boolean(mime?.toLowerCase().startsWith('image/'))
}

export function isAudioMime(mime: string | undefined): boolean {
  return Boolean(mime?.toLowerCase().startsWith('audio/'))
}

export function isVideoMime(mime: string | undefined): boolean {
  return Boolean(mime?.toLowerCase().startsWith('video/'))
}
