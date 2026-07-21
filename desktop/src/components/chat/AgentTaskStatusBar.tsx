import { useState } from 'react'
import {
  BookOpenText,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  CircleSlash,
  Clapperboard,
  ClipboardCheck,
  Code2,
  Eye,
  FileOutput,
  ListChecks,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  UsersRound,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import {
  AGENT_TASK_ROLE_PRESENTATION,
  AGENT_TASK_TEAM_PRESENTATION,
  AGENT_TASK_TEMPLATE_PRESENTATION,
  buildAgentTaskReviewRequest,
} from '../../constants/agentTaskProduct'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useChatStore } from '../../stores/chatStore'
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


const KNOWLEDGE_WORKER_STATUS_KEYS: Partial<
  Record<AgentTaskStatus, TranslationKey>
> = {
  intake: 'agentTask.knowledgeStatus.intake',
  scout: 'agentTask.knowledgeStatus.scout',
  plan: 'agentTask.knowledgeStatus.plan',
  execute: 'agentTask.knowledgeStatus.execute',
  verify: 'agentTask.knowledgeStatus.verify',
  review: 'agentTask.knowledgeStatus.review',
}


type WorkflowStageStatus = Extract<
  AgentTaskStatus,
  'intake' | 'scout' | 'plan' | 'execute' | 'verify' | 'review'
>

const WORKFLOW_STAGE_CONFIG: ReadonlyArray<{
  status: WorkflowStageStatus
  labelKey: TranslationKey
}> = [
  { status: 'intake', labelKey: 'agentTask.workflow.intake' },
  { status: 'scout', labelKey: 'agentTask.workflow.scout' },
  { status: 'plan', labelKey: 'agentTask.workflow.plan' },
  { status: 'execute', labelKey: 'agentTask.workflow.execute' },
  { status: 'verify', labelKey: 'agentTask.workflow.verify' },
  { status: 'review', labelKey: 'agentTask.workflow.review' },
]

function isWorkflowStageStatus(
  status: AgentTaskStatus | undefined,
): status is WorkflowStageStatus {
  return Boolean(
    status &&
    WORKFLOW_STAGE_CONFIG.some((stage) => stage.status === status),
  )
}

function getActiveWorkflowStage(task: AgentTask): WorkflowStageStatus | null {
  if (isWorkflowStageStatus(task.status)) return task.status
  if (
    (task.status === 'blocked' || task.status === 'interrupted') &&
    isWorkflowStageStatus(task.resumeStatus)
  ) {
    return task.resumeStatus
  }
  return null
}


