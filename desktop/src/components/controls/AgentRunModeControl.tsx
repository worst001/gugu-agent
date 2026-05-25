import { useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_RUN_MODE_DEFAULT, type AgentRunMode } from '../../constants/agentRunModes'
import { CE_WORKFLOW_DEFAULT_ROLE_ID, CE_WORKFLOW_ROLES, type CeWorkflowRole } from '../../constants/ceWorkflowRoles'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useAgentRunModeStore } from '../../stores/agentRunModeStore'
import { useCeWorkflowRoleStore } from '../../stores/ceWorkflowRoleStore'

type ModeMeta = {
  value: AgentRunMode
  label: TranslationKey
  description: TranslationKey
  title: TranslationKey
  icon?: string
}

type RoleI18n = { label: TranslationKey; tag: TranslationKey; description: TranslationKey }

const MODES: ModeMeta[] = [
  {
    value: 'normal',
    label: 'agentMode.normal',
    description: 'agentMode.normalDescription',
    title: 'agentMode.normalTitle',
  },
  {
    value: 'plan',
    label: 'agentMode.plan',
    description: 'agentMode.planDescription',
    title: 'agentMode.planTitle',
    icon: 'architecture',
  },
  {
    value: 'ce',
    label: 'agentMode.ce',
    description: 'agentMode.ceDescription',
    title: 'agentMode.ceTitle',
    icon: 'account_tree',
  },
]

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

export function AgentRunModeControl({ sessionKey, disabled = false }: Props) {
  const t = useTranslation()
  const modeSelections = useAgentRunModeStore((s) => s.selections)
  const setMode = useAgentRunModeStore((s) => s.setMode)
  const roleSelections = useCeWorkflowRoleStore((s) => s.selections)
  const setRole = useCeWorkflowRoleStore((s) => s.setRole)

  const selectedMode = modeSelections[sessionKey] ?? AGENT_RUN_MODE_DEFAULT
  const selectedRoleId = roleSelections[sessionKey] ?? CE_WORKFLOW_DEFAULT_ROLE_ID
  const selectedModeMeta = MODES.find((mode) => mode.value === selectedMode) ?? MODES[0]!
  const selectedRole = useMemo(
    () => CE_WORKFLOW_ROLES.find((role) => role.id === selectedRoleId) ?? CE_WORKFLOW_ROLES.find((role) => role.id === CE_WORKFLOW_DEFAULT_ROLE_ID)!,
    [selectedRoleId],
  )
  const selectedRoleI18n = ROLE_I18N[selectedRole.id] ?? ROLE_I18N[CE_WORKFLOW_DEFAULT_ROLE_ID]!

  const [openMenu, setOpenMenu] = useState<'mode' | 'workflow' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpenMenu(null)
    }
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [openMenu])

  const pickMode = (mode: AgentRunMode) => {
    setMode(sessionKey, mode)
    setOpenMenu(null)
  }

  const pickRole = (role: CeWorkflowRole) => {
    setRole(sessionKey, role.id)
    setOpenMenu(null)
  }

  return (
    <div ref={ref} className="relative">
      <div
        className="flex h-8 items-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)]/72 text-xs font-semibold text-[var(--color-text-secondary)] transition-[background-color,border-color] hover:border-[var(--color-brand)]/28 hover:bg-[var(--color-surface-container-lowest)]"
        role="group"
        aria-label={t('agentMode.groupLabel')}
      >
        <button
          type="button"
          disabled={disabled}
          title={t(selectedModeMeta.title)}
          aria-expanded={openMenu === 'mode'}
          onClick={() => setOpenMenu(openMenu === 'mode' ? null : 'mode')}
          className="flex h-full items-center gap-1.5 rounded-full px-3 transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedModeMeta.icon && (
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
              {selectedModeMeta.icon}
            </span>
          )}
          <span className="text-[var(--color-text-primary)]">{t(selectedModeMeta.label)}</span>
          {selectedMode !== 'ce' && (
            <span aria-hidden="true" className="material-symbols-outlined text-[12px] text-[var(--color-text-tertiary)]">expand_more</span>
          )}
        </button>

        {selectedMode === 'ce' && (
          <>
            <div className="h-4 w-px bg-[var(--color-border)]/80" />
            <button
              type="button"
              disabled={disabled}
              title={t('ceWorkflow.panelTitle')}
              aria-expanded={openMenu === 'workflow'}
              onClick={() => setOpenMenu(openMenu === 'workflow' ? null : 'workflow')}
              className="flex h-full max-w-[160px] items-center gap-1.5 rounded-full px-2.5 transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate text-[var(--color-text-primary)]">{t(selectedRoleI18n.label)}</span>
              <span aria-hidden="true" className="material-symbols-outlined text-[12px] text-[var(--color-text-tertiary)]">expand_more</span>
            </button>
          </>
        )}
      </div>

      {openMenu === 'mode' && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[264px] overflow-hidden rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)]">
          <div className="p-2">
            {MODES.map((mode) => {
              const isSelected = mode.value === selectedMode
              return (
                <button
                  key={mode.value}
                  type="button"
                  aria-label={t(mode.label)}
                  onClick={() => pickMode(mode.value)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    isSelected ? 'bg-[var(--color-model-option-selected-bg)]' : 'hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span aria-hidden="true" className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">
                    {mode.icon && (
                      <span className={`material-symbols-outlined text-[18px] ${
                        isSelected ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'
                      }`}>
                        {mode.icon}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--color-text-primary)]">
                      {t(mode.label)}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-[1.35] text-[var(--color-text-tertiary)]">
                      {t(mode.description)}
                    </span>
                  </span>
                  {isSelected && (
                    <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[15px] text-[var(--color-brand)]">check</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {openMenu === 'workflow' && selectedMode === 'ce' && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[372px] overflow-hidden rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)]">
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
                    aria-label={t(keys.label)}
                    onClick={() => pickRole(role)}
                    className={`w-full rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color] ${
                      isSelected
                        ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                        : 'border-transparent hover:bg-[var(--color-surface-hover)]'
                    }`}
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
                          {role.skills.join(' / ')}
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
