# Multi-Role Evaluation Baseline

## Purpose

This baseline extends the software-bugfix checks with a reproducible knowledge-
worker slice. It defines tasks and scoring rules only; it does not report model
quality, hit rate, duration, or cost until the tasks have actually run.

## Automated Contract Matrix

| Case | Expected result | Automated evidence |
| --- | --- | --- |
| Role omitted | `software_engineer@1.0.0` remains the default | `service.test.ts` |
| Explicit knowledge role | `knowledge_worker@1.0.0` is persisted and assembled | `AgentTaskTool.test.ts` |
| Legacy event | `software_engineer` marker resolves to the original `1.0.0` context | `agentTask.test.ts` |
| Unknown role | Creation fails at the service registry boundary | `service.test.ts` |
| Software-only router | Knowledge work rejects generated Stage Router plan/review | `AgentTaskTool.test.ts` plus shared orchestrator guard |
| Knowledge delivery gate | Missing artifact or current-attempt provenance cannot complete | `service.test.ts` and `AgentTaskTool.test.ts` |
| Runtime flag off | Existing session path remains unchanged | `agent-tasks.test.ts` and desktop Store tests |
| Desktop rendering | Both roles are representable; knowledge stages use business language | `AgentTaskStatusBar.test.tsx` and desktop lint |

## Knowledge-Worker Golden Tasks

Use a temporary output directory and retain the AgentTask event log, Evidence
Pack, Provenance Pack, final artifact, and review outcome for every run.

| ID | Real repository input | Required artifact | Acceptance focus |
| --- | --- | --- | --- |
| KW-01 | `doc/职业化智能体平台架构与设计规范_Canvas版.md` | Decision brief in Markdown | Cited sections, role/runtime distinction, no invented implementation claims |
| KW-02 | The Canvas specification and `doc/多角色AI工作平台产品演进建议.docx` | Comparison memo | Agreements, disagreements, source attribution, explicit uncertainty |
| KW-03 | Images under `doc/Gugu 迭代/` | Product comparison table and short report | Visible evidence, no guessed hidden behavior, actionable findings |
| KW-04 | `AGENTS.md` and `.github/workflows/release-desktop.yml` | Desktop release checklist | Exact commands and gates, no local publishing, updater artifacts included |

## Scoring Rubric

Score each category `0` (failed), `1` (usable with corrections), or `2`
(meets contract):

1. Source traceability and citation accuracy.
2. Factual and calculation correctness.
3. Audience fit and decision usefulness.
4. Structure, readability, and requested format.
5. Artifact integrity: the file exists and opens with the expected content.
6. Privacy, permissions, and unsupported-assumption handling.

A task passes only with at least `10/12`, no zero category, passing declared
artifact checks, and a recorded review. Source traceability and artifact
integrity are mandatory even when the total score would otherwise pass.

## Comparison Protocol

Run the same model and task input twice: once through the existing general
session path and once with `knowledge_worker`. Keep tool permissions, source
files, and output format identical. Score blind from the retained artifacts and
evidence. Report individual category scores and failure reasons; do not replace
them with an untraceable aggregate success claim.

## Compatibility Exit Criteria

- Existing software tasks replay and render without migration.
- New knowledge tasks survive restart and retain exact role version.
- Old clients may ignore the additive role behavior without corrupting tasks.
- Turning off `CC_GUGU_AGENT_TASK_RUNTIME` restores the existing session path
  without deleting local task, evidence, provenance, or knowledge files.
- No release, tag, migration, or `gateway` change is part of this baseline.
