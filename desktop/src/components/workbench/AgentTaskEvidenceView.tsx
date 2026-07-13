import {
  CheckCircle2,
  CircleDashed,
  FileText,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import type {
  AgentTaskDetail,
  VerificationResult,
} from '../../types/agentTask'

export function AgentTaskEvidenceView({
  detail,
}: {
  detail: AgentTaskDetail | null | undefined
}) {
  const t = useTranslation()
  const task = detail?.task
  const evidence = detail?.evidencePack

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