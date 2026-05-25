import { useTranslation, type TranslationKey } from '../../i18n'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type { WorkbenchFileChange } from './workbenchModel'
import { EmptyState } from './ToolActivityList'

type Props = {
  sessionId: string
  fileChanges: WorkbenchFileChange[]
  selectedFilePath: string | null
}

export function FileChangeList({ sessionId, fileChanges, selectedFilePath }: Props) {
  const t = useTranslation()
  const selectFile = useWorkbenchStore((state) => state.selectFile)
  const selectTool = useWorkbenchStore((state) => state.selectTool)

  if (fileChanges.length === 0) {
    return <EmptyState icon="difference" title={t('workbench.diff.empty')} />
  }

  return (
    <div className="space-y-1.5">
      {fileChanges.map((change) => {
        const selected = selectedFilePath === change.filePath
        return (
          <button
            key={change.id}
            type="button"
            onClick={() => {
              selectFile(sessionId, change.filePath, 'diff')
              selectTool(sessionId, change.toolUseId)
            }}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              selected
                ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-container-high)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                {change.kind === 'created' ? 'note_add' : 'edit_note'}
              </span>
              <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-primary)]">
                {change.filePath}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-tertiary)]">
              <span>{t(`workbench.change.${change.kind}` as TranslationKey)}</span>
              <span>{change.summary}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
