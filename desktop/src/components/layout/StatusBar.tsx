import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'

export function StatusBar() {
  const t = useTranslation()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const currentModel = useSettingsStore((s) => s.currentModel)
  const projectPath = useSessionStore((s) => s.sessions.find((session) => session.id === activeTabId)?.projectPath)

  const projectName = projectPath
    ? projectPath.split('-').filter(Boolean).pop() || ''
    : ''
  const modelLabel = currentModel?.name ?? currentModel?.id ?? t('statusBar.modelFromServerEnv')

  return (
    <div className="h-[var(--statusbar-height)] flex items-center justify-between px-4 border-t border-[var(--color-border)] bg-[var(--color-surface-sidebar)] select-none text-[11px]">
      <div className="flex items-center gap-3">
        {projectName && (
          <span className="text-[var(--color-text-secondary)] font-[var(--font-mono)]">{projectName}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-[var(--color-text-tertiary)] font-[var(--font-mono)]">
          {modelLabel}
        </span>
      </div>
    </div>
  )
}
