# ADR-0013: Professional Team Composition

## Status

Accepted for the AI team professionalization P1.

## Context

The current product can create a durable `AgentTask` with a versioned Role Pack,
an optional local assistant identity, evidence, provenance, review, and local
knowledge. Three built-in roles currently repeat the same six-stage workflow,
and each Role Pack carries semantic tool-capability strings. Actual tools,
Skills, MCP providers, plugins, and permissions already have separate runtime
owners.

The desktop now makes roles visible, but a role name plus instructions is not a
professional team. The product needs reusable professional working methods
without introducing a second tool system, allowing user preferences to weaken
professional standards, or making historical tasks change when definitions are
upgraded.

## Decision

### Product composition

Use `TeamTemplate` as the top-level product entry. A team composes versioned
references instead of copying their implementations:

- `TaskTemplate`: a quick start inside one team, such as bug fixing, feature
  delivery, research brief, or short-video script.
- `WorkflowPack`: ordered stages, stage guidance, gates, handoffs, and completion
  path.
- `RolePack`: professional mission, responsibilities, non-goals, quality
  standards, output contracts, and capability requirements.
- `CapabilityRef`: a semantic requirement such as source retrieval, document
  generation, browser automation, or code execution.
- `AssistantOverlay`: bounded user preferences and domain context applied to one
  base Role Pack.

The initial Team, Task, Workflow, and Role definitions are code-owned, local,
and versioned. Users may begin with a plain-language goal and accept a
recommended team; visiting a team-management page is not a prerequisite.

`TeamTemplate` may declare one required primary role slot and optional
collaborator slots. A declared slot is not evidence that an assistant
participated. The product displays a collaborator only after a real persisted
delegation or child-task event exists.

This product-level `TeamTemplate` is not the existing low-level Agent Teams,
TeamFile, or swarm runtime. A later runtime adapter may use those facilities,
but the product contract does not depend on them.

### Declarative templates and constrained runtime

Templates declare goals, responsibilities, constraints, required capabilities,
outputs, and completion standards. They do not grant tools, select credentials,
or claim that work occurred.

Task creation resolves the selected definitions and freezes a versioned
execution contract. Runtime may then choose available Tool, Skill, MCP, or
plugin providers, execution order, and retries within that contract and the
live permission boundary. Runtime must not remove workflow gates, relax Role
Pack standards, silently replace the primary role, invent collaborators, or
report unobserved progress.

The first `WorkflowPack` implementation remains a versioned declaration over
the existing `AgentTaskStatus` lifecycle. Arbitrary graphs, free-form workflow
editing, and general parallel scheduling are deferred until the three built-in
teams prove that the fixed lifecycle is insufficient.

### Capability resolution

`CapabilityRef` is a thin semantic layer over existing runtime facilities:

1. Team, workflow, or role definitions declare required or optional capability
   IDs.
2. A resolver maps each ID to currently available Tools, Skills, MCP providers,
   or plugins.
3. Existing tool enablement and permission checks remain authoritative.
4. Required capabilities that cannot be resolved block execution with an
   explicit reason; optional capabilities may be omitted.
5. Actual provider use is recorded through real runtime, tool, evidence, and
   provenance events.

Capability declarations never authorize a provider. No separate Capability
runtime, permission model, plugin loader, or persistent capability database is
introduced.

### Assistant overlay rules

An `AssistantOverlay` may add tone, format preferences, audience context,
domain vocabulary, and stricter task requirements. It may not remove or weaken
Role Pack non-goals, Workflow gates, Definition of Done, output contracts,
permission checks, or system safety rules.

An overlay applies only when its base role exactly matches the assigned role
slot. A mismatch is rejected instead of silently converting the assistant or
the task.

Composition is monotonic rather than last-write-wins:

- system safety and real permissions are always authoritative;
- Team assignment, Workflow gates, and Role standards are protected;
- Task Templates and user requests may add scope, deliverables, and constraints;
- Assistant overlays may add preferences and context;
- a conflicting addition is rejected or surfaced for confirmation instead of
  overriding a protected rule.

The current desktop `CustomAssistant` remains the single user-owned assistant
source. No parallel assistant registry is added.

### Durable task snapshot

An `AgentTask` represents one execution-time binding of the selected team,
workflow, roles, capabilities, assistant overlay, and task request. New tasks
must durably retain enough bounded local data to preserve that meaning:

- Team, Task Template, Workflow, and Role IDs with exact versions;
- primary and collaborator slot assignments;
- required and optional capability IDs;
- the selected assistant ID, name, base role, source `updatedAt`, and bounded
  overlay instructions;
- task-specific goal, constraints, required outputs, and completion contract;
- a snapshot schema version.

Provider resolution belongs to the run or attempt record because installed
providers and permissions can change. The task snapshot keeps capability
requirements immutable; each attempt records the providers it actually resolved
and used. Secrets, credentials, complete tool schemas, Skill contents, and
global prompts are never copied into the snapshot.

Existing tasks without this snapshot continue to replay from their persisted
role and role version. Missing team, workflow, capability, or assistant-overlay
data is shown as unknown and is never reconstructed from current templates.

### Initial product scope

Prove the composition with only three built-in teams:

- software delivery;
- knowledge delivery;
- short-video production.

Independent review is a reusable review path backed by a real related
`AgentTask`; it is not a simulated collaborator. Additional teams are deferred
until these three exhibit materially different workflows, capability needs,
and completion standards.

## Compatibility With Existing Decisions

- ADR-0010 remains authoritative for local, versioned Role Pack resolution, but
  reusable workflow definitions will move out of Role Pack implementation
  details, and raw semantic tool strings will become `CapabilityRef`
  requirements in later phases.
- ADR-0011 remains authoritative for exact-version context assembly and for the
  rule that capability metadata cannot grant tools.
- ADR-0012 remains authoritative for source-backed artifact gates and explicit
  review. The knowledge-worker workflow will later reference a Workflow Pack
  instead of embedding the shared lifecycle.
- Existing AgentTask events, Evidence Packs, Provenance Packs, local knowledge,
  permissions, Tools, Skills, MCP, plugins, and desktop assistant persistence
  remain their respective sources of truth.

## Consequences

- Users express a goal and may accept a recommended professional team or choose
  one directly; internal pack identifiers remain advanced information.
- Workflow, profession, reusable capability, and personal preference can evolve
  independently while historical tasks retain their original contract.
- The next implementation phase can extract the duplicated fixed workflow
  without changing the AgentTask state machine.
- Assistant instructions must move from prompt-only launch context into the
  bounded local task snapshot before replay can be considered faithful.
- Real multi-role visibility depends on real delegation or child-task events;
  templates alone cannot populate a task team panel.

## Rejected Alternatives

- Put Team and Task Template at the same product level: rejected because task
  templates are team-specific entry points.
- Keep workflow and capabilities embedded in each Role Pack: rejected because
  it duplicates working methods and shared abilities across professions.
- Add a new Capability runtime or permission system: rejected because Tools,
  Skills, MCP, plugins, and permissions already own execution.
- Let assistants inherit and override complete roles: rejected because user
  preferences could erase professional standards.
- Resolve every historical task from the latest templates: rejected because an
  upgrade would change the meaning of past work.
- Persist complete prompts and tool definitions in every task: rejected because
  it duplicates data and risks retaining secrets or unrelated configuration.
- Build a free-form workflow canvas now: rejected until the three initial teams
  prove a need beyond the existing lifecycle.
