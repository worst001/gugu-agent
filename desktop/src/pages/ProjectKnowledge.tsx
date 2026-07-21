import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BookOpenText,
  ExternalLink,
  FileOutput,
  FolderKanban,
  ListTree,
  Network,
  RefreshCw,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { agentTasksApi } from '../api/agentTasks'
import { AGENT_TASK_ROLE_PRESENTATION } from '../constants/agentTaskProduct'
import { parseProjectKnowledgeTabId } from '../constants/projectKnowledge'
import { useTranslation } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import type {
  WorkspaceKnowledgeMap,
  WorkspaceKnowledgeSource,
  WorkspaceKnowledgeTask,
} from '../types/agentTask'

type KnowledgeView = 'overview' | 'relations'

const SOURCE_LABEL_KEYS = {
  file: 'projectKnowledge.source.file',
  attachment: 'projectKnowledge.source.attachment',
  message: 'projectKnowledge.source.message',
  tool_result: 'projectKnowledge.source.tool_result',
  url: 'projectKnowledge.source.url',
} as const

function sourceLocation(source: WorkspaceKnowledgeSource): string {
  switch (source.locator.kind) {
    case 'file':
      return source.locator.path
    case 'url':
      return source.locator.url
    case 'attachment':
      return source.locator.path ?? source.title
    case 'message':
      return source.title
    case 'tool_result':
      return source.title
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ProjectKnowledge() {
  const t = useTranslation()
  const activeTabId = useTabStore((state) => state.activeTabId)
  const workspacePath = activeTabId
    ? parseProjectKnowledgeTabId(activeTabId)
    : null
  const [knowledgeMap, setKnowledgeMap] = useState<WorkspaceKnowledgeMap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<KnowledgeView>('overview')
  const [query, setQuery] = useState('')
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    if (!workspacePath) return
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    try {
      const result = await agentTasksApi.workspaceKnowledge(workspacePath)
      if (sequence === requestSequence.current) {
        setKnowledgeMap(result.knowledgeMap)
      }
    } catch (requestError) {
      if (sequence === requestSequence.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t('projectKnowledge.loadFailed'),
        )
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [t, workspacePath])

  useEffect(() => {
    setKnowledgeMap(null)
    setQuery('')
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (values: Array<string | undefined>) =>
    !normalizedQuery || values.some((value) =>
      value?.toLocaleLowerCase().includes(normalizedQuery),
    )
  const visibleTasks = useMemo(() => knowledgeMap?.tasks.filter((task) => {
    const sourceTitles = knowledgeMap.sources
      .filter((source) => source.taskIds.includes(task.taskId))
      .map((source) => source.title)
    const itemTexts = knowledgeMap.knowledgeItems
      .filter((item) => item.taskId === task.taskId)
      .map((item) => item.text)
    return matches([
      task.title,
      task.assistantName,
      ...task.artifactPaths,
      ...sourceTitles,
      ...itemTexts,
    ])
  }) ?? [], [knowledgeMap, normalizedQuery])
  const visibleSources = knowledgeMap?.sources.filter((source) =>
    matches([source.title, sourceLocation(source)]),
  ) ?? []
  const visibleArtifacts = knowledgeMap?.artifacts.filter((artifact) =>
    matches([artifact.path]),
  ) ?? []
  const visibleItems = knowledgeMap?.knowledgeItems.filter((item) =>
    matches([item.text, item.taskTitle]),
  ) ?? []

  const openTaskSession = (task: WorkspaceKnowledgeTask) => {
    if (!task.sessionId) return
    useTabStore.getState().openTab(task.sessionId, task.title)
    useChatStore.getState().connectToSession(task.sessionId)
  }

  if (!workspacePath) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-tertiary)]">
        {t('projectKnowledge.invalidProject')}
      </div>
    )
  }

  const summary = knowledgeMap?.summary

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
      <header className="shrink-0 border-b border-[var(--color-border-separator)] px-6 py-4">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network size={18} strokeWidth={1.2} className="text-[var(--color-brand)]" aria-hidden="true" />
              <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
                {t('projectKnowledge.title')}
              </h1>
            </div>
            <div className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]" title={workspacePath}>
              {workspacePath}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
          >
            <RefreshCw size={16} strokeWidth={1.2} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-[var(--color-border-separator)] px-6 py-3">
        <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-5">
          {[
            [t('projectKnowledge.metric.tasks'), summary?.taskCount ?? 0],
            [t('projectKnowledge.metric.sources'), summary?.sourceCount ?? 0],
            [t('projectKnowledge.metric.artifacts'), summary?.artifactCount ?? 0],
            [t('projectKnowledge.metric.items'), summary?.candidateCount ?? 0],
            [t('projectKnowledge.metric.conflicts'), summary?.potentialConflictCount ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0 border-l border-[var(--color-border-separator)] px-3 first:border-l-0">
              <div className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</div>
              <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label={t('projectKnowledge.views')} className="inline-flex h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'overview'}
              onClick={() => setView('overview')}
              className={view === 'overview' ? 'flex h-7 items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text-primary)] shadow-sm' : 'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--color-text-tertiary)]'}
            >
              <ListTree size={14} strokeWidth={1.2} aria-hidden="true" />
              {t('projectKnowledge.view.overview')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'relations'}
              onClick={() => setView('relations')}
              className={view === 'relations' ? 'flex h-7 items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text-primary)] shadow-sm' : 'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--color-text-tertiary)]'}
            >
              <Network size={14} strokeWidth={1.2} aria-hidden="true" />
              {t('projectKnowledge.view.relations')}
            </button>
          </div>
          <label className="flex h-8 min-w-[220px] max-w-sm flex-1 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5">
            <Search size={14} strokeWidth={1.2} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('projectKnowledge.search')}
              aria-label={t('projectKnowledge.search')}
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          </label>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 border-l-2 border-[var(--color-error)] bg-[var(--color-error)]/5 px-3 py-2 text-xs text-[var(--color-error)]">
              <span>{error}</span>
              <button type="button" onClick={() => void load()} className="font-semibold hover:underline">{t('common.retry')}</button>
            </div>
          )}
          {!error && !loading && knowledgeMap && knowledgeMap.tasks.length === 0 && (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <BookOpenText size={28} strokeWidth={1.1} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <div className="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">{t('projectKnowledge.empty')}</div>
              <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('projectKnowledge.emptyHint')}</div>
            </div>
          )}

          {knowledgeMap && knowledgeMap.tasks.length > 0 && view === 'overview' && (
            <div className="grid gap-6 xl:grid-cols-2">
              <KnowledgeSection title={t('projectKnowledge.section.tasks')} icon={FolderKanban}>
                {visibleTasks.map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    disabled={!task.sessionId}
                    onClick={() => openTaskSession(task)}
                    className="flex w-full items-start justify-between gap-3 border-b border-[var(--color-border-separator)] px-1 py-3 text-left last:border-b-0 hover:bg-[var(--color-surface-hover)] disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-[var(--color-text-primary)]">{task.title}</span>
                      <span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">
                        {task.relation === 'review' ? t('agentTask.review.relation') + ' · ' : ''}
                        {task.assistantName ?? t(AGENT_TASK_ROLE_PRESENTATION[task.role].labelKey)} · {formatTime(task.completedAt)}
                      </span>
                    </span>
                    {task.sessionId && <ExternalLink size={13} strokeWidth={1.2} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />}
                  </button>
                ))}
              </KnowledgeSection>

              <KnowledgeSection title={t('projectKnowledge.section.sources')} icon={BookOpenText}>
                {visibleSources.map((source) => (
                  <div key={source.sourceId} className="border-b border-[var(--color-border-separator)] px-1 py-3 last:border-b-0">
                    <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{source.title}</div>
                    <div className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]" title={sourceLocation(source)}>
                      {t(SOURCE_LABEL_KEYS[source.kind])} · {sourceLocation(source)}
                    </div>
                  </div>
                ))}
              </KnowledgeSection>

              <KnowledgeSection title={t('projectKnowledge.section.items')} icon={BookOpenText}>
                {visibleItems.map((item) => (
                  <div key={item.id} className="border-b border-[var(--color-border-separator)] px-1 py-3 last:border-b-0">
                    <div className="text-xs leading-5 text-[var(--color-text-primary)]">{item.text}</div>
                    <div className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]">{item.taskTitle}</div>
                  </div>
                ))}
              </KnowledgeSection>

              <KnowledgeSection title={t('projectKnowledge.section.artifacts')} icon={FileOutput}>
                {visibleArtifacts.map((artifact) => (
                  <div key={artifact.path} className="flex items-center justify-between gap-3 border-b border-[var(--color-border-separator)] px-1 py-3 last:border-b-0">
                    <span className="min-w-0 truncate text-xs text-[var(--color-text-primary)]" title={artifact.path}>{artifact.path}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{t('projectKnowledge.usedByTasks', { count: artifact.taskIds.length })}</span>
                  </div>
                ))}
              </KnowledgeSection>
            </div>
          )}

          {knowledgeMap && knowledgeMap.tasks.length > 0 && view === 'relations' && (
            <div className="space-y-3">
              {visibleTasks.map((task) => {
                const taskSources = knowledgeMap.sources.filter((source) => source.taskIds.includes(task.taskId))
                const taskArtifacts = knowledgeMap.artifacts.filter((artifact) => artifact.taskIds.includes(task.taskId))
                const taskItems = knowledgeMap.knowledgeItems.filter((item) => item.taskId === task.taskId)
                return (
                  <div key={task.taskId} className="grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 lg:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)] lg:items-center">
                    <RelationColumn label={t('projectKnowledge.section.sources')} values={taskSources.map((source) => source.title)} empty={t('projectKnowledge.none')} />
                    <ArrowRight size={15} strokeWidth={1.2} className="hidden text-[var(--color-text-tertiary)] lg:block" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">{t('projectKnowledge.relation.task')}</div>
                      <div className="mt-1 truncate text-xs font-semibold text-[var(--color-text-primary)]">{task.title}</div>
                      <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]">
                        {task.relation === 'review' ? t('agentTask.review.relation') + ' · ' : ''}
                        {task.assistantName ?? t(AGENT_TASK_ROLE_PRESENTATION[task.role].labelKey)}
                      </div>
                    </div>
                    <ArrowRight size={15} strokeWidth={1.2} className="hidden text-[var(--color-text-tertiary)] lg:block" aria-hidden="true" />
                    <RelationColumn label={t('projectKnowledge.relation.outputs')} values={[...taskArtifacts.map((artifact) => artifact.path), ...taskItems.map((item) => item.text)]} empty={t('projectKnowledge.none')} />
                  </div>
                )
              })}
            </div>
          )}

          {knowledgeMap?.potentialConflicts.length ? (
            <div className="mt-5 border-l-2 border-[var(--color-warning)] bg-[var(--color-warning)]/5 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-primary)]">
                <TriangleAlert size={14} strokeWidth={1.2} className="text-[var(--color-warning)]" aria-hidden="true" />
                {t('projectKnowledge.conflicts', { count: knowledgeMap.summary.potentialConflictCount })}
              </div>
              {knowledgeMap.potentialConflicts.map((conflict) => (
                <div key={conflict.artifactPath} className="mt-1 truncate text-[11px] text-[var(--color-text-secondary)]" title={conflict.artifactPath}>{conflict.artifactPath}</div>
              ))}
            </div>
          ) : null}
          {knowledgeMap?.summary.truncated && (
            <div className="mt-4 text-[11px] text-[var(--color-text-tertiary)]">{t('projectKnowledge.truncated')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function KnowledgeSection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <section className="min-w-0">
      <h2 className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <Icon size={14} strokeWidth={1.2} aria-hidden="true" />
        {title}
      </h2>
      <div>{children}</div>
    </section>
  )
}

function RelationColumn({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-1 space-y-1">
        {(values.length ? values : [empty]).slice(0, 4).map((value, index) => (
          <div key={`${value}-${index}`} className="truncate text-[11px] text-[var(--color-text-secondary)]" title={value}>{value}</div>
        ))}
      </div>
    </div>
  )
}
