# ADR-0012: Knowledge Worker Vertical Slice

## Status

Accepted for P10.

## Context

The software-engineer Role Pack proved versioned context assembly, but it did
not prove that one AgentTask runtime can support a profession whose workflow and
quality gates are based on sources, calculations, document structure, audience,
format, privacy, and usable file artifacts rather than code and Git diffs.

## Decision

Add the built-in `knowledge_worker@1.0.0` Role Pack. It reuses the durable task
states, Evidence Pack, Provenance Pack, knowledge candidates, permission flow,
and explicit Review outcome. Its stage instructions reinterpret the shared
lifecycle as audience and purpose confirmation, source collection, deliverable
structure, artifact production, factual and file validation, and audience and
format review.

Knowledge-work checks remain task-specific commands executed through existing
tools; AgentTask stores only their real submitted results and artifacts. The
software-specific Stage Router is rejected for this role in both generated-plan
and generated-review paths because it assumes implementation work and Git diff
review.

The role-specific delivery contract is a runtime gate, not prompt-only advice:
verification must retain at least one normalized file artifact, and review plus
completion require a current-attempt Provenance Pack. The Agent records those
trusted sources through the existing AgentTask tool before finishing review.

## Consequences

- No second task runtime, graph database, or profession-specific permission
  bypass is introduced.
- Capability discovery advertises both built-in roles while software engineer
  remains the default.
- The first slice proves a file-artifact workflow but does not add automatic
  document rendering or semantic fact checking; those remain explicit checks.
- P11 owns model-facing role discovery and role-aware status presentation in the desktop UI; an explicit desktop role picker remains a separate product decision.
