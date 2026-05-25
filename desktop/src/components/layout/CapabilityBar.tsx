import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AlertTriangle, Cpu, FileScan, Gauge, Plug, Puzzle, Sparkles, Terminal } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useCapabilityStore, type AttachmentParserCapabilityStatus } from '../../stores/capabilityStore'
import { useSessionStore } from '../../stores/sessionStore'
import { SETTINGS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'

export function CapabilityBar() {
  const t = useTranslation()
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const sessions = useSessionStore((state) => state.sessions)
  const summary = useCapabilityStore((state) => state.summary)
  const isLoading = useCapabilityStore((state) => state.isLoading)
  const refreshCapabilities = useCapabilityStore((state) => state.refreshCapabilities)
  const initialRefreshKeyRef = useRef<string | null>(null)
  const bundledProbeKeyRef = useRef<string | null>(null)

  const activeWorkDir = useMemo(() => {
    const session = activeTabId ? sessions.find((item) => item.id === activeTabId) : null
    return session?.workDir || undefined
  }, [activeTabId, sessions])

  useEffect(() => {
    if (!sidebarOpen) return
    const refreshKey = activeWorkDir ?? '__global__'
    const force = initialRefreshKeyRef.current !== refreshKey
    initialRefreshKeyRef.current = refreshKey
    void refreshCapabilities(activeWorkDir, { force })
  }, [activeWorkDir, refreshCapabilities, sidebarOpen])

  useEffect(() => {
    const errorCount = Object.keys(summary.errors).length
    const shouldProbeBundledPack =
      sidebarOpen &&
      !isLoading &&
      summary.updatedAt !== null &&
      summary.skills.total === 0 &&
      summary.plugins.total === 0 &&
      errorCount === 0

    if (!shouldProbeBundledPack) return

    const probeKey = `${activeWorkDir ?? '__global__'}:${summary.updatedAt}`
    if (bundledProbeKeyRef.current === probeKey) return
    bundledProbeKeyRef.current = probeKey

    const timeout = window.setTimeout(() => {
      void refreshCapabilities(activeWorkDir, { force: true })
    }, 1500)

    return () => window.clearTimeout(timeout)
  }, [
    activeWorkDir,
    isLoading,
    refreshCapabilities,
    sidebarOpen,
    summary.errors,
    summary.plugins.total,
    summary.skills.total,
    summary.updatedAt,
  ])

  const modelLabel = summary.model?.name || summary.model?.id || t('capabilities.noModel')
  const providerLabel = summary.providerName || t('capabilities.noProvider')
  const parserTone = getParserTone(summary.attachmentParser.status)
  const hasCapabilitySnapshot = summary.updatedAt !== null
  const scanningLabel = t('capabilities.scanning')
  const hasAttention =
    summary.attachmentParser.status === 'needs_config' ||
    summary.attachmentParser.status === 'error' ||
    summary.mcp.attention > 0 ||
    summary.plugins.errors > 0 ||
    Object.keys(summary.errors).length > 0

  const openSettings = (tab: SettingsTab) => {
    useUIStore.getState().setPendingSettingsTab(tab)
    useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')
  }

  if (!sidebarOpen) {
    return (
      <div className="px-3 pb-2">
        <button
          type="button"
          aria-label={t('capabilities.open')}
          title={t('capabilities.open')}
          onClick={() => openSettings('providers')}
          className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <Cpu className="h-[18px] w-[18px]" aria-hidden="true" />
          {hasAttention && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
          )}
        </button>
      </div>
    )
  }

  return (
    <section className="px-3 pb-2" aria-label={t('capabilities.title')}>
      <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            {t('capabilities.title')}
          </span>
          {isLoading ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-[var(--color-brand)] border-t-transparent" aria-label={t('common.loading')} />
          ) : hasAttention ? (
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning)]" aria-hidden="true" />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <CapabilityChip
            label={providerLabel}
            detail={modelLabel}
            icon={<Cpu className="h-3.5 w-3.5" />}
            onClick={() => openSettings('providers')}
            title={`${providerLabel} - ${modelLabel}`}
            wide
          />
          <CapabilityChip
            label={t('capabilities.effort')}
            detail={summary.effort ? t(`settings.general.effort.${summary.effort}`) : t('capabilities.unknown')}
            icon={<Gauge className="h-3.5 w-3.5" />}
            onClick={() => openSettings('general')}
            title={t('capabilities.effort')}
          />
          <CapabilityChip
            label="GLM"
            detail={t(`capabilities.parser.${summary.attachmentParser.status}`)}
            icon={<FileScan className="h-3.5 w-3.5" />}
            onClick={() => openSettings('attachmentParser')}
            title={t(`capabilities.parser.${summary.attachmentParser.status}`)}
            tone={parserTone}
          />
          <CapabilityChip
            label="MCP"
            detail={!hasCapabilitySnapshot
              ? scanningLabel
              : summary.mcp.attention > 0
                ? t('capabilities.mcpAttention', { count: summary.mcp.attention })
                : t('capabilities.count', { count: summary.mcp.total })}
            icon={<Plug className="h-3.5 w-3.5" />}
            onClick={() => openSettings('mcp')}
            title={t('settings.tab.mcp')}
            tone={summary.mcp.attention > 0 ? 'warning' : undefined}
          />
          <CapabilityChip
            label={t('settings.tab.skills')}
            detail={hasCapabilitySnapshot
              ? t('capabilities.count', { count: summary.skills.invocable || summary.skills.total })
              : scanningLabel}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={() => openSettings('skills')}
            title={t('settings.tab.skills')}
          />
          <CapabilityChip
            label={t('settings.tab.plugins')}
            detail={!hasCapabilitySnapshot
              ? scanningLabel
              : summary.plugins.errors > 0
                ? t('capabilities.pluginErrors', { count: summary.plugins.errors })
                : t('capabilities.enabledOfTotal', { enabled: summary.plugins.enabled, total: summary.plugins.total })}
            icon={<Puzzle className="h-3.5 w-3.5" />}
            onClick={() => openSettings('plugins')}
            title={t('settings.tab.plugins')}
            tone={summary.plugins.errors > 0 ? 'warning' : undefined}
          />
          <CapabilityChip
            label={t('settings.tab.terminal')}
            detail={t('settings.terminal.windowTitle')}
            icon={<Terminal className="h-3.5 w-3.5" />}
            onClick={() => openSettings('terminal')}
            title={t('settings.terminal.description')}
          />
        </div>
      </div>
    </section>
  )
}

