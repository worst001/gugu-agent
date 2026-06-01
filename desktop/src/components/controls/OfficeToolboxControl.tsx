import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Code2, FileText, Files, Mail, MessageCircle, Presentation, Table2, Wrench } from 'lucide-react'
import {
  getOfficeToolOption,
  OFFICE_TOOL_OPTIONS,
  type OfficeToolId,
} from '../../constants/officeTools'
import { useTranslation } from '../../i18n'

type OfficeToolSelection = OfficeToolId | 'normal'

type Props = {
  value: OfficeToolId | null
  onChange: (value: OfficeToolId | null) => void
  disabled?: boolean
}

const OFFICE_TOOL_ICONS: Record<OfficeToolSelection, ComponentType<{ className?: string }>> = {
  normal: MessageCircle,
  'coding-assistant': Code2,
  'document-summary': FileText,
  'spreadsheet-analysis': Table2,
  'ppt-draft': Presentation,
  'mail-draft': Mail,
  'file-assistant': Files,
}

export function OfficeToolboxControl({ value, onChange, disabled = false }: Props) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const selection: OfficeToolSelection = value ?? 'normal'
  const SelectedIcon = OFFICE_TOOL_ICONS[selection]
  const selectedLabel = value
    ? t(getOfficeToolOption(value).shortLabelKey)
    : t('chat.officeTool.trigger')

  const pick = (next: OfficeToolSelection) => {
    onChange(next === 'normal' ? null : next)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        title={t('chat.officeTool.title')}
        aria-label={value ? t('chat.officeTool.selectedAria', { tool: selectedLabel }) : t('chat.officeTool.title')}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 max-w-[128px] items-center gap-1.5 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)]/72 px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-[background-color,border-color] hover:border-[var(--color-brand)]/28 hover:bg-[var(--color-surface-container-lowest)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <SelectedIcon className="h-[14px] w-[14px] shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="truncate text-[var(--color-text-primary)]">{selectedLabel}</span>
        <span aria-hidden="true" className="material-symbols-outlined text-[12px] text-[var(--color-text-tertiary)]">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[360px] overflow-hidden rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]">
          <div className="p-2">
            <ToolboxMenuItem
              value="normal"
              selected={selection === 'normal'}
              label={t('chat.officeTool.normal')}
              description={t('chat.officeTool.normalDescription')}
              onClick={pick}
            />
            <div className="my-1 h-px bg-[var(--color-border-separator)]" />
            {OFFICE_TOOL_OPTIONS.map((tool) => (
              <ToolboxMenuItem
                key={tool.id}
                value={tool.id}
                selected={selection === tool.id}
                label={t(tool.labelKey)}
                description={t(tool.descriptionKey)}
                onClick={pick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ToolboxMenuItem({
  value,
  selected,
  label,
  description,
  onClick,
}: {
  value: OfficeToolSelection
  selected: boolean
  label: string
  description: string
  onClick: (value: OfficeToolSelection) => void
}) {
  const Icon = OFFICE_TOOL_ICONS[value] ?? Wrench

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onClick(value)}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-[var(--color-model-option-selected-bg)]' : 'hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span aria-hidden="true" className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <Icon className={`h-[16px] w-[16px] ${selected ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-[var(--color-text-primary)]">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-[1.35] text-[var(--color-text-tertiary)]">{description}</span>
      </span>
      {selected && (
        <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[15px] text-[var(--color-brand)]">check</span>
      )}
    </button>
  )
}
