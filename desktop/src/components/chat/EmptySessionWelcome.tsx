import { useTranslation } from '../../i18n'

const STARTER_TASKS = [
  { id: 'document', icon: 'description', labelKey: 'empty.starters.document.label', promptKey: 'empty.starters.document.prompt' },
  { id: 'spreadsheet', icon: 'table_chart', labelKey: 'empty.starters.spreadsheet.label', promptKey: 'empty.starters.spreadsheet.prompt' },
  { id: 'mail', icon: 'mail', labelKey: 'empty.starters.mail.label', promptKey: 'empty.starters.mail.prompt' },
  { id: 'code', icon: 'code', labelKey: 'empty.starters.code.label', promptKey: 'empty.starters.code.prompt' },
  { id: 'folder', icon: 'folder_open', labelKey: 'empty.starters.folder.label', promptKey: 'empty.starters.folder.prompt' },
  { id: 'computer', icon: 'desktop_windows', labelKey: 'empty.starters.computer.label', promptKey: 'empty.starters.computer.prompt' },
] as const

type Props = {
  showStarterTasks?: boolean
  onSelectPrompt?: (prompt: string) => void
}

export function EmptySessionWelcome({ showStarterTasks = true, onSelectPrompt }: Props) {
  const t = useTranslation()

  return (
    <div className="flex max-w-md flex-col items-center text-center">
      <img src="/app-icon.svg" alt="Gugu Agent" className="mb-5 h-20 w-20" />
      <h1 className="mb-2 text-2xl font-extrabold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
        {t('empty.title')}
      </h1>
      <p className="mx-auto max-w-xs text-sm text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
        {t('empty.subtitle')}
      </p>
      {showStarterTasks && onSelectPrompt && (
        <div className="mt-5 grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
          {STARTER_TASKS.map((task) => (
            <button key={task.id} type="button" onClick={() => onSelectPrompt(t(task.promptKey))} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">{task.icon}</span>
              <span className="truncate">{t(task.labelKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}