# ADR-0004: Review as a Soft Gate

## Status

Accepted for P0-C.

## Context

Review can catch defects that deterministic checks miss, but model or service review is probabilistic and can be unavailable, time out, or return uncertain prose. The existing permission path in `desktop/src/stores/chatStore.ts`, `desktop/src/types/chat.ts`, `src/server/ws/events.ts`, and `src/server/ws/handler.ts` already distinguishes structured request/response messages from display text. Completion should keep the same separation between structured facts and natural-language guidance.

## Decision

Review is advisory and acts only as a soft gate. A review result may add findings, request another attempt, or display warnings, but it does not override the completion rule in ADR-0003.

- Review unavailable: persist and display a warning.
- Review timeout: persist and display a warning.
- Review confidence below the declared policy threshold: persist and display a low-confidence warning.
- Structured findings or a structured verdict: persist as review metadata and present them to the user, without treating them as deterministic truth.
- Natural-language output: store as commentary only. Do not parse words such as "approved", "pass", "reject", or their translations into a machine completion decision.

If all required deterministic checks pass and Evidence persists, the task may complete with review warnings. If required checks fail, a favorable review cannot complete it.

Planned implementation paths, not present at the time of this ADR:

- `src/agentTask/types.ts` (planned)
- `src/agentTask/review/reviewPolicy.ts` (planned)

## Consequences

- Review outages and latency do not strand otherwise verified work.
- Users can see review uncertainty instead of receiving a fabricated binary result.
- Some tasks may complete with unresolved review warnings; the warning remains in durable Evidence and event history.
- Automation must use deterministic checks, not reviewer prose, for hard policy enforcement.

## Rejected Alternatives

- Require review availability for every completion: rejected because an external or probabilistic dependency would become a hard availability gate.
- Parse free-form review text into pass/fail: rejected because wording, language, and model behavior are unstable.
- Ignore review failures entirely: rejected because unavailable, timed-out, and low-confidence review are useful operational evidence.
- Allow a positive review to waive failed checks: rejected because it violates evidence-first completion.

## Rollback/Revision Trigger

The review step can be disabled independently while deterministic completion remains intact. Consider a hard gate only for a narrowly scoped policy backed by a versioned structured schema, measured reliability, explicit timeout/failure behavior, and an operator-approved fallback; free-form verdict parsing remains prohibited.
