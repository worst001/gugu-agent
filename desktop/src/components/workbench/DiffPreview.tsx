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
    return <EmptyState icon="difference" title={t('workbench.diff.select')} />
  }

  return (
    <div className="min-h-0">
      <DiffViewer
        filePath={fileChange.filePath}
        oldString={fileChange.oldText}
        newString={fileChange.newText}
      />
    </div>
  )
}
