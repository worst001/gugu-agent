import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { enqueue } from './chat-queue.js'
import { checkAttachmentLimit } from './attachment/attachment-limits.js'
import type { AttachmentRef, PendingFileUpload, PendingUpload } from './attachment/attachment-types.js'
import { FileLinkWatcher } from './attachment/file-link-watcher.js'
import { ImageBlockWatcher } from './attachment/image-block-watcher.js'
import {
  formatImHelp,
  formatImStatus,
  formatPermissionRequest,
} from './format.js'
import { inferMimeType } from './mime.js'
import { AdapterHttpClient } from './http-client.js'
import { MessageDedup } from './message-dedup.js'
import { isAllowedUser, tryPair } from './pairing.js'
import { SessionStore } from './session-store.js'
import { WsBridge, type ServerMessage } from './ws-bridge.js'
import { redactInternalBranding, wrapImUserMessage } from './brand.js'
import {
  captureDesktopScreenshot,
  DESKTOP_SCREENSHOT_EMPTY,
  DESKTOP_SCREENSHOT_UNSUPPORTED,
} from './desktop-screenshot.js'
import { isScreenshotCommand } from './screenshot-command.js'

type AdapterPlatform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq'

type ChatRuntimeState = {
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'
  verb?: string
  model?: string
  pendingPermissionCount: number
}

export type IncomingTextMessage = {
  conversationId: string
  userId: string | number
  displayName: string
  text: string
  messageId?: string
  attachments?: AttachmentRef[]
}

export type OutboundImagePayload = {
  buffer: Buffer
  fileName: string
  mimeType: string
  caption?: string
  replyToMessageId?: string
}

export type OutboundFilePayload = {
  path: string
  fileName: string
  mimeType?: string
  caption?: string
}

type TextChatRunnerOptions = {
  platform: AdapterPlatform
  serverUrl: string
  defaultProjectDir: string
  sendText: (conversationId: string, text: string) => Promise<void>
  sendImage?: (conversationId: string, image: OutboundImagePayload) => Promise<void>
  sendFile?: (conversationId: string, file: OutboundFilePayload) => Promise<void>
  userLabel: string
  permissionMode?: string
  mediaHelpLine?: string
  screenshotTmpPrefix?: string
}

export class TextChatRunner {
  private bridge: WsBridge
  private dedup = new MessageDedup()
  private sessionStore = new SessionStore()
  private httpClient: AdapterHttpClient
  private pendingProjectSelection = new Map<string, boolean>()
  private accumulatedText = new Map<string, string>()
  private pendingPermissions = new Map<string, Set<string>>()
  private runtimeStates = new Map<string, ChatRuntimeState>()
  private imageWatchers = new Map<string, ImageBlockWatcher>()
  private fileWatchers = new Map<string, FileLinkWatcher>()

  constructor(private options: TextChatRunnerOptions) {
    this.bridge = new WsBridge(options.serverUrl, options.platform)
    this.httpClient = new AdapterHttpClient(options.serverUrl)
  }

  destroy(): void {
    this.bridge.destroy()
    this.dedup.destroy()
  }

  async handleIncomingText(message: IncomingTextMessage): Promise<void> {
    const text = message.text.trim()
    const attachments = message.attachments ?? []
    if (!text && attachments.length === 0) return

    const attachmentFingerprint = attachments
      .map((a) => `${a.type}:${a.name ?? ''}:${a.path ?? ''}:${a.mimeType ?? ''}`)
      .join('|')
    const dedupId = message.messageId || `${message.conversationId}:${Date.now()}:${text}:${attachmentFingerprint}`
    if (!this.dedup.tryRecord(dedupId)) return

    if (!isAllowedUser(this.options.platform, message.userId)) {
      const success = tryPair(
        text,
        { userId: message.userId, displayName: message.displayName || this.options.userLabel },
        this.options.platform,
      )
      await this.sendText(
        message.conversationId,
        success
          ? '配对成功！现在可以开始聊天了。\n\n发送消息即可与 Gu Agent 对话。'
          : '未授权。请在 Gugu Agent 桌面端生成配对码后发送给我。',
      )
      return
    }

    enqueue(message.conversationId, async () => {
      await this.routeText(message.conversationId, text, attachments, message.messageId)
    })
  }

