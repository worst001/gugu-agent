import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { WorkspacePreviewService } from '../services/workspacePreviewService.js'

const services: WorkspacePreviewService[] = []
const cleanupDirs: string[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.stop()
  for (const dir of cleanupDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe('workspace preview service', () => {
  it('serves HTML and relative assets from an isolated local origin', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-preview-'))
    cleanupDirs.push(root)
    await fs.mkdir(path.join(root, 'assets'))
    await fs.writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="assets/app.css">')
    await fs.writeFile(path.join(root, 'assets', 'app.css'), 'body { color: red; }')

    const service = new WorkspacePreviewService()
    services.push(service)
    const previewUrl = await service.prepare(root, path.join(root, 'index.html'))
    const html = await fetch(previewUrl)
    const css = await fetch(new URL('assets/app.css', previewUrl))

    expect(html.status).toBe(200)
    expect(html.headers.get('content-security-policy')).toContain("object-src 'none'")
    expect(await html.text()).toContain('assets/app.css')
    expect(css.headers.get('content-type')).toContain('text/css')
    expect(await css.text()).toContain('color: red')
  })

  it('resolves relative HTML paths from the current workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-preview-relative-'))
    cleanupDirs.push(root)
    await fs.writeFile(path.join(root, 'index.html'), '<h1>relative preview</h1>')

    const service = new WorkspacePreviewService()
    services.push(service)
    const response = await fetch(await service.prepare(root, 'index.html'))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('relative preview')
  })

  it('rejects preview files outside the workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-preview-root-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-preview-outside-'))
    cleanupDirs.push(root, outside)
    const outsideHtml = path.join(outside, 'index.html')
    await fs.writeFile(outsideHtml, '<h1>outside</h1>')

    const service = new WorkspacePreviewService()
    services.push(service)
    await expect(service.prepare(root, outsideHtml)).rejects.toThrow('outside the current workspace')
  })

  it('does not expose hidden files or unsupported workspace resources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-preview-secret-'))
    cleanupDirs.push(root)
    await fs.writeFile(path.join(root, 'index.html'), '<h1>preview</h1>')
    await fs.writeFile(path.join(root, '.env'), 'SECRET=hidden')
    await fs.writeFile(path.join(root, 'secret.pem'), 'private key')

    const service = new WorkspacePreviewService()
    services.push(service)
    const previewUrl = await service.prepare(root, 'index.html')
    const hidden = await fetch(new URL('.env', previewUrl))
    const unsupported = await fetch(new URL('secret.pem', previewUrl))

    expect(hidden.status).toBe(404)
    expect(unsupported.status).toBe(403)
  })
})
