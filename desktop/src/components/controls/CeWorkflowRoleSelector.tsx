import { useEffect, useMemo, useRef, useState } from 'react'
import { CE_WORKFLOW_ROLES, CE_WORKFLOW_DEFAULT_ROLE_ID, type CeWorkflowRole } from '../../constants/ceWorkflowRoles'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useCeWorkflowRoleStore } from '../../stores/ceWorkflowRoleStore'

type RoleI18n = { label: TranslationKey; tag: TranslationKey; description: TranslationKey }

const ROLE_I18N: Record<string, RoleI18n> = {
  quick: {
    label: 'ceWorkflow.role.quick.label',
    tag: 'ceWorkflow.role.quick.tag',
    description: 'ceWorkflow.role.quick.description',
  },
  standard: {
    label: 'ceWorkflow.role.standard.label',
    tag: 'ceWorkflow.role.standard.tag',
    description: 'ceWorkflow.role.standard.description',
  },
  deep: {
    label: 'ceWorkflow.role.deep.label',
    tag: 'ceWorkflow.role.deep.tag',
    description: 'ceWorkflow.role.deep.description',
  },
  compound_delivery: {
    label: 'ceWorkflow.role.compound_delivery.label',
    tag: 'ceWorkflow.role.compound_delivery.tag',
    description: 'ceWorkflow.role.compound_delivery.description',
  },
  architecture: {
    label: 'ceWorkflow.role.architecture.label',
    tag: 'ceWorkflow.role.architecture.tag',
    description: 'ceWorkflow.role.architecture.description',
  },
  ship: {
    label: 'ceWorkflow.role.ship.label',
    tag: 'ceWorkflow.role.ship.tag',
    description: 'ceWorkflow.role.ship.description',
  },
  doc: {
    label: 'ceWorkflow.role.doc.label',
    tag: 'ceWorkflow.role.doc.tag',
    description: 'ceWorkflow.role.doc.description',
  },
  hands_off: {
    label: 'ceWorkflow.role.hands_off.label',
    tag: 'ceWorkflow.role.hands_off.tag',
    description: 'ceWorkflow.role.hands_off.description',
  },
}

type Props = {
  sessionKey: string
  disabled?: boolean
}

export function CeWorkflowRoleSelector({ sessionKey, disabled = false }: Props) {
  const t = useTranslation()
  const selections = useCeWorkflowRoleStore((s) => s.selections)
  const setRole = useCeWorkflowRoleStore((s) => s.setRole)

  const selectedId = selections[sessionKey] ?? CE_WORKFLOW_DEFAULT_ROLE_ID
  const selectedRole = useMemo(
    () => CE_WORKFLOW_ROLES.find((r) => r.id === selectedId) ?? CE_WORKFLOW_ROLES.find((r) => r.id === CE_WORKFLOW_DEFAULT_ROLE_ID)!,
    [selectedId],
  )

  const i18n = ROLE_I18N[selectedRole.id] ?? ROLE_I18N[CE_WORKFLOW_DEFAULT_ROLE_ID]!
  const buttonMain = t(i18n.label)
  const buttonSub = t(i18n.tag)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const pick = (role: CeWorkflowRole) => {
    setRole(sessionKey, role.id)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex max-w-[280px] items-center gap-2 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)]/72 px-3.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] shadow-[0_1px_0_rgba(255,255,255,0.55)] transition-[background-color,border-color,box-shadow] hover:border-[var(--color-brand)]/28 hover:bg-[var(--color-surface-container-lowest)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {buttonMain}
          </span>
          <span className="max-w-[108px] flex-shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
            {buttonSub}
          </span>
        </div>
        <span className="material-symbols-outlined flex-shrink-0 text-[12px]">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[372px] overflow-hidden rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]">
          <div className="max-h-[420px] overflow-y-auto p-3.5">
            <div className="mb-2 px-1 text-[10px] font-bold text-[var(--color-outline)]">
              {t('ceWorkflow.panelTitle')}
            </div>

            <div className="space-y-1.5">
              {CE_WORKFLOW_ROLES.map((role) => {
                const keys = ROLE_I18N[role.id]
                if (!keys) return null
                const isSelected = role.id === selectedRole.id
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => pick(role)}
                    className={`
                      w-full rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow]
                      ${isSelected
                        ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
                        : 'border-transparent hover:bg-[var(--color-surface-hover)]'
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-outline)]/72'
                      }`}>
                        {isSelected && (
                          <div className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {t(keys.label)}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] font-medium text-[var(--color-text-tertiary)]">
                          {t(keys.tag)}
                        </div>
                        <div className="mt-1 text-[10px] leading-[1.45] text-[var(--color-text-secondary)]">
                          {t(keys.description)}
                        </div>
                        <div className="mt-1.5 truncate font-mono text-[9px] text-[var(--color-text-tertiary)]">
                          {role.skills.join(' · ')}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
