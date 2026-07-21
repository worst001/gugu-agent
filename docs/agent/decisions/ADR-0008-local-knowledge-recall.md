# ADR-0008: Local Knowledge Recall

## Status

Accepted for the P7 local reuse slice.

## Context

Completed tasks now persist bounded knowledge candidates, but automatically
injecting unapproved candidates into future prompts would amplify mistakes.
The first reuse path needs to remain local, inspectable, and Workspace-scoped.

## Decision

Add explicit recall to AgentTask and a matching read-only REST endpoint.
Recall defaults to the current task goal, searches only completed tasks with
the same derived Workspace ID, excludes the current task, and returns at most
20 ranked candidates.

Results retain their pending state and link back to the source task, Evidence
Pack, optional Provenance Pack, and artifact paths. Agent instructions require
verification before reuse. Recall does not modify the task or automatically
inject results into model context.

Version 1 uses deterministic local text matching with Unicode normalization,
word matches, and bounded bigram support for non-ASCII queries. It scans local
task candidates linearly because current scale does not justify an index.

## Consequences

- Agents can deliberately reuse prior task outcomes during scout.
- Workspace isolation is enforced without exposing local paths.
- Pending candidates remain hints, not accepted facts.
- No vector database, graph database, embedding call, gateway change, or cloud
  synchronization is introduced.

## Revision Trigger

Add an index or embeddings only after measured recall quality or latency shows
the deterministic local scan is inadequate. Acceptance, conflicts, retention,
and visual knowledge maps remain PR7 work.
