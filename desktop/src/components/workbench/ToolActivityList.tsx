import { useTranslation, type TranslationKey } from '../../i18n'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { openExternalFromAppAction } from '../../utils/appActions'
import type { ToolActivity, WorkbenchFileChange } from './workbenchModel'

type Props = {
  sessionId: string
  activities: ToolActivity[]
  fileChanges: WorkbenchFileChange[]
  selectedToolUseId: string | null
}

export function ToolActivityList({
  sessionId,
  activities,
  fileChanges,
  selectedToolUseId,
}: Props) {
  const t = useTranslation()
  const selectTool = useWorkbenchStore((state) => state.selectTool)
  const selectFile = useWorkbenchStore((state) => state.selectFile)
  const fileChangeByToolUseId = new Map(fileChanges.map((change) => [change.toolUseId, change]))

  if (activities.length === 0) {
    return <EmptyState icon="construction" title={t('workbench.activity.empty')} />
  }

  return (
    <div className="space-y-1.5">
      {activities.map((activity) => {
        const fileChange = fileChangeByToolUseId.get(activity.toolUseId)
        const isSelected = selectedToolUseId === activity.toolUseId
        const externalUrl = findExternalUrl(activity)
        const selectActivity = () => {
          if (fileChange) {
            selectFile(sessionId, fileChange.filePath, 'diff')
            selectTool(sessionId, activity.toolUseId)
          } else {
            selectTool(sessionId, activity.toolUseId, 'preview')
          }
        }
        return (
          <div
            key={activity.toolUseId}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              isSelected
                ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-container-high)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectActivity}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
              >
                <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                  {getToolIcon(activity.toolName)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-text-primary)]">
                  {activity.toolName}
                </span>
                <StatusPill status={activity.status} />
              </button>
              {externalUrl && (
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                  aria-label={t('workbench.activity.openExternal')}
                  title={t('workbench.activity.openExternal')}
                  onClick={() => void openExternalFromAppAction(externalUrl)}
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                    open_in_new
                  </span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={selectActivity}
              className="mt-1 block w-full truncate text-left text-[11px] text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              {activity.summary}
            </button>
            {activity.filePath && (
              <button
                type="button"
                onClick={selectActivity}
                className="mt-1 block w-full truncate text-left font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
              >
                {activity.filePath}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function findExternalUrl(activity: ToolActivity): string {
  const input = activity.input && typeof activity.input === 'object'
    ? activity.input as Record<string, unknown>
    : {}
  const explicitUrl = typeof input.url === 'string' ? input.url : ''
  if (isHttpUrl(explicitUrl)) return explicitUrl

  const text = JSON.stringify(activity.input)
  const match = text?.match(/https?:\/\/[^\s"'<>\\]+/i)
  return match?.[0] ?? ''
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function StatusPill({ status }: { status: ToolActivity['status'] }) {
  const t = useTranslation()
  const className = status === 'error'
    ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    : status === 'done'
      ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
      : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {t(`workbench.status.${status}` as TranslationKey)}
    </span>
  )
}

export function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-6 text-center">
      <span className="material-symbols-outlined mb-2 text-[24px] text-[var(--color-text-tertiary)]">
        {icon}
      </span>
      <div className="text-xs text-[var(--color-text-secondary)]">{title}</div>
    </div>
  )
}

function getToolIcon(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'terminal'
    case 'Read':
      return 'description'
    case 'Write':
      return 'edit_document'
    case 'Edit':
    case 'MultiEdit':
      return 'edit_note'
    case 'Task':
    case 'Agent':
      return 'smart_toy'
    case 'TodoWrite':
      return 'checklist'
    default:
      return 'build'
  }
}
