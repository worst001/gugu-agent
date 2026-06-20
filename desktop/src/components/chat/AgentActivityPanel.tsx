import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import type { ChatState, UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type ActivityStatus = 'active' | 'done' | 'error' | 'pending' | 'warning'

type ActivityItem = {
  id: string
  status: ActivityStatus
  label: string
  detail?: string
}

type PendingPermissionRequest = {
  toolName: string
  toolUseId?: string
  description?: string
  input: unknown
}

type AgentActivityPanelProps = {
  chatState: ChatState
  elapsedSeconds: number
  statusElapsedSeconds?: number
  statusVerb?: string
  activeToolName?: string | null
  activeToolUseId?: string | null
  activeThinkingId?: string | null
  streamingText?: string
  messages: UIMessage[]
  resultMap: Map<string, ToolResult>
  pendingPermission?: PendingPermissionRequest | null
  showAwaitingThinkingHint?: boolean
  showPreResponseHint?: boolean
  onStopTurn?: () => void
  onContinueFromHere?: () => void
}

const MAX_TOOL_ITEMS = 6
const LONG_RUNNING_HINT_SECONDS = 20
const BASH_LONG_SECONDS = 120
const TOOL_VERY_LONG_SECONDS = 600
const WRITE_SLOW_SECONDS = 60
const READ_SEARCH_SLOW_SECONDS = 90
const AGENT_LONG_SECONDS = 120
const MCP_LONG_SECONDS = 60
const NETWORK_LONG_SECONDS = 90
const ATTACHMENT_PARSE_LONG_SECONDS = 30

export function AgentActivityPanel({
  chatState,
  elapsedSeconds,
  statusElapsedSeconds = elapsedSeconds,
  statusVerb = '',
  activeToolName = null,
  activeToolUseId = null,
  activeThinkingId = null,
  streamingText = '',
  messages,
  resultMap,
  pendingPermission = null,
  showAwaitingThinkingHint = false,
  showPreResponseHint = false,
  onStopTurn,
  onContinueFromHere,
}: AgentActivityPanelProps) {
  const t = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const toolCalls = useMemo(
    () => messages.filter((message): message is ToolCall => message.type === 'tool_use'),
    [messages],
  )
  const pendingToolCall = useMemo(
    () => findPendingToolCall(toolCalls, resultMap, activeToolUseId),
    [activeToolUseId, resultMap, toolCalls],
  )
  const recentToolItems = useMemo(
    () => buildToolActivityItems(toolCalls, resultMap, chatState, activeToolUseId, pendingPermission, t),
    [activeToolUseId, chatState, pendingPermission, resultMap, t, toolCalls],
  )
  const longRunningToolItem = useMemo(
    () => pendingToolCall && chatState !== 'permission_pending'
      ? buildLongRunningToolItem(pendingToolCall, elapsedSeconds, t)
      : null,
    [chatState, elapsedSeconds, pendingToolCall, t],
  )
  const phaseItem = useMemo(
    () => buildPhaseItem({
      chatState,
      statusVerb,
      activeToolName: activeToolName ?? pendingToolCall?.toolName ?? null,
      activeThinkingId,
      streamingText,
      messages,
      pendingPermission,
      statusElapsedSeconds,
      t,
    }),
    [activeThinkingId, activeToolName, chatState, messages, pendingPermission, pendingToolCall, statusElapsedSeconds, statusVerb, streamingText, t],
  )
  const totalTools = toolCalls.length
  const completedTools = toolCalls.filter((toolCall) => resultMap.has(toolCall.toolUseId)).length
  const showLongRunningHint = elapsedSeconds >= LONG_RUNNING_HINT_SECONDS
  const displayItems = recentToolItems.length > 0
    ? recentToolItems
    : [buildNoToolActivityItem(chatState, statusVerb ? statusElapsedSeconds : elapsedSeconds, statusVerb, t)]
  const showRecoveryActions = isRecoveryStatus(statusVerb) && Boolean(onStopTurn || onContinueFromHere)

  return (
    <section
      className="mb-3 rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-3 py-2.5 shadow-sm"
      aria-label={t('chat.activity.title')}
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 text-left"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
          <span className="material-symbols-outlined text-[16px]">
            {collapsed ? 'expand_more' : 'expand_less'}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              {t('chat.activity.title')}
            </span>
            {elapsedSeconds > 0 && (
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                {formatElapsed(elapsedSeconds)}
              </span>
            )}
            {totalTools > 0 && (
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {t('chat.activity.toolCount', { completed: completedTools, total: totalTools })}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">
            {phaseItem.label}
          </div>
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand)] animate-pulse-dot" />
      </button>

      {!collapsed && (
        <div className="mt-2 space-y-2 border-t border-[var(--color-border)]/50 pt-2">
          <ActivityRow item={phaseItem} emphasized />
          {longRunningToolItem && <ActivityRow item={longRunningToolItem} emphasized />}
          <div className="space-y-1.5">
            {displayItems.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
          {(showAwaitingThinkingHint || showPreResponseHint || showLongRunningHint) && (
            <p className="pt-1 text-[10px] leading-snug text-[var(--color-text-tertiary)]">
              {showAwaitingThinkingHint
                ? t('streaming.awaitingThinkingHint')
                : showPreResponseHint
                  ? t('streaming.preResponseHint')
                  : t('streaming.longRunningHint')}
            </p>
          )}
          {showRecoveryActions && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onStopTurn && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-high)]"
                  onClick={onStopTurn}
                >
                  <span className="material-symbols-outlined text-[14px]">stop_circle</span>
                  {t('chat.activity.stopTurn')}
                </button>
              )}
              {onContinueFromHere && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--color-brand)] px-2 text-[11px] font-semibold text-white hover:opacity-90"
                  onClick={onContinueFromHere}
                >
                  <span className="material-symbols-outlined text-[14px]">redo</span>
                  {t('chat.activity.continueFromHere')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ActivityRow({ item, emphasized = false }: { item: ActivityItem; emphasized?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className={`material-symbols-outlined mt-0.5 text-[14px] ${statusClass(item.status)}`}>
        {statusIcon(item.status)}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`${emphasized ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} truncate text-[12px]`}>
          {item.label}
        </div>
        {item.detail && (
          <div className="truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">
            {item.detail}
          </div>
        )}
      </div>
    </div>
  )
}

function buildPhaseItem({
  chatState,
  statusVerb,
  activeToolName,
  activeThinkingId,
  streamingText,
  messages,
  pendingPermission,
  statusElapsedSeconds,
  t,
}: {
  chatState: ChatState
  statusVerb: string
  activeToolName: string | null
  activeThinkingId: string | null
  streamingText: string
  messages: UIMessage[]
  pendingPermission: PendingPermissionRequest | null
  statusElapsedSeconds: number
  t: ReturnType<typeof useTranslation>
}): ActivityItem {
  const lastThinking = findLastThinking(messages, activeThinkingId)

  if (chatState === 'permission_pending') {
    return {
      id: 'phase-permission',
      status: 'active',
      label: pendingPermission?.toolName
        ? t('chat.activity.waitingPermissionForTool', { toolName: pendingPermission.toolName })
        : t('chat.activity.waitingPermission'),
      detail: pendingPermission?.description || t('chat.activity.waitingPermissionDetail'),
    }
  }

  if (statusVerb.trim()) {
    if (isAttachmentParsingStatus(statusVerb)) {
      return {
        id: 'phase-status',
        status: statusElapsedSeconds >= ATTACHMENT_PARSE_LONG_SECONDS ? 'warning' : 'active',
        label: statusElapsedSeconds >= ATTACHMENT_PARSE_LONG_SECONDS
          ? t('chat.activity.attachmentParsingLong', { elapsed: formatElapsed(statusElapsedSeconds) })
          : t('chat.activity.attachmentParsing'),
        detail: lastThinking,
      }
    }
    return {
      id: 'phase-status',
      status: 'active',
      label: statusVerb.trim(),
      detail: lastThinking,
    }
  }

  if (chatState === 'tool_executing') {
    return { id: 'phase-tool', status: 'active', label: activeToolName ? t('chat.activity.runningTool', { toolName: activeToolName }) : t('chat.activity.runningToolUnknown') }
  }

  if (chatState === 'streaming') {
    return {
      id: 'phase-streaming',
      status: 'active',
      label: streamingText.trim() ? t('chat.activity.streamingAnswer') : t('chat.activity.preparingAnswer'),
      detail: truncateText(streamingText),
    }
  }

  if (chatState === 'thinking') {
    return {
      id: 'phase-thinking',
      status: 'active',
      label: lastThinking ? t('chat.activity.thinking') : t('chat.activity.waitingModel'),
      detail: lastThinking,
    }
  }

  return { id: 'phase-working', status: 'active', label: t('chat.activity.working') }
}

function buildToolActivityItems(
  toolCalls: ToolCall[],
  resultMap: Map<string, ToolResult>,
  chatState: ChatState,
  activeToolUseId: string | null,
  pendingPermission: PendingPermissionRequest | null,
  t: ReturnType<typeof useTranslation>,
): ActivityItem[] {
  return toolCalls.slice(-MAX_TOOL_ITEMS).reverse().map((toolCall) => {
    const result = resultMap.get(toolCall.toolUseId)
    const isWaitingForPermission =
      chatState === 'permission_pending' &&
      isPermissionForToolCall(pendingPermission, toolCall)
    const isRunning =
      !result &&
      !isWaitingForPermission &&
      (activeToolUseId === toolCall.toolUseId || chatState !== 'idle')
    const status: ActivityStatus = result?.isError ? 'error' : result ? 'done' : isWaitingForPermission ? 'pending' : isRunning ? 'active' : 'pending'
    const label = status === 'error'
      ? t('chat.activity.failedTool', { toolName: toolCall.toolName })
      : status === 'done'
        ? t('chat.activity.finishedTool', { toolName: toolCall.toolName })
        : isWaitingForPermission
          ? t('chat.activity.waitingPermissionForTool', { toolName: toolCall.toolName })
          : t('chat.activity.runningTool', { toolName: toolCall.toolName })
    return {
      id: toolCall.id,
      status,
      label,
      detail: describeToolInput(toolCall.toolName, toolCall.input),
    }
  })
}

function findPendingToolCall(
  toolCalls: ToolCall[],
  resultMap: Map<string, ToolResult>,
  activeToolUseId: string | null,
): ToolCall | null {
  if (activeToolUseId) {
    const active = toolCalls.find((toolCall) =>
      toolCall.toolUseId === activeToolUseId && !resultMap.has(toolCall.toolUseId)
    )
    if (active) return active
  }

  return [...toolCalls].reverse().find((toolCall) => !resultMap.has(toolCall.toolUseId)) ?? null
}

function isPermissionForToolCall(
  pendingPermission: PendingPermissionRequest | null,
  toolCall: ToolCall,
): boolean {
  if (!pendingPermission) return false
  if (pendingPermission.toolUseId) {
    return pendingPermission.toolUseId === toolCall.toolUseId
  }
  return pendingPermission.toolName === toolCall.toolName
}

function buildLongRunningToolItem(
  toolCall: ToolCall,
  elapsedSeconds: number,
  t: ReturnType<typeof useTranslation>,
): ActivityItem | null {
  if (elapsedSeconds < LONG_RUNNING_HINT_SECONDS) return null
  const elapsed = formatElapsed(elapsedSeconds)

  if (toolCall.toolName === 'Bash') {
    if (elapsedSeconds >= TOOL_VERY_LONG_SECONDS) {
      return {
        id: `${toolCall.id}-long-running`,
        status: 'warning',
        label: t('chat.activity.bashVeryLong', { elapsed }),
        detail: t('chat.activity.bashVeryLongDetail'),
      }
    }
    if (elapsedSeconds >= BASH_LONG_SECONDS) {
      return {
        id: `${toolCall.id}-long-running`,
        status: 'warning',
        label: t('chat.activity.bashLong', { elapsed }),
        detail: t('chat.activity.bashLongDetail'),
      }
    }
    return {
      id: `${toolCall.id}-long-running`,
      status: 'active',
      label: t('chat.activity.bashWaiting', { elapsed }),
      detail: t('chat.activity.bashWaitingDetail'),
    }
  }

  if (isWriteLikeTool(toolCall.toolName) && elapsedSeconds >= WRITE_SLOW_SECONDS) {
    return {
      id: `${toolCall.id}-long-running`,
      status: 'warning',
      label: t('chat.activity.writeSlow', { toolName: toolCall.toolName, elapsed }),
      detail: t('chat.activity.writeSlowDetail'),
    }
  }

  if (isAgentTool(toolCall.toolName) && elapsedSeconds >= AGENT_LONG_SECONDS) {
    return {
      id: `${toolCall.id}-long-running`,
      status: 'warning',
      label: t('chat.activity.agentLong', { toolName: toolCall.toolName, elapsed }),
      detail: t('chat.activity.agentLongDetail'),
    }
  }

  if (isMcpTool(toolCall.toolName) && elapsedSeconds >= MCP_LONG_SECONDS) {
    return {
      id: `${toolCall.id}-long-running`,
      status: 'warning',
      label: t('chat.activity.mcpLong', { toolName: displayToolName(toolCall.toolName), elapsed }),
      detail: isCodegraphTool(toolCall.toolName)
        ? t('chat.activity.codegraphLongDetail')
        : t('chat.activity.mcpLongDetail'),
    }
  }

  if (isReadSearchTool(toolCall.toolName) && elapsedSeconds >= READ_SEARCH_SLOW_SECONDS) {
    return {
      id: `${toolCall.id}-long-running`,
      status: 'warning',
      label: t('chat.activity.readSearchLong', { toolName: toolCall.toolName, elapsed }),
      detail: t('chat.activity.readSearchLongDetail'),
    }
  }

  if (isNetworkTool(toolCall.toolName) && elapsedSeconds >= NETWORK_LONG_SECONDS) {
    return {
      id: `${toolCall.id}-long-running`,
      status: 'warning',
      label: t('chat.activity.networkLong', { toolName: toolCall.toolName, elapsed }),
      detail: t('chat.activity.networkLongDetail'),
    }
  }

  if (elapsedSeconds >= BASH_LONG_SECONDS) {
    return {
      id: `${toolCall.id}-long-running`,
      status: 'warning',
      label: t('chat.activity.toolLong', { toolName: toolCall.toolName, elapsed }),
      detail: t('chat.activity.toolLongDetail'),
    }
  }

  return null
}

function isWriteLikeTool(toolName: string): boolean {
  return toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit'
}

function isReadSearchTool(toolName: string): boolean {
  return toolName === 'Read' ||
    toolName === 'Grep' ||
    toolName === 'Glob' ||
    toolName === 'LS' ||
    toolName === 'FileRead'
}

function isAgentTool(toolName: string): boolean {
  return toolName === 'Agent' || toolName === 'Task' || /agent/i.test(toolName)
}

function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__') || /^codegraph/i.test(toolName) || /__codegraph__/i.test(toolName)
}

function isCodegraphTool(toolName: string): boolean {
  return /codegraph/i.test(toolName)
}

function isNetworkTool(toolName: string): boolean {
  return toolName === 'WebFetch' ||
    toolName === 'WebSearch' ||
    toolName === 'Fetch' ||
    toolName === 'web_fetch' ||
    toolName === 'web_search'
}

function displayToolName(toolName: string): string {
  if (isCodegraphTool(toolName)) return 'Codegraph'
  if (toolName.startsWith('mcp__')) return 'MCP'
  return toolName
}

function buildNoToolActivityItem(
  chatState: ChatState,
  elapsedSeconds: number,
  statusVerb: string,
  t: ReturnType<typeof useTranslation>,
): ActivityItem {
  if (isAttachmentParsingStatus(statusVerb)) {
    return {
      id: 'attachment-parse',
      status: elapsedSeconds >= ATTACHMENT_PARSE_LONG_SECONDS ? 'warning' : 'active',
      label: elapsedSeconds >= ATTACHMENT_PARSE_LONG_SECONDS
        ? t('chat.activity.attachmentParsingLong', { elapsed: formatElapsed(elapsedSeconds) })
        : t('chat.activity.attachmentParsing'),
      detail: t('chat.activity.attachmentParsingDetail'),
    }
  }

  if (isRecoveryStatus(statusVerb)) {
    return {
      id: 'recovery-wait',
      status: 'warning',
      label: statusVerb.trim(),
      detail: t('chat.activity.recoveryDetail'),
    }
  }

  const isLongThinking = elapsedSeconds >= LONG_RUNNING_HINT_SECONDS
  if (chatState === 'thinking') {
    return {
      id: 'thinking-no-tool',
      status: isLongThinking ? 'active' : 'pending',
      label: isLongThinking
        ? t('chat.activity.thinkingNoToolLong', { elapsed: formatElapsed(elapsedSeconds) })
        : t('chat.activity.thinkingNoTool'),
      detail: t('chat.activity.thinkingNoToolDetail'),
    }
  }

  if (chatState === 'streaming') {
    return {
      id: 'streaming-no-tool',
      status: 'active',
      label: t('chat.activity.replyNoTool'),
      detail: t('chat.activity.replyNoToolDetail'),
    }
  }

  return {
    id: 'waiting',
    status: 'pending',
    label: t('chat.activity.waitingForActivity'),
  }
}

function isAttachmentParsingStatus(statusVerb: string): boolean {
  return /attachment|file parsing|parsing file/i.test(statusVerb) ||
    statusVerb.includes('附件') ||
    statusVerb.includes('解析')
}

function isRecoveryStatus(statusVerb: string): boolean {
  return /reconnect|recover|interrupted|restored/i.test(statusVerb) ||
    statusVerb.includes('中断') ||
    statusVerb.includes('重连') ||
    statusVerb.includes('恢复')
}

function findLastThinking(messages: UIMessage[], activeThinkingId: string | null): string | undefined {
  if (activeThinkingId) {
    const active = messages.find((message) => message.type === 'thinking' && message.id === activeThinkingId)
    if (active?.type === 'thinking') return truncateText(active.content)
  }
  const last = [...messages].reverse().find((message) => message.type === 'thinking')
  return last?.type === 'thinking' ? truncateText(last.content) : undefined
}

function describeToolInput(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  if (toolName === 'Bash') return truncateText(readString(record, 'command') || readString(record, 'description'))
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    return truncateText(readString(record, 'file_path') || readString(record, 'path'))
  }
  if (toolName === 'Grep') {
    return truncateText([readString(record, 'pattern'), readString(record, 'path')].filter(Boolean).join(' - '))
  }
  if (toolName === 'Glob') {
    return truncateText([readString(record, 'pattern'), readString(record, 'path')].filter(Boolean).join(' - '))
  }
  if (toolName === 'LS') return truncateText(readString(record, 'path'))
  if (toolName === 'WebFetch') return truncateText(readString(record, 'url'))
  if (toolName === 'WebSearch') return truncateText(readString(record, 'query'))
  if (toolName === 'Task' || toolName === 'Agent') {
    return truncateText(readString(record, 'description') || readString(record, 'prompt') || readString(record, 'subagent_type'))
  }
  if (toolName === 'TodoWrite') {
    const todos = Array.isArray(record.todos) ? record.todos : []
    const active = todos.find(
      (todo): todo is Record<string, unknown> =>
        Boolean(todo) &&
        typeof todo === 'object' &&
        (todo as Record<string, unknown>).status === 'in_progress',
    )
    return truncateText((active ? readString(active, 'content') : '') || `${todos.length} todos`)
  }
  return truncateText(readString(record, 'command') || readString(record, 'path') || readString(record, 'query') || readString(record, 'description'))
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function truncateText(value: string | undefined, max = 120): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function statusIcon(status: ActivityStatus): string {
  if (status === 'done') return 'check_circle'
  if (status === 'error') return 'error'
  if (status === 'warning') return 'schedule'
  if (status === 'active') return 'progress_activity'
  return 'radio_button_unchecked'
}

function statusClass(status: ActivityStatus): string {
  if (status === 'done') return 'text-emerald-600'
  if (status === 'error') return 'text-[var(--color-error)]'
  if (status === 'warning') return 'text-[var(--color-warning)]'
  if (status === 'active') return 'animate-spin text-[var(--color-brand)]'
  return 'text-[var(--color-outline)]'
}
