# ADR-0014: Professional task entry

## Status

Accepted

## Decision

- Users choose Chat or Professional Task.
- Professional Task exposes one combined Team Template and Task Template choice.
- The selected Team Template fixes the primary Role Pack. Users do not create or select professions.
- Existing custom-assistant data remains readable for historical compatibility, but new tasks do not select or snapshot an Assistant Overlay.
- Automatic recommendations apply only while the selector is set to Smart recommendation. A manual selection is never silently replaced.
- Quick actions are user-facing task hints. They may recommend a team and task template and continue to reuse the existing Skill and tool routing; they are not a second capability model.
- AgentTask stores the resolved team, task template, workflow, role, and capabilities as an immutable versioned snapshot.
- The task UI displays only persisted task, review, source, artifact, and status data. It does not invent collaborators, stages, or percentage progress.

## Compatibility

- Historical tasks without team snapshots continue to display their persisted role when available.
- Historical Assistant Overlay fields and desktop profile data are retained without a creation or selection UI.
- Existing chat sessions keep quick actions as single-message intent and are not silently converted into AgentTasks.

## Deferred

- User-authored professions, assistants, teams, and workflow canvases.
- Runtime collaborators other than persisted child tasks.
- Workspace and brand preferences beyond the existing desktop profile contract.
