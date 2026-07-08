import { useEffect, useMemo, useRef, useState } from 'react'
import { OFFICIAL_MODELS } from '../../constants/modelCatalog'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import type { EffortLevel, ModelInfo } from '../../types/settings'

type Props = {
  value?: string
  onChange?: (modelId: string) => void
  disabled?: boolean
  compact?: boolean
}

const HIDDEN_BUILT_IN_MODEL_IDS = new Set(OFFICIAL_MODELS.map((model) => model.id))

function isHiddenBuiltInModelId(modelId: string | undefined): boolean {
  return Boolean(modelId && HIDDEN_BUILT_IN_MODEL_IDS.has(modelId))
}

function visibleDefaultModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((model) => !HIDDEN_BUILT_IN_MODEL_IDS.has(model.id))
}

function resolveSelectedModel(
  availableModels: ModelInfo[],
  modelId: string | undefined,
  fallback: ModelInfo | null,
): ModelInfo | null {
  const models = visibleDefaultModels(availableModels)
  const selected = models.find((model) => model.id === modelId)
  if (selected) return selected
  return fallback && !isHiddenBuiltInModelId(fallback.id) ? fallback : null
}

export function ModelSelector({
  value,
  onChange,
  disabled = false,
  compact = false,
}: Props = {}) {
  const t = useTranslation()
  const {
    currentModel: storeModel,
    availableModels,
    effortLevel,
    setModel,
    setEffort,
  } = useSettingsStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]
  const selectedEffortLabel =
    EFFORT_OPTIONS.find((option) => option.value === effortLevel)?.label ?? t('settings.general.effort.medium')

  const isControlled = value !== undefined

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const availableModelChoices = useMemo(() => visibleDefaultModels(availableModels), [availableModels])

  const selectedModel = isControlled
    ? resolveSelectedModel(availableModels, value, null)
    : resolveSelectedModel(availableModels, storeModel?.id, storeModel)
  const buttonModelLabel = selectedModel?.name ?? t('model.selectModel')

  const handleEffortSelect = (level: EffortLevel) => {
    void setEffort(level)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-full text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${
          compact
            ? 'max-w-[170px] bg-transparent px-2 py-1'
            : 'max-w-[280px] bg-[var(--color-surface-container-low)] px-3 py-1.5'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={`${compact ? 'text-xs' : 'text-sm'} min-w-0 flex-1 truncate font-semibold text-[var(--color-text-primary)]`}>
            {buttonModelLabel}
          </span>
          {compact && (
            <span className="shrink-0 text-xs font-semibold text-[var(--color-text-secondary)]">
              {selectedEffortLabel}
            </span>
          )}
        </div>
        <span className="material-symbols-outlined flex-shrink-0 text-[12px]">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[360px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]">
          <div className="max-h-[420px] overflow-y-auto p-3">
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
              {t('model.configuration')}
            </div>

            <div className="space-y-1">
              {availableModelChoices.map((model) => {
                const isSelected = model.id === selectedModel?.id
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      if (isControlled) {
                        onChange?.(model.id)
                      } else {
                        void setModel(model.id)
                      }
                      setOpen(false)
                    }}
                    className={`
                      w-full rounded-lg px-3 py-2.5 text-left transition-colors
                      ${isSelected
                        ? 'border border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                      }
                    `}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-outline)]'
                      }`}>
                        {isSelected && (
                          <div className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{model.name}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {!isControlled && (
            <div className="border-t border-[var(--color-border)] p-3">
              <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
                {t('model.effort')}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {EFFORT_OPTIONS.map((opt) => {
                  const isSelected = opt.value === effortLevel
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleEffortSelect(opt.value)}
                      className={`
                        rounded-lg py-2 text-center text-xs font-semibold transition-colors
                        ${isSelected
                          ? 'bg-[var(--color-brand)] text-white'
                          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
