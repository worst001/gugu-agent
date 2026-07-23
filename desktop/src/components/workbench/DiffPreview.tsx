import { useTranslation } from '../../i18n'
import { DiffViewer } from '../chat/DiffViewer'
import type { WorkbenchFileChange } from './workbenchModel'
import { EmptyState } from './ToolActivityList'

type Props = {
  fileChange: WorkbenchFileChange | null
}

export function DiffPreview({ fileChange }: Props) {
  const t = useTranslation()

  if (!fileChange || fileChange.oldText === undefined || fileChange.newText === undefined) {
    return (
      <div>
        {fileChange?.truncated && (
          <div className="mb-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
            {t('workbench.diff.truncated')}
          </div>
        )}
        <EmptyState
          icon="difference"
          title={fileChange?.binary ? t('workbench.diff.binary') : t('workbench.diff.select')}
        />
      </div>
    )
  }

  return (
    <div className="min-h-0">
      {fileChange.truncated && (
        <div className="mb-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
          {t('workbench.diff.truncated')}
        </div>
      )}
      <DiffViewer
        filePath={fileChange.filePath}
        oldString={fileChange.oldText}
        newString={fileChange.newText}
      />
    </div>
  )
}
