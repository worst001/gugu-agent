import { useEffect, useRef, useState } from 'react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import type { EffortLevel } from '../../types/settings'

const EFFORT_OPTIONS: Array<{ value: EffortLevel; labelKey: TranslationKey; icon: string }> = [
  { value: 'low', labelKey: 'settings.general.effort.low', icon: 'eco' },
  { value: 'medium', labelKey: 'settings.general.effort.medium', icon: 'speed' },
  { value: 'high', labelKey: 'settings.general.effort.high', icon: 'bolt' },
  { value: 'max', labelKey: 'settings.general.effort.max', icon: 'rocket_launch' },
]

type Props = {
  disabled?: boolean
}

export function EffortSelector({ disabled = false }: Props) {
  const t = useTranslation()
  const effortLevel = useSettingsStore((s) => s.effortLevel)
  const setEffort = useSettingsStore((s) => s.setEffort)
  const setSessionEffort = useChatStore((s) => s.setSessionEffort)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = EFFORT_OPTIONS.find((option) => option.value === effortLevel) ?? EFFORT_OPTIONS[1]!

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const pick = (level: EffortLevel) => {
    setOpen(false)
    if (level === effortLevel) return
    void setEffort(level).then(() => {
      if (activeTabId) setSessionEffort(activeTabId, level)
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t('model.effort')}
        onClick={() => !disabled && setOpen((value) => !value)}
        disabled={disabled}
        className="flex max-w-[152px] items-center gap-1.5 rounded-full bg-[var(--color-surface-container-low)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] ring-1 ring-[var(--color-brand)]/10 transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined flex-shrink-0 text-[14px]">psychology</span>
        <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {t(selected.labelKey)}
        </span>
        <span className="material-symbols-outlined flex-shrink-0 text-[12px]">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[220px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-2 shadow-[var(--shadow-dropdown)]">
          <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
            {t('model.effort')}
          </div>
          {EFFORT_OPTIONS.map((option) => {
            const isSelected = option.value === effortLevel
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => pick(option.value)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
                  isSelected ? 'bg-[var(--color-surface-selected)]' : ''
                }`}
              >
                <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">
                  {option.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {t(option.labelKey)}
                </span>
                {isSelected && (
                  <span
                    className="material-symbols-outlined text-[16px] text-[var(--color-brand)]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    check_circle
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
