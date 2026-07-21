# ADR-0011: Role Pack Context Assembly

## Status

Accepted for P9.

## Context

AgentTask persisted a versioned Role Pack but the model only received a static
software-bugfix tool description. Tool schemas are cached for session stability,
so task-specific role instructions cannot safely live in the cached description.

## Decision

Project each persisted Role Pack into a compact task result containing its
mission, responsibilities, non-goals, workflow, current-stage instructions,
tool-capability intent, permission profile, Definition of Done, and output
contracts. Single-task AgentTask actions return this context; list and recall
remain compact.

Resolve context by the task's persisted role and exact version. The legacy
`software_engineer` version marker maps explicitly to the original `1.0.0`
definition. A blocked or interrupted task receives instructions for its saved
resume stage. The static tool prompt is profession-neutral and states that Role
Pack capabilities are metadata; existing tools and permission checks remain the
only authorization boundary.

## Consequences

- No global system-prompt mutation or dynamic Role Pack loader is introduced.
- Historical tasks do not silently adopt a newer Role Pack.
- P10 can add a second profession through the same registry and context result.
- Knowledge recall remains explicit instead of being injected into every task.