export function AgentTaskStatusBar({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const enabled = useAgentTaskStore((state) => state.enabled)
  const task = useAgentTaskStore((state) => state.currentTask)
  const tasks = useAgentTaskStore((state) => state.tasks)
  const teams = useAgentTaskStore((state) => state.teams)
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
  const sendMessage = useChatStore((state) => state.sendMessage)
  const chatState = useChatStore(
    (state) => state.sessions[sessionId]?.chatState,
  )
  const [expanded, setExpanded] = useState(false)

  if (!enabled || !task || task.sessionId !== sessionId) return null

  const config = STATUS_CONFIG[task.status]
  const isArtifactRole = task.role !== 'software_engineer'
  const StatusIcon =
    isArtifactRole && task.status === 'execute'
      ? FileOutput
      : config.Icon
  const RoleIcon = task.role === 'short_video_operator'
    ? Clapperboard
    : task.role === 'knowledge_worker'
      ? BookOpenText
      : Code2
  const roleLabel =
    task.assistantName ??
    t(AGENT_TASK_ROLE_PRESENTATION[task.role].labelKey)
  const statusLabelKey = isArtifactRole
    ? KNOWLEDGE_WORKER_STATUS_KEYS[task.status] ?? config.labelKey
    : config.labelKey

  const evidence = detail?.task.id === task.id
    ? detail.evidencePack
    : undefined

  const chatBusy =
    chatState === 'thinking' ||
    chatState === 'tool_executing' ||
    chatState === 'permission_pending' ||
    chatState === 'stopping'
  const canRequestReview =
    task.status === 'completed' && task.relation !== 'review'
  const teamRef = task.definitionSnapshot?.team
  const taskTeam = teamRef
    ? teams.find((team) =>
        team.id === teamRef.id && team.version === teamRef.version
      )
    : undefined
  const teamPresentation = taskTeam
    ? AGENT_TASK_TEAM_PRESENTATION[taskTeam.id]
    : undefined
  const teamLabel = taskTeam
    ? teamPresentation
      ? t(teamPresentation.labelKey)
      : taskTeam.displayName
    : ''
  const reviewTemplate = taskTeam?.taskTemplates.find(
    (template) =>
      template.kind === 'independent_review' &&
      template.primaryRole === task.role,
  )
  const reviewTaskCount = tasks.filter(
    (candidate) =>
      candidate.parentTaskId === task.id &&
      candidate.relation === 'review',
  ).length

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
            <RoleIcon
              size={16}
              strokeWidth={1.2}
              className="shrink-0 text-[var(--color-brand)]"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                  {t('agentTask.ownerSummary', { owner: roleLabel })}
                </span>
                <span
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                >
                  ·
                </span>
                <span
                  className="flex shrink-0 items-center gap-1 text-[10px] font-medium"
                  style={{ color: config.color }}
                >
                  <StatusIcon
                    size={12}
                    strokeWidth={1.2}
                    aria-hidden="true"
                  />
                  {t(statusLabelKey)}
                </span>
              </div>
              <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                {teamLabel ? teamLabel + ' / ' + task.title : task.title}
              </div>
            </div>
            {reviewTaskCount > 0 && (
              <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                {t('agentTask.team.collaboratorCount', {
                  count: reviewTaskCount,
                })}
              </span>
            )}
            {task.attempt > 1 && (
              <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                {t('agentTask.attempt', { count: task.attempt })}
              </span>
            )}
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

          {canRequestReview && (
            <button
              type="button"
              onClick={() => sendMessage(
                sessionId,
                buildAgentTaskReviewRequest(
                  task,
                  taskTeam && reviewTemplate
                    ? {
                        teamId: taskTeam.id,
                        taskTemplateId: reviewTemplate.id,
                      }
                    : undefined,
                ),
                undefined,
                {
                  displayContent: t('agentTask.review.display', {
                    title: task.title,
                  }),
                },
              )}
              disabled={chatBusy}
              className="flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              <ClipboardCheck size={13} strokeWidth={1.2} aria-hidden="true" />
              {t('agentTask.action.professionalReview')}
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
          <ExpandedTask task={task} sessionId={sessionId} />
        )}
      </div>
    </div>
  )
}

function getRootTask(task: AgentTask, tasks: AgentTask[]): AgentTask {
  if (task.relation !== 'review' || !task.parentTaskId) return task
  return tasks.find((candidate) => candidate.id === task.parentTaskId) ?? task
}