  private async routeText(
    conversationId: string,
    text: string,
    attachments: AttachmentRef[],
    messageId?: string,
  ): Promise<void> {
    const hasAttachments = attachments.length > 0

    if (!hasAttachments) {
      const permission = this.resolvePermissionCommand(conversationId, text)
      if (permission.handled) {
        if (!permission.requestId) {
          await this.sendText(conversationId, '没有找到待确认的权限请求，或存在多个请求需要带上 requestId。')
          return
        }
        this.bridge.sendPermissionResponse(
          conversationId,
          permission.requestId,
          permission.allowed ?? false,
          permission.rule,
        )
        this.removePendingPermission(conversationId, permission.requestId)
        const runtime = this.getRuntimeState(conversationId)
        runtime.pendingPermissionCount = Math.max(0, runtime.pendingPermissionCount - 1)
        await this.sendText(
          conversationId,
          permission.allowed
            ? permission.rule === 'always'
              ? '已永久允许（本次会话内不再询问相同操作）。'
              : '已允许。'
            : '已拒绝。',
        )
        return
      }

      if (text === '/help' || text === '帮助') {
        await this.sendText(conversationId, this.formatHelp())
        return
      }
      if (text === '/new' || text === '新会话' || text.startsWith('/new ')) {
        const arg = text.startsWith('/new ') ? text.slice(5).trim() : ''
        await this.startNewSession(conversationId, arg || undefined)
        return
      }
      if (text === '/projects' || text === '项目列表') {
        await this.showProjectPicker(conversationId)
        return
      }
      if (text === '/status' || text === '状态') {
        await this.sendText(conversationId, await this.buildStatusText(conversationId))
        return
      }
      if (text === '/stop' || text === '停止') {
        const stored = await this.ensureExistingSession(conversationId)
        if (!stored) {
          await this.sendText(conversationId, formatImStatus(null))
          return
        }
        this.bridge.sendStopGeneration(conversationId)
        await this.sendText(conversationId, '已发送停止信号。')
        return
      }
      if (text === '/clear' || text === '清空') {
        const stored = await this.ensureExistingSession(conversationId)
        if (!stored) {
          await this.sendText(conversationId, formatImStatus(null))
          return
        }
        this.clearTransientChatState(conversationId)
        const sent = this.bridge.sendUserMessage(conversationId, '/clear')
        if (!sent) {
          await this.sendText(conversationId, '无法发送 /clear，请先发送 /new 重新连接会话。')
          return
        }
        await this.sendText(conversationId, '已清空当前会话上下文。')
        return
      }

      if (this.options.sendImage && isScreenshotCommand(text)) {
        await this.captureAndSendScreenshot(conversationId, messageId)
        return
      }
    }

    if (!hasAttachments && this.pendingProjectSelection.has(conversationId)) {
      await this.startNewSession(conversationId, text)
      return
    }

    const ready = await this.ensureSession(conversationId)
    if (!ready) return

    const effectiveText = text || (hasAttachments ? '(用户发送了附件)' : '')
    if (!effectiveText && !hasAttachments) return

    const sent = this.bridge.sendUserMessage(
      conversationId,
      wrapImUserMessage(effectiveText),
      hasAttachments ? attachments : undefined,
      this.options.permissionMode ? { permissionMode: this.options.permissionMode } : undefined,
    )
    if (!sent) {
      await this.sendText(conversationId, '消息发送失败，连接可能已断开。请发送 /new 重新开始。')
    }
  }

