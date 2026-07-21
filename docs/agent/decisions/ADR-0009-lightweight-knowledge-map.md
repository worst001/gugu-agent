# ADR-0009: Lightweight Knowledge Map

## Status

Accepted

## Context

Completed AgentTasks already persist local Evidence, Provenance, Artifacts, and
pending knowledge candidates. Users need a simple way to understand what a
Workspace has learned without turning the main experience into a graph editor
or introducing a graph database before the relationships prove useful.

## Decision

Build a Workspace-scoped knowledge summary from completed local AgentTasks.
Show recent tasks, candidate and source counts, artifacts, and potential
conflicts in the existing Workbench Evidence view.

A path used by multiple completed tasks is a shared_artifact_path review prompt.
It is not treated as proof that the artifact contents conflict.

The local scan is bounded to 500 completed tasks and the visible task and
conflict lists to 50 rows each. Recall uses the same scan ceiling. Both
contracts report truncation;
raw task events and knowledge candidate packs are retained.

## Consequences

- No graph database, free-form graph canvas, or manual node maintenance is
  required for the first slice.
- Workspace isolation continues to use the existing derived Workspace ID.
- Semantic conflict detection waits for reviewed knowledge, version, and
  feedback contracts that can support trustworthy decisions.
- An index or retention policy is introduced only after measured local volume
  or latency demonstrates the need.