function CapabilityChip({
  label,
  detail,
  icon,
  onClick,
  title,
  tone,
  wide = false,
}: {
  label: string
  detail: string
  icon: ReactNode
  onClick: () => void
  title: string
  tone?: 'ready' | 'warning' | 'muted'
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`min-w-0 rounded-[10px] border px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
        wide ? 'col-span-2' : ''
      } ${getChipClassName(tone)}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium leading-tight text-[var(--color-text-primary)]">
            {label}
          </span>
          <span className="block truncate text-[10px] leading-tight text-[var(--color-text-tertiary)]">
            {detail}
          </span>
        </span>
      </span>
    </button>
  )
}

function getParserTone(status: AttachmentParserCapabilityStatus): 'ready' | 'warning' | 'muted' {
  if (status === 'ready') return 'ready'
  if (status === 'needs_config' || status === 'error') return 'warning'
  return 'muted'
}

function getChipClassName(tone?: 'ready' | 'warning' | 'muted') {
  switch (tone) {
    case 'ready':
      return 'border-[var(--color-success)]/25 bg-[var(--color-success)]/8 text-[var(--color-success)]'
    case 'warning':
      return 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 text-[var(--color-warning)]'
    case 'muted':
      return 'border-[var(--color-border)] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]'
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)]'
  }
}