  private async ensureSession(conversationId: string): Promise<boolean> {
    if (this.bridge.hasSession(conversationId)) return true

    const stored = this.sessionStore.get(conversationId)
    if (stored) {
      this.bridge.connectSession(conversationId, stored.sessionId)
      this.bridge.onServerMessage(conversationId, (msg) => this.handleServerMessage(conversationId, msg))
      return await this.bridge.waitForOpen(conversationId)
    }

    if (this.options.defaultProjectDir) {
      return await this.createSessionForChat(conversationId, this.options.defaultProjectDir)
    }

    await this.showProjectPicker(conversationId)
    return false
  }

  private async ensureExistingSession(conversationId: string): Promise<{ sessionId: string; workDir: string } | null> {
    const stored = this.sessionStore.get(conversationId)
    if (!stored) return null

    if (!this.bridge.hasSession(conversationId)) {
      this.bridge.connectSession(conversationId, stored.sessionId)
      this.bridge.onServerMessage(conversationId, (msg) => this.handleServerMessage(conversationId, msg))
      const opened = await this.bridge.waitForOpen(conversationId)
      if (!opened) return null
    }

    return stored
  }

  private async createSessionForChat(conversationId: string, workDir: string): Promise<boolean> {
    try {
      this.bridge.resetSession(conversationId)
      this.clearTransientChatState(conversationId)

      const sessionId = await this.httpClient.createSession(workDir)
      this.sessionStore.set(conversationId, sessionId, workDir)
      this.bridge.connectSession(conversationId, sessionId)
      this.bridge.onServerMessage(conversationId, (msg) => this.handleServerMessage(conversationId, msg))
      const opened = await this.bridge.waitForOpen(conversationId)
      if (!opened) {
        await this.sendText(conversationId, '连接服务器超时，请重试。')
        return false
      }
      return true
    } catch (err) {
      await this.sendText(conversationId, `无法创建会话: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private async showProjectPicker(conversationId: string): Promise<void> {
    try {
      const projects = await this.httpClient.listRecentProjects()
      if (projects.length === 0) {
        await this.sendText(conversationId, '没有找到最近的项目。请先在 Desktop App 中打开一个项目，或在设置中配置默认项目。')
        return
      }

      const lines = projects.slice(0, 10).map((p, i) =>
        `${i + 1}. ${p.projectName}${p.branch ? ` (${p.branch})` : ''}\n   ${p.realPath}`
      )
      this.pendingProjectSelection.set(conversationId, true)
      await this.sendText(conversationId, `选择项目（回复编号）：\n\n${lines.join('\n\n')}\n\n下次可直接 /new <编号或名称> 快速新建会话`)
    } catch (err) {
      await this.sendText(conversationId, `无法获取项目列表: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async startNewSession(conversationId: string, query?: string): Promise<void> {
    this.bridge.resetSession(conversationId)
    this.sessionStore.delete(conversationId)
    this.accumulatedText.delete(conversationId)
    this.pendingProjectSelection.delete(conversationId)
    this.pendingPermissions.delete(conversationId)
    this.runtimeStates.delete(conversationId)
    this.imageWatchers.delete(conversationId)
    this.fileWatchers.delete(conversationId)

    if (query) {
      try {
        const { project, ambiguous } = await this.httpClient.matchProject(query)
        if (project) {
          const ok = await this.createSessionForChat(conversationId, project.realPath)
          if (ok) {
            await this.sendText(conversationId, `已新建会话：${project.projectName}${project.branch ? ` (${project.branch})` : ''}`)
          }
          return
        }
        if (ambiguous) {
          const list = ambiguous.map((p, i) => `${i + 1}. ${p.projectName} - ${p.realPath}`).join('\n')
          await this.sendText(conversationId, `匹配到多个项目，请更精确：\n\n${list}`)
          return
        }
        await this.sendText(conversationId, `未找到匹配 "${query}" 的项目。发送 /projects 查看完整列表。`)
      } catch (err) {
        await this.sendText(conversationId, err instanceof Error ? err.message : String(err))
      }
    } else if (this.options.defaultProjectDir) {
      const ok = await this.createSessionForChat(conversationId, this.options.defaultProjectDir)
      if (ok) await this.sendText(conversationId, '已新建会话，可以开始对话了。')
    } else {
      await this.showProjectPicker(conversationId)
    }
  }

  private async buildStatusText(conversationId: string): Promise<string> {
    const stored = await this.ensureExistingSession(conversationId)
    if (!stored) return formatImStatus(null)

    const runtime = this.getRuntimeState(conversationId)
    let projectName = path.basename(stored.workDir) || stored.workDir
    let branch: string | null = null

    try {
      const gitInfo = await this.httpClient.getGitInfo(stored.sessionId)
      projectName = gitInfo.repoName || path.basename(gitInfo.workDir) || projectName
      branch = gitInfo.branch
    } catch {
      // Fall back to stored workDir.
    }

    return formatImStatus({
      sessionId: stored.sessionId,
      projectName,
      branch,
      model: runtime.model,
      state: runtime.state,
      verb: runtime.verb,
      pendingPermissionCount: runtime.pendingPermissionCount,
    })
  }

  private async handleServerMessage(conversationId: string, msg: ServerMessage): Promise<void> {
    const runtime = this.getRuntimeState(conversationId)

    switch (msg.type) {
      case 'connected':
        break

      case 'status':
        runtime.state = msg.state
        runtime.verb = typeof msg.verb === 'string' ? msg.verb : undefined
        break

      case 'content_start':
        if (msg.blockType === 'text') {
          this.accumulatedText.set(conversationId, this.accumulatedText.get(conversationId) ?? '')
        }
        break

      case 'content_delta':
        if (typeof msg.text === 'string' && msg.text) {
          this.accumulatedText.set(conversationId, (this.accumulatedText.get(conversationId) ?? '') + msg.text)
          if (this.options.sendImage) {
            for (const pending of this.getImageWatcher(conversationId).feed(msg.text)) {
              void this.dispatchOutboundImage(conversationId, pending)
            }
          }
          if (this.options.sendFile) {
            for (const pending of this.getFileWatcher(conversationId).feed(msg.text)) {
              void this.dispatchOutboundFile(conversationId, pending)
            }
          }
        }
        break

      case 'permission_request': {
        runtime.pendingPermissionCount += 1
        runtime.state = 'permission_pending'
        this.addPendingPermission(conversationId, msg.requestId)
        await this.sendText(
          conversationId,
          `${formatPermissionRequest(msg.toolName, msg.input, msg.requestId)}\n\n回复 /allow ${msg.requestId} 允许，/always ${msg.requestId} 本次会话永久允许，或 /deny ${msg.requestId} 拒绝。`,
        )
        break
      }

      case 'message_complete': {
        runtime.state = 'idle'
        runtime.verb = undefined
        const text = this.accumulatedText.get(conversationId)
        this.accumulatedText.delete(conversationId)
        if (text?.trim()) {
          await this.sendText(conversationId, redactInternalBranding(text.trim()))
        }
        break
      }

      case 'error':
        runtime.state = 'idle'
        runtime.verb = undefined
        this.accumulatedText.delete(conversationId)
        if (msg.message && /Invalid.*signature.*thinking/i.test(msg.message)) {
          const stored = this.sessionStore.get(conversationId)
          const workDir = stored?.workDir || this.options.defaultProjectDir
          if (workDir) {
            await this.sendText(conversationId, '会话上下文已失效，正在自动重建...')
            this.clearTransientChatState(conversationId)
            this.bridge.resetSession(conversationId)
            this.sessionStore.delete(conversationId)
            const ok = await this.createSessionForChat(conversationId, workDir)
            await this.sendText(conversationId, ok ? '已重建会话，请重新发送消息。' : '重建会话失败，请发送 /new 手动新建。')
          } else {
            await this.sendText(conversationId, '会话上下文已失效，请发送 /new 新建会话。')
          }
        } else {
          await this.sendText(conversationId, `错误: ${msg.message}`)
        }
        break

      case 'system_notification':
        if (msg.subtype === 'init' && msg.data && typeof msg.data === 'object') {
          const model = (msg.data as Record<string, unknown>).model
          if (typeof model === 'string' && model.trim()) {
            runtime.model = model
          }
        }
        break
    }
  }

  private resolvePermissionCommand(
    conversationId: string,
    text: string,
  ): { handled: boolean; requestId?: string; allowed?: boolean; rule?: string } {
    const match = text.match(/^(?:\/(allow|deny|always)|允许|拒绝|永久允许)(?:\s+(\S+))?$/i)
    if (!match) return { handled: false }

    const command = match[1]?.toLowerCase() || text
    const requests = this.pendingPermissions.get(conversationId)
    if (!requests || requests.size === 0) return { handled: true }

    const explicitId = match[2]
    let requestId = explicitId
    if (!requestId) {
      if (requests.size > 1) return { handled: true }
      requestId = [...requests][0]
    }

    if (!requestId || !requests.has(requestId)) return { handled: true }

    const allowed = command === 'allow' || command === 'always' || command === '允许' || command === '永久允许'
    const rule = command === 'always' || command === '永久允许' ? 'always' : undefined
    return { handled: true, requestId, allowed, rule }
  }

  private getRuntimeState(conversationId: string): ChatRuntimeState {
    let state = this.runtimeStates.get(conversationId)
    if (!state) {
      state = { state: 'idle', pendingPermissionCount: 0 }
      this.runtimeStates.set(conversationId, state)
    }
    return state
  }

  private addPendingPermission(conversationId: string, requestId: string): void {
    let requests = this.pendingPermissions.get(conversationId)
    if (!requests) {
      requests = new Set()
      this.pendingPermissions.set(conversationId, requests)
    }
    requests.add(requestId)
  }

  private removePendingPermission(conversationId: string, requestId: string): void {
    const requests = this.pendingPermissions.get(conversationId)
    if (!requests) return
    requests.delete(requestId)
    if (requests.size === 0) this.pendingPermissions.delete(conversationId)
  }

  private clearTransientChatState(conversationId: string): void {
    this.accumulatedText.delete(conversationId)
    this.pendingPermissions.delete(conversationId)
    this.imageWatchers.delete(conversationId)
    this.fileWatchers.delete(conversationId)
    const runtime = this.getRuntimeState(conversationId)
    runtime.state = 'idle'
    runtime.verb = undefined
    runtime.pendingPermissionCount = 0
  }

  private async sendText(conversationId: string, text: string): Promise<void> {
    try {
      await this.options.sendText(conversationId, text)
    } catch (err) {
      console.error(`[${this.options.platform}] sendText failed:`, err instanceof Error ? err.message : err)
    }
  }

  private formatHelp(): string {
    const lines = [formatImHelp()]
    if (this.options.mediaHelpLine) {
      lines.push(this.options.mediaHelpLine)
    } else if (this.options.sendImage || this.options.sendFile) {
      lines.push('图片/文件：可直接发送给我；需要当前屏幕时发送“截图给我”。')
    }
    return lines.join('\n\n')
  }

  private getImageWatcher(conversationId: string): ImageBlockWatcher {
    let watcher = this.imageWatchers.get(conversationId)
    if (!watcher) {
      watcher = new ImageBlockWatcher()
      this.imageWatchers.set(conversationId, watcher)
    }
    return watcher
  }

  private getFileWatcher(conversationId: string): FileLinkWatcher {
    let watcher = this.fileWatchers.get(conversationId)
    if (!watcher) {
      watcher = new FileLinkWatcher()
      this.fileWatchers.set(conversationId, watcher)
    }
    return watcher
  }

  private async dispatchOutboundImage(conversationId: string, pending: PendingUpload): Promise<void> {
    if (!this.options.sendImage) return
    try {
      let buffer: Buffer
      let mimeType = 'image/png'
      let fileName = `gugu-image-${Date.now()}.png`

      switch (pending.source.kind) {
        case 'base64':
          buffer = Buffer.from(pending.source.data, 'base64')
          mimeType = pending.source.mime
          break
        case 'path':
          buffer = await fs.readFile(pending.source.path)
          mimeType = pending.source.mime ?? inferMimeType(pending.source.path, 'image/png')
          fileName = path.basename(pending.source.path) || fileName
          break
        case 'url': {
          const resp = await fetch(pending.source.url)
          if (!resp.ok) throw new Error(`fetch ${pending.source.url} -> ${resp.status}`)
          buffer = Buffer.from(await resp.arrayBuffer())
          mimeType = normalizeMime(pending.source.mime ?? resp.headers.get('content-type') ?? 'image/png')
          const urlPath = new URL(pending.source.url).pathname
          fileName = path.basename(urlPath) || fileName
          break
        }
      }

      const check = checkAttachmentLimit('image', buffer.length, mimeType)
      if (!check.ok) {
        console.warn(`[${this.options.platform}] Outbound image rejected:`, check.hint)
        return
      }
      await this.options.sendImage(conversationId, {
        buffer,
        fileName,
        mimeType,
        caption: pending.alt,
      })
    } catch (err) {
      console.error(`[${this.options.platform}] dispatchOutboundImage failed:`, err instanceof Error ? err.message : err)
    }
  }

  private async dispatchOutboundFile(conversationId: string, pending: PendingFileUpload): Promise<void> {
    if (!this.options.sendFile) return
    try {
      const stat = await fs.stat(pending.source.path)
      const mimeType = pending.source.mime ?? inferMimeType(pending.source.path)
      const check = checkAttachmentLimit('file', stat.size, mimeType)
      if (!check.ok) {
        await this.sendText(conversationId, check.hint)
        return
      }
      await this.options.sendFile(conversationId, {
        path: pending.source.path,
        fileName: fileNameForUpload(pending),
        mimeType,
      })
    } catch (err) {
      console.error(`[${this.options.platform}] dispatchOutboundFile failed:`, err instanceof Error ? err.message : err)
    }
  }

  private async captureAndSendScreenshot(conversationId: string, replyToMessageId?: string): Promise<void> {
    if (!this.options.sendImage) return
    await this.sendText(conversationId, '正在截取当前屏幕...')

    let buffer: Buffer
    try {
      buffer = await captureDesktopScreenshot({
        timeoutMs: 20_000,
        tmpPrefix: this.options.screenshotTmpPrefix ?? 'gugu-im-shot-',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === DESKTOP_SCREENSHOT_UNSUPPORTED) {
        await this.sendText(conversationId, '当前系统暂不支持直接截图。')
      } else if (message === DESKTOP_SCREENSHOT_EMPTY || message === 'desktop_screenshot_empty') {
        await this.sendText(conversationId, '没有拿到有效截图，请确认系统屏幕录制权限已授予 Gugu Agent。')
      } else if (message === 'desktop_screenshot_timeout') {
        await this.sendText(conversationId, '截图超时了。请确认系统屏幕录制权限已授予 Gugu Agent，然后重启本地接入再试。')
      } else {
        await this.sendText(conversationId, `截图失败：${message}`)
      }
      return
    }

    const check = checkAttachmentLimit('image', buffer.length, 'image/png')
    if (!check.ok) {
      await this.sendText(conversationId, check.hint)
      return
    }

    await this.sendText(conversationId, '截图已完成，正在发送图片...')
    try {
      await this.options.sendImage(conversationId, {
        buffer,
        fileName: `gugu-screenshot-${Date.now()}.png`,
        mimeType: 'image/png',
        replyToMessageId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.sendText(conversationId, `截图已完成，但发送到 ${this.options.platform.toUpperCase()} 失败：${message}`)
    }
  }
}

function normalizeMime(mime: string): string {
  return mime.split(';', 1)[0]!.trim().toLowerCase()
}

function fileNameForUpload(pending: PendingFileUpload): string {
  const base = path.basename(pending.source.path) || `gugu-file-${Date.now()}`
  const label = pending.label?.trim()
  if (!label) return base
  return path.extname(label) ? label : base
}
