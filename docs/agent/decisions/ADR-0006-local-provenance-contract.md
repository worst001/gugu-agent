# ADR-0006: Local Provenance Contract

## Status

Accepted for the P7 provenance foundation.

## Context

Agent tasks already persist local event logs and Evidence Packs, but Evidence
only proves verification results. It does not identify which session message,
attachment, file read, tool result, or URL was used by a task. The first
knowledge milestone needs reliable source tracing without turning the desktop
into a knowledge database or sending a local corpus to a cloud service.

## Decision

Add a separate, versioned `ProvenancePack` contract for task-level source
tracing. Version 1 contains only task/run/attempt identity, the owning Session,
an opaque Workspace ID, and `SourceRef` records. It does not claim that a source
influenced a specific sentence or expose model chain-of-thought.

`SourceRef.locator` is a closed union:

- A file or URL must name the trusted `toolUseId` that observed it.
- An attachment must name its user message and attachment index; its local path
  is optional because in-memory image attachments may not have one.
- A message must name its persisted message ID.
- A tool result must name its `toolUseId`; its message ID is optional.

Every source belongs to a Session. Source locators, hashes, and bounded excerpts
remain local. They are not uploaded by a background indexing or sync process.
Normal model requests may still receive the same user-selected or task-selected
context they already receive; this ADR adds no new cloud storage or gateway
behavior.

Derive `workspaceId` on the server from the task's `workspacePath`: resolve it
to an absolute canonical path, normalize Unicode and separators, lowercase on
Windows, hash with SHA-256, and prefix it with `ws_v1_`. Never accept a client
supplied Workspace ID as proof of ownership. Moving a workspace creates a new
identity; explicit migration is deferred until that is a demonstrated need.

The server validates every locator against the owning persisted Session before
building a Pack. Packs are stored separately from AgentTask events under the
local AgentTask root, using a unique JSON file per Pack. Writes use a temporary
file, flush it, and atomically rename it; interrupted temporary files are not
considered during recovery.

`POST /api/agent-tasks/:taskId/provenance` validates and persists up to 100
submitted locators. `GET /api/agent-tasks/:taskId/provenance` returns the latest
valid Pack for the task's current run and attempt, or `null` when none exists.
Malformed or cross-task Pack files fail closed instead of producing an
incomplete source trace.

## Consequences

- Existing AgentTask events, Evidence Packs, replay, and completion semantics
  remain schema version 1 and unchanged.
- The first UI can accurately say which sources a task used, but not which
  source caused a particular paragraph.
- Provenance can be replayed and inspected locally without a graph database,
  vector database, or gateway change.
- Generic Entity/Relation nodes, confidence scores, extracted knowledge,
  conflicts, and cross-Workspace sharing are outside this contract.

## Rejected Alternatives

- Add sources directly to `EvidencePack`: rejected because verification proof
  and contextual provenance have different trust and lifecycle rules.
- Persist a generic knowledge graph now: rejected because task-level source
  tracing needs no graph engine or universal node model.
- Store raw documents in provenance: rejected because local files and Session
  transcripts remain the source of truth; provenance stores locators, hashes,
  and bounded excerpts only.
- Let the model submit arbitrary paths or source IDs: rejected because the
  server must bind every locator to observed Session data.

## Rollback/Revision Trigger

The new types and Workspace ID helper are inert until persistence is enabled.
Rollback removes no data and requires no event migration. Revise the contract
only when sentence-level citations, workspace moves, or measured local scale
requires a stronger identity or projection model.