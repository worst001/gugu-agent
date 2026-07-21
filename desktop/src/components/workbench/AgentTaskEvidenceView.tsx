import { useEffect } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  CircleDashed,
  FileText,
  Link2,
  MessageSquareText,
  Network,
  Paperclip,
  ShieldCheck,
  SquareTerminal,
  XCircle,
} from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import type {
  AgentTaskDetail,
  SourceLocator,
  SourceRef,
  VerificationResult,
} from '../../types/agentTask'

const SOURCE_ICONS: Record<SourceLocator['kind'], typeof FileText> = {
  file: FileText,
  attachment: Paperclip,
  message: MessageSquareText,
  tool_result: SquareTerminal,
  url: Link2,
}

const SOURCE_LABEL_KEYS: Record<SourceLocator['kind'], TranslationKey> = {
  file: 'agentTask.evidence.source.file',
  attachment: 'agentTask.evidence.source.attachment',
  message: 'agentTask.evidence.source.message',
  tool_result: 'agentTask.evidence.source.toolResult',
  url: 'agentTask.evidence.source.url',
}

export function AgentTaskEvidenceView({
  detail,
}: {
  detail: AgentTaskDetail | null | undefined
}) {
  const t = useTranslation()
  const refreshCurrentTask = useAgentTaskStore(
    (state) => state.refreshCurrentTask,
  )
  const knowledgeMap = useAgentTaskStore((state) => state.knowledgeMap)
  const refreshKnowledgeMap = useAgentTaskStore(
    (state) => state.refreshKnowledgeMap,
  )
  const task = detail?.task
  const evidence = detail?.evidencePack
  const provenance = detail?.provenancePack

  useEffect(() => {
    if (task) void refreshCurrentTask()
  }, [task?.id, refreshCurrentTask])

  useEffect(() => {
    if (task) void refreshKnowledgeMap()
  }, [task?.id, task?.revision, refreshKnowledgeMap])

  if (!task) {
    return (
      <div className="py-8 text-center text-xs text-[var(--color-text-tertiary)]">
        {t('agentTask.evidence.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="border-b border-[var(--color-border)] pb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck
            size={16}
            strokeWidth={1.2}
            className="text-[var(--color-brand)]"
          />
          <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {task.title}
          </h2>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          {task.goal}
        </p>
      </section>

      <section>
        <SectionTitle>{t('agentTask.evidence.sources')}</SectionTitle>
        {provenance?.sources.length ? (
          <>
            <p className="mb-2 text-[11px] text-[var(--color-text-secondary)]">
              {t('agentTask.evidence.sourceCount', {
                count: provenance.sources.length,
              })}
            </p>
            <div className="divide-y divide-[var(--color-border)]">
              {provenance.sources.map((source) => (
                <SourceItem key={source.id} source={source} />
              ))}
            </div>
          </>
        ) : (
          <EmptyLine text={t('agentTask.evidence.noSources')} />
        )}
      </section>

      <section>
        <SectionTitle>{t('agentTask.evidence.knowledge')}</SectionTitle>
        {knowledgeMap?.tasks.length ? (
          <>
            <p className="mb-2 text-[11px] text-[var(--color-text-secondary)]">
              {t('agentTask.evidence.knowledgeSummary', {
                tasks: knowledgeMap.summary.taskCount,
                candidates: knowledgeMap.summary.candidateCount,
                sources: knowledgeMap.summary.sourceCount,
              })}
            </p>
            {knowledgeMap.potentialConflicts.length ? (
              <div className="mb-2 space-y-1 border-l-2 border-[var(--color-warning)]/50 pl-2">
                <div className="flex items-center gap-2 text-[11px] text-[var(--color-warning)]">
                  <AlertTriangle size={13} strokeWidth={1.2} />
                  {t('agentTask.evidence.potentialConflicts', {
                    count: knowledgeMap.summary.potentialConflictCount,
                  })}
                </div>
                {knowledgeMap.potentialConflicts.map((conflict) => (
                  <div
                    key={conflict.kind + ':' + conflict.artifactPath}
                    className="break-all font-mono text-[10px] text-[var(--color-text-secondary)]"
                  >
                    {conflict.artifactPath}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="divide-y divide-[var(--color-border)]">
              {knowledgeMap.tasks.map((item) => (
                <div key={item.taskId} className="flex gap-2 py-2">
                  <Network
                    size={13}
                    strokeWidth={1.2}
                    className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">
                      {item.title}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-tertiary)]">
                      {t('agentTask.evidence.knowledgeTaskMeta', {
                        candidates: item.candidateCount,
                        sources: item.sourceCount,
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {knowledgeMap.summary.truncated ? (
              <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
                {t('agentTask.evidence.knowledgeTruncated')}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <EmptyLine text={t('agentTask.evidence.noKnowledge')} />
            {knowledgeMap?.summary.truncated ? (
              <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
                {t('agentTask.evidence.knowledgeTruncated')}
              </p>
            ) : null}
          </>
        )}
      </section>
      <section>
        <SectionTitle>{t('agentTask.evidence.checks')}</SectionTitle>
        {evidence?.checks.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {evidence.checks.map((result) => (
              <CheckResult key={result.checkId} result={result} />
            ))}
          </div>
        ) : (
          <EmptyLine text={t('agentTask.evidence.noChecks')} />
        )}
      </section>

      <section>
        <SectionTitle>{t('agentTask.evidence.changedFiles')}</SectionTitle>
        {evidence?.changedFiles.length ? (
          <div className="space-y-1">
            {evidence.changedFiles.map((file) => (
              <div
                key={file}
                className="flex min-w-0 items-center gap-2 py-1 text-[11px] text-[var(--color-text-secondary)]"
              >
                <FileText
                  size={13}
                  strokeWidth={1.2}
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                />
                <span className="break-all font-mono">{file}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text={t('agentTask.evidence.noFiles')} />
        )}
      </section>

      {evidence?.artifacts.length ? (
        <section>
          <SectionTitle>{t('agentTask.evidence.artifacts')}</SectionTitle>
          <div className="space-y-2">
            {evidence.artifacts.map((artifact) => (
              <div key={`${artifact.kind}:${artifact.path}`}>
                <div className="text-[11px] font-medium text-[var(--color-text-primary)]">
                  {artifact.label}
                </div>
                <div className="break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
                  {artifact.path}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionTitle>{t('agentTask.evidence.review')}</SectionTitle>
        {task.review ? (
          <div className="space-y-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
            <p>{task.review.summary}</p>
            {task.review.findings.map((finding, index) => (
              <div
                key={`${index}:${finding}`}
                className="border-l-2 border-[var(--color-border)] pl-2"
              >
                {finding}
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text={t('agentTask.evidence.noReview')} />
        )}
      </section>
    </div>
  )
}

function SourceItem({ source }: { source: SourceRef }) {
  const t = useTranslation()
  const Icon = SOURCE_ICONS[source.locator.kind]
  const address =
    source.locator.kind === 'file'
      ? source.locator.path
      : source.locator.kind === 'url'
        ? source.locator.url
        : null

  return (
    <details className="group py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] [&::-webkit-details-marker]:hidden">
        <Icon
          size={13}
          strokeWidth={1.2}
          className="shrink-0 text-[var(--color-text-tertiary)]"
        />
        <span className="min-w-0 flex-1 break-all font-medium text-[var(--color-text-primary)]">
          {source.title}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
          {t(SOURCE_LABEL_KEYS[source.locator.kind])}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={1.2}
          className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="ml-5 mt-2 space-y-2 border-l border-[var(--color-border)] pl-3 text-[10px] leading-4 text-[var(--color-text-tertiary)]">
        {source.excerpt ? (
          <blockquote className="whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">
            {source.excerpt}
          </blockquote>
        ) : null}
        {address && address !== source.title ? (
          <div className="break-all font-mono">{address}</div>
        ) : null}
        <time dateTime={source.observedAt}>
          {t('agentTask.evidence.sourceObservedAt', {
            time: source.observedAt,
          })}
        </time>
      </div>
    </details>
  )
}

function CheckResult({ result }: { result: VerificationResult }) {
  const t = useTranslation()
  const passed = result.status === 'passed' && result.exitCode === 0

  return (
    <div className="py-3 first:pt-0">
      <div className="flex items-center gap-2">
        {passed ? (
          <CheckCircle2
            size={14}
            strokeWidth={1.2}
            className="shrink-0 text-[var(--color-success)]"
          />
        ) : (
          <XCircle
            size={14}
            strokeWidth={1.2}
            className="shrink-0 text-[var(--color-error)]"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text-primary)]">
          {result.checkId}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {t('agentTask.evidence.exitCode', {
            code: result.exitCode ?? '-',
          })}
        </span>
      </div>
      <code className="mt-1 block break-all text-[10px] leading-4 text-[var(--color-text-tertiary)]">
        {result.command}
      </code>
      {result.stderr && (
        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[var(--color-error)]/40 pl-2 text-[10px] leading-4 text-[var(--color-error)]">
          {result.stderr}
        </pre>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
      {children}
    </h3>
  )
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">
      <CircleDashed size={13} strokeWidth={1.2} />
      {text}
    </div>
  )
}