import { useEffect, type ReactNode } from 'react'
import {
  BriefcaseBusiness,
  UsersRound,
  Workflow,
} from 'lucide-react'
import {
  AGENT_TASK_ROLE_PRESENTATION,
  AGENT_TASK_TEAM_PRESENTATION,
  AGENT_TASK_TEMPLATE_PRESENTATION,
} from '../constants/agentTaskProduct'
import { useTranslation } from '../i18n'
import { useAgentTaskStore } from '../stores/agentTaskStore'

export function AgentTeams() {
  const t = useTranslation()
  const rolePacks = useAgentTaskStore((state) => state.rolePacks)
  const teams = useAgentTaskStore((state) => state.teams)
  const capabilityLoaded = useAgentTaskStore((state) => state.capabilityLoaded)
  const loadCapabilities = useAgentTaskStore((state) => state.loadCapabilities)

  useEffect(() => {
    if (!capabilityLoaded) void loadCapabilities()
  }, [capabilityLoaded, loadCapabilities])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-center border-b border-[var(--color-border)] px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound size={19} strokeWidth={1.2} aria-hidden="true" />
            <h1 className="text-base font-semibold">{t('team.title')}</h1>
          </div>
          <div className="mt-1 flex gap-4 text-xs text-[var(--color-text-tertiary)]">
            <span>{t('team.teamCount', { count: teams.length })}</span>
            <span>{t('team.standardCount', { count: rolePacks.length })}</span>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-5xl space-y-7">
          {teams.length > 0 && (
            <section aria-labelledby="professional-teams-heading">
              <SectionHeading
                icon={<Workflow size={16} strokeWidth={1.2} aria-hidden="true" />}
                id="professional-teams-heading"
              >
                {t('team.professionalTeams')}
              </SectionHeading>
              <div className="grid gap-3 lg:grid-cols-3">
                {teams.map((team) => {
                  const presentation = AGENT_TASK_TEAM_PRESENTATION[team.id]
                  return (
                    <article
                      key={team.id}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold">
                            {presentation
                              ? t(presentation.labelKey)
                              : team.displayName}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                            {presentation
                              ? t(presentation.missionKey)
                              : team.mission}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                          v{team.version}
                        </span>
                      </div>
                      <div className="mt-3 border-t border-[var(--color-border-separator)] pt-3">
                        <div className="text-[10px] font-medium text-[var(--color-text-tertiary)]">
                          {t('team.taskTemplates')}
                        </div>
                        <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-text-secondary)]">
                          {team.taskTemplates.map((template) => {
                            const label =
                              AGENT_TASK_TEMPLATE_PRESENTATION[template.id]
                            return (
                              <li key={template.id} className="truncate">
                                {label ? t(label) : template.displayName}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          <section aria-labelledby="professional-standards-heading">
            <SectionHeading
              icon={<BriefcaseBusiness size={16} strokeWidth={1.2} aria-hidden="true" />}
              id="professional-standards-heading"
            >
              {t('team.professionalStandards')}
            </SectionHeading>
            <p className="mb-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t('team.professionalStandardsDescription')}
            </p>
            <div className="divide-y divide-[var(--color-border-separator)] border-y border-[var(--color-border-separator)]">
              {rolePacks.map((rolePack) => {
                const presentation = AGENT_TASK_ROLE_PRESENTATION[rolePack.id]
                return (
                  <article
                    key={rolePack.id}
                    className="flex min-w-0 items-start justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">
                        {t(presentation.labelKey)}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                        {t(presentation.descriptionKey)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                      v{rolePack.version}
                    </span>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SectionHeading({
  icon,
  id,
  children,
}: {
  icon: ReactNode
  id: string
  children: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon}
      <h2 id={id} className="text-sm font-semibold">{children}</h2>
    </div>
  )
}
