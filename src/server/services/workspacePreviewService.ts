import { randomBytes } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

const MAX_PREVIEW_FILE_SIZE = 100 * 1024 * 1024

const PREVIEW_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

const LOCAL_PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ')

type PreviewRegistration = {
  root: string
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function decodeRelativePath(pathname: string): string | null {
  try {
    const segments = pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
    if (segments.some((segment) => (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.startsWith('.') ||
      /[\\/\0]/.test(segment)
    ))) {
      return null
    }
    return segments.join(path.sep)
  } catch {
    return null
  }
}

export class WorkspacePreviewService {
  private server: ReturnType<typeof Bun.serve> | null = null
  private registrations = new Map<string, PreviewRegistration>()
  private tokenByRoot = new Map<string, string>()

  async prepare(workDir: string, targetPath: string): Promise<string> {
    const root = await fs.realpath(path.resolve(workDir))
    const requestedTarget = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(root, targetPath)
    const target = await fs.realpath(requestedTarget)
    if (!isPathInside(root, target)) {
      throw new Error('Preview file is outside the current workspace')
    }

    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error('Preview target is not a file')
    if (!/\.html?$/i.test(target)) throw new Error('Only local HTML files can be previewed')

    const relativePath = path.relative(root, target)
    const token = this.getOrCreateToken(root)
    const server = this.ensureServer()
    return `http://127.0.0.1:${server.port}/preview/${token}/${encodeRelativePath(relativePath)}`
  }

  private getOrCreateToken(root: string): string {
    const existing = this.tokenByRoot.get(root)
    if (existing) return existing

    const token = randomBytes(24).toString('hex')
    this.tokenByRoot.set(root, token)
    this.registrations.set(token, { root })
    return token
  }

  private ensureServer(): ReturnType<typeof Bun.serve> {
    if (this.server) return this.server

    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req) => this.handleRequest(req),
    })
    return this.server
  }

  stop(): void {
    this.server?.stop(true)
    this.server = null
  }

  private async handleRequest(req: Request): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 })
    }

    const url = new URL(req.url)
    const match = url.pathname.match(/^\/preview\/([a-f0-9]{48})(?:\/(.*))?$/)
    if (!match) return new Response('Not found', { status: 404 })

    const registration = this.registrations.get(match[1] ?? '')
    const relativePath = decodeRelativePath(match[2] ?? '')
    if (!registration || !relativePath) return new Response('Not found', { status: 404 })

    let target = path.resolve(registration.root, relativePath)
    if (!isPathInside(registration.root, target)) {
      return new Response('Access denied', { status: 403 })
    }

    try {
      let stat = await fs.stat(target)
      if (stat.isDirectory()) {
        target = path.join(target, 'index.html')
        stat = await fs.stat(target)
      }
      if (!stat.isFile()) return new Response('Not found', { status: 404 })
      if (stat.size > MAX_PREVIEW_FILE_SIZE) return new Response('File too large', { status: 413 })

      const realTarget = await fs.realpath(target)
      if (!isPathInside(registration.root, realTarget)) {
        return new Response('Access denied', { status: 403 })
      }

      const contentType = PREVIEW_MIME_TYPES[path.extname(realTarget).toLowerCase()]
      if (!contentType) {
        return new Response('Unsupported preview resource', { status: 403 })
      }

      const headers = new Headers({
        'Cache-Control': 'no-store',
        'Content-Type': contentType,
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      if (/\.html?$/i.test(realTarget)) {
        headers.set('Content-Security-Policy', LOCAL_PREVIEW_CSP)
      }

      if (req.method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(await fs.readFile(realTarget), { status: 200, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }
}

export const workspacePreviewService = new WorkspacePreviewService()
