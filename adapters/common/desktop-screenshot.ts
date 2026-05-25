import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DESKTOP_SCREENSHOT_UNSUPPORTED = 'desktop_screenshot_unsupported_platform'
export const DESKTOP_SCREENSHOT_EMPTY = 'desktop_screenshot_empty'

export async function captureDesktopScreenshot(options: {
  timeoutMs?: number
  tmpPrefix?: string
} = {}): Promise<Buffer> {
  if (process.platform !== 'darwin') {
    throw new Error(DESKTOP_SCREENSHOT_UNSUPPORTED)
  }

  const bridgeUrl = process.env.GUGU_DESKTOP_SCREENSHOT_URL?.trim()
  if (bridgeUrl) {
    return captureDesktopScreenshotViaBridge(bridgeUrl, options.timeoutMs ?? 20_000)
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), options.tmpPrefix ?? 'gugu-shot-'))
  const filePath = path.join(dir, `screen-${Date.now()}.png`)
  try {
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'png', filePath], {
      timeout: options.timeoutMs ?? 20_000,
    })
    const buffer = await fs.readFile(filePath)
    if (buffer.length < 1024) {
      throw new Error(DESKTOP_SCREENSHOT_EMPTY)
    }
    return buffer
  } finally {
    await fs.rm(dir, { force: true, recursive: true }).catch(() => {})
  }
}

async function captureDesktopScreenshotViaBridge(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok) {
      const message = bytes.toString('utf8').trim()
      throw new Error(message || `desktop_screenshot_bridge_http_${response.status}`)
    }
    if (bytes.length < 1024) {
      throw new Error(DESKTOP_SCREENSHOT_EMPTY)
    }
    return bytes
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('desktop_screenshot_timeout')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
