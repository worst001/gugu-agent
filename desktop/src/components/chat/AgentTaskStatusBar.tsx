import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  CircleSlash,
  Eye,
  ListChecks,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type {
  AgentTask,
  AgentTaskStatus,
} from '../../types/agentTask'

type StatusConfig = {
  Icon: LucideIcon
  color: string
  labelKey: TranslationKey
}

const STATUS_CONFIG: Record<AgentTaskStatus, StatusConfig> = {
  intake: {
    Icon: CircleDashed,
    color: 'var(--color-text-secondary)',
    labelKey: 'agentTask.status.intake',
  },
  scout: {
    Icon: Search,
    color: 'var(--color-brand)',
    labelKey: 'agentTask.status.scout',
  },
  plan: {
    Icon: ListChecks,
    color: 'var(--color-brand)',
    labelKey: 'agentTask.status.plan',
  },
  execute: {
    Icon: Wrench,
    color: 'var(--color-warning)',
    labelKey: 'agentTask.status.execute',
  },
  verify: {
    Icon: ShieldCheck,
    color: 'var(--color-warning)',
    labelKey: 'agentTask.status.verify',
  },
  review: {
    Icon: Eye,
    color: 'var(--color-brand)',
    labelKey: 'agentTask.status.review',
  },
  blocked: {
    Icon: Pause,
    color: 'var(--color-warning)',
    labelKey: 'agentTask.status.blocked',
  },
  completed: {
    Icon: CheckCircle2,
    color: 'var(--color-success)',
    labelKey: 'agentTask.status.completed',
  },
  failed: {
    Icon: XCircle,
    color: 'var(--color-error)',
    labelKey: 'agentTask.status.failed',
  },
  interrupted: {
    Icon: RotateCcw,
    color: 'var(--color-warning)',
    labelKey: 'agentTask.status.interrupted',
  },
  cancelled: {
    Icon: CircleSlash,
    color: 'var(--color-text-tertiary)',
    labelKey: 'agentTask.status.cancelled',
  },
}

const WORKFLOW_PROGRESS: Partial<Record<AgentTaskStatus, number>> = {
  intake: 0,
  scout: 16,
  plan: 32,
  execute: 50,
  verify: 68,
  review: 84,
  completed: 100,
}

export function AgentTaskStatusBar({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const enabled = useAgentTaskStore((state) => state.enabled)
  const task = useAgentTaskStore((state) => state.currentTask)
  const detail = useAgentTaskStore((state) => state.detail)
  const actionPending = useAgentTaskStore((state) => state.actionPending)
  const beginCurrentTask = useAgentTaskStore(
    (state) => state.beginCurrentTask,
  )
  const resolveCurrentTask = useAgentTaskStore(
    (state) => state.resolveCurrentTask,
  )
  const resumeCurrentTask = useAgentTaskStore(
    (state) => state.resumeCurrentTask,
  )
  const openWorkbench = useWorkbenchStore((state) => state.openWorkbench)
  const [expanded, setExpanded] = useState(false)

  if (!enabled || !task || task.sessionId !== sessionId) return null

  const config = STATUS_CONFIG[task.status]
  const progress =
    WORKFLOW_PROGRESS[task.status] ??
    WORKFLOW_PROGRESS[task.resumeStatus ?? 'intake'] ??
    0
  const evidence = detail?.task.id === task.id
    ? detail.evidencePack
    : undefined

  const action =
    task.status === 'intake'
      ? {
          label: t('agentTask.action.begin'),
          Icon: Play,
          run: beginCurrentTask,
        }
      : task.status === 'blocked'
        ? {
            label: t('agentTask.action.resolve'),
            Icon: Play,
            run: resolveCurrentTask,
          }
        : task.status === 'interrupted'
          ? {
              label: t('agentTask.action.resume'),
              Icon: RotateCcw,
              run: resumeCurrentTask,
            }
          : null

  return (
    <div className="shrink-0 px-8">
      <div className="mx-auto mb-2 max-w-[860px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-lowest)]">
        <div className="flex min-h-10 items-center gap-2 bg-[var(--color-surface-container)] px-3 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-1 py-1 text-left transition-colors hover:bg-[var(--color-surface-container-low)]"
            aria-expanded={expanded}
          >
            <config.Icon
              size={15}
              strokeWidth={1.2}
              style={{ color: config.color }}
              aria-hidden="true"
            />
            <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
              {task.title}
            </span>
            <span
              className="shrink-0 text-[10px] font-medium"
              style={{ color: config.color }}
            >
              {t(config.labelKey)}
            </span>
            <div className="h-1.5 max-w-[180px] flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${progress}%`,
                  backgroundColor: config.color,
                }}
              />
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
              {t('agentTask.attempt', { count: task.attempt })}
            </span>
            {expanded ? (
              <ChevronUp size={14} strokeWidth={1.2} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} strokeWidth={1.2} aria-hidden="true" />
            )}
          </button>

          {action && (
            <button
              type="button"
              onClick={() => { void action.run() }}
              disabled={actionPending}
              className="flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              <action.Icon size={13} strokeWidth={1.2} aria-hidden="true" />
              {action.label}
            </button>
          )}

          {evidence && (
            <button
              type="button"
              onClick={() =>
                openWorkbench(sessionId, { activeTab: 'evidence' })
              }
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
              aria-label={t('agentTask.action.evidence')}
              title={t('agentTask.action.evidence')}
            >
              <PanelRightOpen
                size={15}
                strokeWidth={1.2}
                aria-hidden="true"
              />
            </button>
          )}
        </div>

        {expanded && (
          <ExpandedTask task={task} />
        )}
      </div>
    </div>
  )
}

function ExpandedTask({ task }: { task: AgentTask }) {
  const t = useTranslation()
  const evidence = useAgentTaskStore((state) =>
    state.detail?.task.id === task.id
      ? state.detail.evidencePack
      : undefined,
  )

  return (
    <div className="space-y-2 border-t border-[var(--color-outline-variant)]/20 px-4 py-3">
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        {task.goal}
      </p>
      {task.requiredChecks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
            {t('agentTask.checks')}
          </div>
          {task.requiredChecks.map((check) => {
            const result = evidence?.checks.find(
              (item) => item.checkId === check.id,
            )
            const passed = result?.status === 'passed' && result.exitCode === 0
            return (
              <div
                key={check.id}
                className="flex min-w-0 items-center gap-2 text-[11px]"
              >
                {passed ? (
                  <CheckCircle2
                    size={13}
                    strokeWidth={1.2}
                    className="shrink-0 text-[var(--color-success)]"
                  />
                ) : result ? (
                  <XCircle
                    size={13}
                    strokeWidth={1.2}
                    className="shrink-0 text-[var(--color-error)]"
                  />
                ) : (
                  <CircleDashed
                    size={13}
                    strokeWidth={1.2}
                    className="shrink-0 text-[var(--color-text-tertiary)]"
                  />
                )}
                <span className="truncate text-[var(--color-text-secondary)]">
                  {check.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {task.warnings.length > 0 && (
        <p className="text-[11px] text-[var(--color-warning)]">
          {task.warnings[task.warnings.length - 1]}
        </p>
      )}
    </div>
  )
}