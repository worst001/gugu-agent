# ADR-0010: Built-in Role Pack Registry

## Status

Accepted for the first Role Pack runtime slice.

## Context

AgentTask stores a software-engineer role ID, but the role contract and its
version are duplicated implicit rules. Adding another profession before the
runtime can resolve an immutable role version would make historical tasks
change meaning when a role definition changes.

## Decision

Keep the first Role Pack code-owned and local. The registry defines the
software-engineer mission, responsibilities, non-goals, workflow, tool
capabilities, inherited permission boundary, Definition of Done, and output
contracts. Versions remain addressable in latest-first order, and new tasks
persist the resolved Role Pack version. The API accepts a bounded role ID while
the service uses this registry as the support boundary.

Legacy task events without a version replay with their original role ID as the
legacy version marker. Capability discovery derives supported role IDs from
the same registry.

## Consequences

- Existing tools and permission checks remain the enforcement boundary.
- Role Pack metadata does not grant tools or bypass approval.
- Dynamic file loading, remote role catalogs, per-task role switching, and a
  second profession are deferred until context assembly consumes this contract.