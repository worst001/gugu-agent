import { useTranslation, type TranslationKey } from '../../i18n'
import { useWorkbenchStore } from '../../stores/workbenchStore'
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
        return (
          <button
            key={activity.toolUseId}
            type="button"
            onClick={() => {
              if (fileChange) {
                selectFile(sessionId, fileChange.filePath, 'diff')
                selectTool(sessionId, activity.toolUseId)
              } else {
                selectTool(sessionId, activity.toolUseId, 'preview')
              }
            }}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              isSelected
                ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-container-high)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                {getToolIcon(activity.toolName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-text-primary)]">
                {activity.toolName}
              </span>
              <StatusPill status={activity.status} />
            </div>
            <div className="mt-1 truncate text-[11px] text-[var(--color-text-secondary)]">
              {activity.summary}
            </div>
            {activity.filePath && (
              <div className="mt-1 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
                {activity.filePath}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
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