function TaskWorkflowSection({ task }: { task: AgentTask }) {
  const t = useTranslation()
  const activeStage = getActiveWorkflowStage(task)
  const activeIndex = WORKFLOW_STAGE_CONFIG.findIndex(
    (stage) => stage.status === activeStage,
  )
  const completed = task.status === 'completed'
  const paused = task.status === 'blocked' || task.status === 'interrupted'
  const currentStageNumber = completed
    ? WORKFLOW_STAGE_CONFIG.length
    : activeIndex >= 0
      ? activeIndex + 1
      : null

  return (
    <section>
      <div className="flex items-center gap-2">
        <ListChecks
          size={14}
          strokeWidth={1.2}
          className="text-[var(--color-brand)]"
          aria-hidden="true"
        />
        <h3 className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('agentTask.workflow.title')}
        </h3>
        {currentStageNumber !== null && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {t('agentTask.workflow.stageCount', {
              current: currentStageNumber,
              total: WORKFLOW_STAGE_CONFIG.length,
            })}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {WORKFLOW_STAGE_CONFIG.map((stage, index) => {
          const isComplete = completed || (activeIndex >= 0 && index < activeIndex)
          const isCurrent = !completed && index === activeIndex
          const StageIcon = isComplete
            ? CheckCircle2
            : isCurrent && paused
              ? Pause
              : CircleDashed
          const stateLabel = isComplete
            ? t('agentTask.workflow.completed')
            : isCurrent && paused
              ? t('agentTask.workflow.paused')
              : isCurrent
                ? t('agentTask.workflow.current')
                : t('agentTask.workflow.pending')
          return (
            <div
              key={stage.status}
              className="flex min-w-0 items-center gap-1.5 py-1"
            >
              <StageIcon
                size={13}
                strokeWidth={1.2}
                className={isComplete
                  ? 'shrink-0 text-[var(--color-success)]'
                  : isCurrent
                    ? 'shrink-0 text-[var(--color-brand)]'
                    : 'shrink-0 text-[var(--color-text-tertiary)]'}
                aria-hidden="true"
              />
              <span className={isCurrent
                ? 'truncate text-[11px] font-semibold text-[var(--color-text-primary)]'
                : 'truncate text-[11px] text-[var(--color-text-secondary)]'}
              >
                {t(stage.labelKey)}
              </span>
              <span className="sr-only">{stateLabel}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TaskSettingsSection({ task }: { task: AgentTask }) {
  const t = useTranslation()
  const tasks = useAgentTaskStore((state) => state.tasks)
  const teams = useAgentTaskStore((state) => state.teams)
  const rootTask = getRootTask(task, tasks)
  const snapshot = rootTask.definitionSnapshot
  if (!snapshot) return null

  const teamRef = snapshot.team
  const taskTeam = teamRef
    ? teams.find((team) =>
        team.id === teamRef.id && team.version === teamRef.version
      )
    : undefined
  const teamPresentation = taskTeam
    ? AGENT_TASK_TEAM_PRESENTATION[taskTeam.id]
    : undefined
  const templateRef = snapshot.taskTemplate
  const taskTemplate = taskTeam && templateRef
    ? taskTeam.taskTemplates.find((template) =>
        template.id === templateRef.id &&
        template.version === templateRef.version
      )
    : undefined
  const templatePresentation = taskTemplate
    ? AGENT_TASK_TEMPLATE_PRESENTATION[taskTemplate.id]
    : undefined
  const teamName = taskTeam
    ? teamPresentation
      ? t(teamPresentation.labelKey)
      : taskTeam.displayName
    : teamRef?.id
  const templateName = taskTemplate
    ? templatePresentation
      ? t(templatePresentation)
      : taskTemplate.displayName
    : templateRef?.id
  const ownerName = rootTask.assistantName ??
    t(AGENT_TASK_ROLE_PRESENTATION[rootTask.role].labelKey)
  const workflowName = snapshot.workflow.id === 'verified_delivery'
    ? t('agentTask.settings.verifiedDelivery')
    : snapshot.workflow.id
  const rows = [
    teamName ? [t('agentTask.settings.team'), teamName] : null,
    templateName ? [t('agentTask.settings.task'), templateName] : null,
    [
      t('agentTask.settings.workflow'),
      workflowName + ' v' + snapshot.workflow.version,
    ],
    [t('agentTask.settings.owner'), ownerName],
  ].filter((row): row is string[] => Boolean(row))

  return (
    <section>
      <div className="flex items-center gap-2">
        <BriefcaseBusiness
          size={14}
          strokeWidth={1.2}
          className="text-[var(--color-brand)]"
          aria-hidden="true"
        />
        <h3 className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('agentTask.settings.title')}
        </h3>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-2 text-[11px]">
            <dt className="shrink-0 text-[var(--color-text-tertiary)]">
              {label}
            </dt>
            <dd className="truncate text-[var(--color-text-secondary)]" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function ActualCollaborationSection({ task }: { task: AgentTask }) {
  const t = useTranslation()
  const tasks = useAgentTaskStore((state) => state.tasks)
  const rootTask = getRootTask(task, tasks)
  // Only persisted child tasks count as collaboration.
  const collaborators = tasks.filter(
    (candidate) =>
      candidate.parentTaskId === rootTask.id &&
      candidate.relation === 'review',
  )
  if (collaborators.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-2">
        <UsersRound
          size={14}
          strokeWidth={1.2}
          className="text-[var(--color-brand)]"
          aria-hidden="true"
        />
        <h3 className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('agentTask.collaboration.title')}
        </h3>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {t('agentTask.collaboration.count', {
            count: collaborators.length,
          })}
        </span>
      </div>
      <div className="mt-2 divide-y divide-[var(--color-border-separator)] border-y border-[var(--color-border-separator)]">
        {collaborators.map((member) => {
          const MemberIcon = member.role === 'short_video_operator'
            ? Clapperboard
            : member.role === 'knowledge_worker'
              ? BookOpenText
              : Code2
          const memberRoleLabel = member.assistantName ??
            t(AGENT_TASK_ROLE_PRESENTATION[member.role].labelKey)
          const memberStatus = STATUS_CONFIG[member.status]
          return (
            <div key={member.id} className="flex min-w-0 gap-2 py-2.5">
              <MemberIcon
                size={14}
                strokeWidth={1.2}
                className="mt-0.5 shrink-0 text-[var(--color-brand)]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {memberRoleLabel}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {t('agentTask.team.reviewer')}
                  </span>
                  <span
                    className="flex items-center gap-1 text-[10px] font-medium"
                    style={{ color: memberStatus.color }}
                  >
                    <memberStatus.Icon
                      size={11}
                      strokeWidth={1.2}
                      aria-hidden="true"
                    />
                    {t(memberStatus.labelKey)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-secondary)]">
                  {member.title}
                </p>
                <time
                  dateTime={member.updatedAt}
                  className="mt-1 block text-[10px] text-[var(--color-text-tertiary)]"
                >
                  {t('agentTask.team.updatedAt', {
                    time: new Date(member.updatedAt).toLocaleString(),
                  })}
                </time>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TaskResourcesSection({
  task,
  sessionId,
}: {
  task: AgentTask
  sessionId: string
}) {
  const t = useTranslation()
  const detail = useAgentTaskStore((state) => state.detail)
  const openWorkbench = useWorkbenchStore((state) => state.openWorkbench)
  const currentDetail = detail?.task.id === task.id ? detail : undefined
  const sourceCount = currentDetail?.provenancePack?.sources.length ?? 0
  const artifactCount = currentDetail?.evidencePack?.artifacts.length ?? 0

  return (
    <section className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] text-[var(--color-text-tertiary)]">
        {t('agentTask.team.resources', {
          sources: sourceCount,
          artifacts: artifactCount,
        })}
      </span>
      <button
        type="button"
        onClick={() => openWorkbench(sessionId, { activeTab: 'evidence' })}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
      >
        <PanelRightOpen size={12} strokeWidth={1.2} aria-hidden="true" />
        {t('agentTask.team.openEvidence')}
      </button>
    </section>
  )
}

function ExpandedTask({
  task,
  sessionId,
}: {
  task: AgentTask
  sessionId: string
}) {
  const t = useTranslation()
  const evidence = useAgentTaskStore((state) =>
    state.detail?.task.id === task.id
      ? state.detail.evidencePack
      : undefined,
  )
  const rolePack = useAgentTaskStore((state) =>
    state.rolePacks.find((item) => item.id === task.role),
  )
  const roleCapability =
    rolePack?.mission ??
    t(AGENT_TASK_ROLE_PRESENTATION[task.role].descriptionKey)

  return (
    <div className="space-y-3 border-t border-[var(--color-outline-variant)]/20 px-4 py-3">
      <TaskWorkflowSection task={task} />
      <TaskSettingsSection task={task} />
      <ActualCollaborationSection task={task} />
      <TaskResourcesSection task={task} sessionId={sessionId} />

      {task.relation === 'review' && task.parentTaskId && (
        <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('agentTask.review.relation')}
        </div>
      )}

      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('agentTask.roleCapability')}
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          {roleCapability}
        </p>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('agentTask.taskResponsibility')}
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          {task.goal}
        </p>
      </div>

      {rolePack && rolePack.responsibilities.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
            {t('agentTask.roleResponsibilities')}
          </div>
          <ul className="mt-1 space-y-1">
            {rolePack.responsibilities.map((responsibility) => (
              <li
                key={responsibility}
                className="flex gap-2 text-[11px] leading-4 text-[var(--color-text-secondary)]"
              >
                <span
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                />
                <span>{responsibility}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
