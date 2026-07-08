import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { TerminalSettings } from '../../pages/TerminalSettings'

type Props = {
  open: boolean
}

const MIN_DRAWER_HEIGHT = 220
const MAX_DRAWER_HEIGHT = 720
const CONTENT_HEADROOM = 220

function getMaxDrawerHeight() {
  if (typeof window === 'undefined') return MAX_DRAWER_HEIGHT
  return Math.max(MIN_DRAWER_HEIGHT, Math.min(MAX_DRAWER_HEIGHT, window.innerHeight - CONTENT_HEADROOM))
}

function clampDrawerHeight(height: number) {
  return Math.min(getMaxDrawerHeight(), Math.max(MIN_DRAWER_HEIGHT, Math.round(height)))
}

function getDefaultDrawerHeight() {
  if (typeof window === 'undefined') return 320
  return clampDrawerHeight(window.innerHeight * 0.42)
}

export function TerminalDrawer({ open }: Props) {
  const t = useTranslation()
  const setTerminalDrawerOpen = useUIStore((state) => state.setTerminalDrawerOpen)
  const [height, setHeight] = useState(getDefaultDrawerHeight)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    const handleWindowResize = () => setHeight((current) => clampDrawerHeight(current))
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const startHeight = height
    setIsResizing(true)

    const handleMove = (moveEvent: MouseEvent) => {
      setHeight(clampDrawerHeight(startHeight + startY - moveEvent.clientY))
    }
    const handleUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  return (
    <section
      data-testid="terminal-drawer"
      data-open={open ? 'true' : 'false'}
      data-resizing={isResizing ? 'true' : 'false'}
      aria-hidden={!open}
      className={`relative shrink-0 overflow-hidden bg-[var(--color-terminal-bg)] ${
        isResizing ? 'transition-none' : 'transition-[height,opacity] duration-200 ease-out'
      } ${
        open
          ? 'flex min-h-[220px] flex-col border-t border-[var(--color-terminal-border)] opacity-100 shadow-[0_-18px_44px_rgba(0,0,0,0.18)]'
          : 'pointer-events-none h-0 min-h-0 border-t-0 opacity-0'
      }`}
      style={open ? { height } : undefined}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        title="Drag to resize terminal panel."
        onMouseDown={startResize}
        className="absolute left-0 right-0 top-0 z-10 h-2 -translate-y-1/2 cursor-row-resize touch-none bg-transparent transition-colors hover:bg-[var(--color-border-focus)]/20"
      />
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-3 text-[var(--color-terminal-fg)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            terminal
          </span>
          <span className="truncate font-mono text-[12px] font-semibold">
            {t('settings.terminal.windowTitle')}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('tabs.close')}
          title={t('tabs.close')}
          onClick={() => setTerminalDrawerOpen(false)}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-terminal-muted)] transition-colors hover:bg-white/10 hover:text-[var(--color-terminal-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            close
          </span>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalSettings active={open} compact testId="terminal-drawer-host" />
      </div>
    </section>
  )
}
