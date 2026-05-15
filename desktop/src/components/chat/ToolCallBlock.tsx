import { useMemo, useState } from 'react'
import { CodeViewer } from './CodeViewer'
import { DiffViewer } from './DiffViewer'
import { TerminalChrome } from './TerminalChrome'
import { CopyButton } from '../shared/CopyButton'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'
import { useTabStore } from '../../stores/tabStore'
import { useWorkbenchStore, type WorkbenchTab } from '../../stores/workbenchStore'
import type { AgentTaskNotification } from '../../types/chat'
import { extractToolResultText, formatToolErrorText } from './toolResultDisplay'

type Props = {
  toolUseId?: string
  toolName: string
  input: unknown
  result?: { content: unknown; isError: boolean } | null
  agentTaskNotification?: AgentTaskNotification
  compact?: boolean
}

const TOOL_ICONS: Record<string, string> = {
  Bash: 'terminal',
  Read: 'description',
  Write: 'edit_document',
  Edit: 'edit_note',
  Glob: 'search',
  Grep: 'find_in_page',
  Agent: 'smart_toy',
  WebSearch: 'travel_explore',
  WebFetch: 'cloud_download',
  NotebookEdit: 'note',
  Skill: 'auto_awesome',
}

export function ToolCallBlock({ toolUseId, toolName, input, result, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openWorkbench = useWorkbenchStore((s) => s.openWorkbench)
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const icon = TOOL_ICONS[toolName] || 'build'
  const filePath = getToolFilePath(obj)
  const summary = getToolSummary(toolName, obj, t)
  const outputSummary = getToolResultSummary(
    toolName,
    result?.content,
    result?.isError ?? false,
    t,
  )

  const preview = useMemo(() => renderPreview(toolName, obj, result, t), [obj, result, toolName, t])
  const details = useMemo(() => renderDetails(toolName, obj, t), [obj, toolName, t])
  const hasResultDetails = Boolean(result && getDisplayResultText(result))
  const expandable = toolName === 'Edit' || toolName === 'Write' || hasResultDetails
  const canOpenWorkbench = Boolean(activeTabId && toolUseId)
  const workbenchTab: WorkbenchTab =
    toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit'
      ? 'diff'
      : 'preview'

  return (
    <div className={`overflow-hidden rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-surface-container-lowest)] ${
      compact ? 'mb-0' : 'mb-2'
    }`}>
      <div className="flex w-full items-center gap-1 px-2 py-1.5 transition-colors hover:bg-[var(--color-surface-hover)]/50">
        <button
          type="button"
          onClick={() => {
            if (expandable) {
              setExpanded((value) => !value)
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <span className="material-symbols-outlined text-[14px] text-[var(--color-outline)]">{icon}</span>
          <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
            {toolName}
          </span>
          {filePath ? (
            <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
              {leafName(filePath)}
            </span>
          ) : summary ? (
            <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {result && outputSummary && (
            <span
              className={`shrink-0 text-[10px] ${
                result.isError
                  ? 'text-[var(--color-error)]'
                  : 'text-[var(--color-outline)]'
              }`}
            >
              {outputSummary}
            </span>
          )}
          {result?.isError && (
            <span className="material-symbols-outlined shrink-0 text-[14px] text-[var(--color-error)]">error</span>
          )}
          {expandable && (
            <span className="material-symbols-outlined text-[14px] text-[var(--color-outline)]">
              {expanded ? 'expand_less' : 'expand_more'}
            </span>
          )}
        </button>
        {canOpenWorkbench && (
          <button
            type="button"
            onClick={() => {
              openWorkbench(activeTabId!, {
                activeTab: workbenchTab,
                selectedToolUseId: toolUseId!,
                selectedAttachmentId: null,
                ...(filePath ? { selectedFilePath: filePath } : {}),
              })
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            aria-label={t('workbench.openTool')}
            title={t('workbench.openTool')}
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          </button>
        )}
      </div>

      {expandable && expanded && (
        <div className="space-y-2.5 border-t border-[var(--color-border)]/60 px-3 py-3">
          {preview}
          {details}
        </div>
      )}
    </div>
  )
}

function renderPreview(
  toolName: string,
  obj: Record<string, unknown>,
  result?: { content: unknown; isError: boolean } | null,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if (toolName === 'Edit' && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if (toolName === 'Write' && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'Bash' && typeof obj.command === 'string') {
    return (
      <TerminalChrome title={typeof obj.description === 'string' ? obj.description : filePath}>
        <div className="px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)]">
          <span className="text-[var(--color-terminal-accent)]">$</span> {obj.command}
        </div>
      </TerminalChrome>
    )
  }

  if (toolName === 'Read') {
    return null
  }

  if (result) {
    const text = getDisplayResultText(result)
    if (text) {
      return (
        <>
          <InlineImageGallery text={text} />
          <div className={`overflow-hidden rounded-lg border ${
            result.isError
              ? 'border-[var(--color-error)]/20 bg-[var(--color-error-container)]/60'
              : 'border-[var(--color-border)] bg-[var(--color-surface)]'
          }`}>
            <div className="flex items-center justify-between border-b border-[var(--color-border)]/60 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-outline)]">
              <span>{result.isError ? t?.('tool.errorOutput') ?? 'Error Output' : t?.('tool.toolOutput') ?? 'Tool Output'}</span>
              <CopyButton
                text={text}
                className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] normal-case tracking-normal text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
              />
            </div>
            <CodeViewer code={text} language="plaintext" maxLines={18} />
          </div>
        </>
      )
    }
  }

  return null
}

function getDisplayResultText(result: { content: unknown; isError: boolean }): string {
  return result.isError
    ? formatToolErrorText(result.content)
    : extractToolResultText(result.content)
}

function renderDetails(toolName: string, obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (toolName === 'Edit' || toolName === 'Write') {
    return null
  }

  const text = JSON.stringify(obj, null, 2)
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-outline)]">
        <span>{t?.('tool.toolInput') ?? 'Tool Input'}</span>
        <CopyButton
          text={text}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] normal-case tracking-normal text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        />
      </div>
      <CodeViewer code={text} language="json" maxLines={18} />
    </div>
  )
}

function getToolResultSummary(
  toolName: string,
  content: unknown,
  isError: boolean,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const text = isError ? formatToolErrorText(content) : extractToolResultText(content)
  if (!text) return ''

  if (isError) {
    return text.length <= 72 ? text : `${text.slice(0, 72)}…`
  }

  if (toolName === 'Bash') return ''

  const lineCount = text.split('\n').length
  if (lineCount > 1) {
    return t?.('tool.linesOutput', { count: lineCount }) ?? `${lineCount} lines output`
  }

  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= 36) return compact
  return `${compact.slice(0, 36)}…`
}

function getToolFilePath(input: Record<string, unknown>): string {
  return (
    (typeof input.file_path === 'string' ? input.file_path : '') ||
    (typeof input.path === 'string' ? input.path : '') ||
    (typeof input.notebook_path === 'string' ? input.notebook_path : '')
  )
}

function leafName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

function getToolSummary(toolName: string, obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (toolName) {
    case 'Bash':
      return typeof obj.command === 'string' ? obj.command : ''
    case 'Read':
      return t?.('tool.readFileContents') ?? 'Read file contents'
    case 'Write':
      return typeof obj.content === 'string'
        ? (t?.('tool.linesCreated', { count: obj.content.split('\n').length }) ?? `${obj.content.split('\n').length} lines created`)
        : (t?.('tool.createFile') ?? 'Create file')
    case 'Edit':
      return typeof obj.old_string === 'string' && typeof obj.new_string === 'string'
        ? changedLineSummary(obj.old_string, obj.new_string, t)
        : (t?.('tool.updateFileContents') ?? 'Update file contents')
    case 'Glob':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Grep':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Agent':
      return typeof obj.description === 'string' ? obj.description : ''
    default:
      return ''
  }
}

function changedLineSummary(oldString: string, newString: string, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  let changed = 0
  const max = Math.max(oldLines.length, newLines.length)

  for (let index = 0; index < max; index += 1) {
    if ((oldLines[index] ?? '') !== (newLines[index] ?? '')) {
      changed += 1
    }
  }

  return t?.('tool.linesChanged', { count: changed }) ?? `${changed} lines changed`
}
