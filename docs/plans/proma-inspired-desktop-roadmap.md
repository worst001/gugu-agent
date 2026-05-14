# Proma-Inspired Desktop Roadmap

This document turns the Proma review into a staged roadmap for GuGu. The goal is
not to clone Proma, but to borrow the parts that make a desktop agent feel more
usable: a visible workbench, clear file and diff previews, portable
configuration, and safer long-running sessions.

## References

- Proma repository: https://github.com/ErlichLiu/Proma
- Proma v0.9.24 release notes: backup, share, and team distribution
- Proma v0.9.26 release notes: right-side diff and file preview
- Proma v0.9.27 release notes: standalone preview, Office preview, input polish

## Current GuGu Baseline

GuGu already has these foundations:

- Provider, model, and effort controls
- CE workflow selector and fast/strong model preference routing
- MCP, Skills, Plugins, and Agents management pages
- GLM file and image attachment parser
- Prompt optimization wand
- Agent watchdog and recovery notices
- Tool activity, task bar, and diff display foundations
- Domestic-provider-oriented model switching foundations

Proma is stronger in these product areas:

- Clearer Chat vs Agent mode split
- Cleaner aggregation of agent tool activity
- A right-side workbench for file preview and diff review
- More complete user-facing file preview, especially Office/PDF/images
- Backup, migration, and team distribution flows
- More visible current workspace capability state
- More complete China-market model and IM integration presets

## Product Direction: Domestic Models First

GuGu should prioritize domestic model providers and China-market messaging
channels instead of trying to become a global provider catalog.

Primary model targets:

- DeepSeek, including fast/flash and pro routing
- GLM/Zhipu, including attachment parsing and agent-compatible chat
- Kimi, including Kimi Coding Plan if the protocol remains compatible
- Qwen/Tongyi
- Doubao
- MiniMax
- Custom OpenAI-compatible and Anthropic-compatible endpoints for advanced users

Primary IM and remote-channel targets:

- Lark/Feishu
- DingTalk
- WeChat bridge, if a safe local bridge is available
- Telegram only if it is cheap to maintain

Out of scope for the first complete pass:

- A long tail of international model providers
- Provider-specific UI for every global platform
- Remote-channel automation without explicit permission and secret boundaries

## Duration Estimate

Assuming one primary developer:

- MVP useful version: 3-4 weeks
- First complete pass: 6-8 weeks
- Full extended version with remote channels, voice input, and deeper session
  time-travel: 8-10+ weeks

Recommended delivery style:

- One small branch per phase
- Merge each phase into `feature-hwh-dev`
- Only merge to `dev` after the phase is stable

## Phase 0: Baseline And Design

Duration: 1-2 days

Goals:

- Map Proma features to existing GuGu features.
- Define the data model for the future right-side workbench.
- Clarify boundaries between chat messages, tool activity, file preview, diff
  data, and GLM attachment parsing.

Deliverables:

- Lightweight technical design note.
- Component/store/API list for later phases.
- Final branch and test plan.

Suggested branch:

- `docs/proma-roadmap`

Acceptance criteria:

- No product behavior changes.
- Later phases can be split into clear implementation tasks.

## Phase 1: Capability Bar And Composer Polish

Duration: 3-5 days

Goals:

- Show the current session capability state in the main UI:
  - provider and model
  - effort
  - GLM parser status
  - MCP count
  - Skills count
  - Plugins count
- Make the capability area clickable, with jumps to the relevant settings page.
- Improve composer basics:
  - draft autosave
  - long paste to attachment
  - clearer attachment parsing state

Why first:

- Low risk and high visibility.
- Helps users understand what the current agent can actually do.
- Provides UI state that later workbench and config export features can reuse.

Deliverables:

- `CapabilityBar` or equivalent component.
- Session-scoped draft persistence.
- Long text paste detection, initially for plain text.
- Small tests for capability rendering and draft restore.

Acceptance criteria:

- Provider/model/effort changes are reflected in the capability display.
- GLM parser states are distinct: off, needs config, ready.
- Drafts survive tab switches and frontend reloads.
- Long pasted text does not make the composer unwieldy.

Risks:

- The composer is already dense. Prefer a compact status row or sidebar footer
  instead of adding more buttons to the bottom control strip.

## Phase 1.5: Conversation UI Polish

Duration: 4-6 days

Goals:

- Make the conversation feedback feel smoother and calmer, closer to Proma's
  reading-first style.
- Reduce visual noise in the chat timeline.
- Rebalance the current dark orange/brown theme so it keeps GuGu's identity
  without making large areas feel heavy.
- Add a Proma-inspired light theme candidate, then keep dark mode as a polished
  alternative.
- Make tool activity less jumpy by grouping low-level events into compact
  summaries by default.

Why before the workbench:

- This improves the daily feel immediately.
- The workbench will introduce more UI surface area, so the base conversation
  layout should be calmer first.

Deliverables:

- Refined chat message spacing, typography, and markdown/code block hierarchy.
- Updated color tokens for a lighter, lower-noise palette.
- Polished dark theme with less dominant orange/brown surface area.
- Optional light theme toggle or internal theme candidate.
- Compact tool activity group presentation in the chat timeline.
- Composer control visual cleanup:
  - secondary controls become ghost or icon-first
  - primary run button remains visually clear
  - workflow and effort selectors keep stable sizing

Acceptance criteria:

- Long assistant answers read more like documents and less like stacked cards.
- Tool activity does not cause excessive layout jumping.
- System/recovery notices remain visible but do not look like fatal errors.
- The composer feels less crowded while preserving existing controls.
- Both compact and expanded tool states are accessible.

Risks:

- Avoid a pure Proma clone. GuGu should stay recognizable.
- Do not hide important agent state just to make the UI prettier.
- Any theme change must be checked in normal chat, attachment parsing, tool
  execution, error/recovery, and settings screens.

## Phase 2: Right-Side Agent Workbench

Duration: 7-10 days

Goals:

- Add a collapsible right-side workbench panel.
- Support three initial tabs or views:
  - Tool Activity
  - Diff
  - Preview
- Keep the chat timeline cleaner by moving detailed inspection into the
  workbench.

Why it matters:

- This is the highest-value Proma-inspired feature for GuGu.
- When an agent edits files or runs commands, users need a stable place to
  inspect the work without scrolling through a long chat transcript.

Deliverables:

- `WorkbenchPanel`
- `ToolActivityList`
- `FileChangeList`
- `DiffPreview`
- `FilePreview`
- Chat-to-workbench linking for tool cards and file names

Acceptance criteria:

- After an agent modifies files, the right panel shows changed files and diffs.
- Bash, Edit, Write, MultiEdit, Task, and related events are grouped into a
  readable activity list.
- Long-running agent tasks no longer flood the main chat with excessive tool
  details.
- The panel is collapsible and does not block the composer on smaller screens.

Risks:

- Diff data must be reliable. Start with existing tool output and `git diff`
  rather than a new file-history system.
- Large diffs need truncation or lazy rendering.

## Phase 3: File Preview And Attachment Workflow

Duration: 6-9 days

Goals:

- Separate "parse this for the model" from "preview this for the user".
- Preview uploaded files and agent-generated files in the workbench.
- First version supports:
  - images
  - Markdown
  - text and code
  - basic PDF preview
  - GLM parsed Markdown result
- Later version can add:
  - DOCX
  - XLSX
  - PPTX

Deliverables:

- Attachment preview model.
- File type detection.
- `PreviewRenderer` dispatcher.
- GLM parser integration showing:
  - original file
  - parsed Markdown
  - text sent to the main model

Acceptance criteria:

- For image uploads, chat history shows only the user's real prompt while the
  workbench can show the original image and GLM parse result.
- For PDF uploads, the workbench can show a parsed Markdown view.
- Parser failures remain neutral chat notices, not red error boxes.

Risks:

- Office preview can grow quickly. Do not support every format in the first
  pass.
- Check package size, license, and Tauri bundling impact before adding local
  document rendering libraries.

## Phase 4: Config Backup, Import, And Share

Duration: 5-7 days

Goals:

- Create a GuGu configuration backup package for migration and sharing.
- Export and import:
  - provider list, without plaintext API keys by default
  - GLM parser config, with keys masked unless explicitly included
  - MCP config
  - Skills and Plugins list
  - Agents config
  - GUI preferences
- Show an import preview before applying changes.

Deliverables:

- `gugu-config-export.json` format.
- Export API.
- Import API.
- Settings UI for export/import.
- Sensitive field masking rules.

Acceptance criteria:

- Users can export the current GuGu config.
- A fresh environment can import non-sensitive provider, MCP, Skills, Plugins,
  Agents, and GUI preferences.
- API keys are not included by default.
- Import preview shows additions, overwrites, and skipped items.

Risks:

- Config is spread across `.claude`, GuGu-specific config, plugin cache, and MCP
  files.
- Never include secrets in a share package by default.

## Phase 5: Session Checkpoints And Fork

Duration: 7-10 days

Goals:

- Give long agent sessions a safer recovery model.
- Let users fork a new conversation from a previous history point.
- Add lightweight checkpoints around:
  - before user send
  - before file-writing tools
  - after a completed task group

Deliverables:

- Checkpoint metadata.
- `Fork from here` action.
- Timeline list for checkpoints.
- Optional workbench comparison between checkpoints.

Acceptance criteria:

- Users can start a new session from an older message.
- Forking does not mutate the original session.
- File changes are shown as context, not automatically reverted.

Risks:

- Do not implement automatic filesystem rollback in the first version.
- First pass should fork conversation context only.

## Phase 6: Domestic Models, Remote Channels, And Voice Input

Duration: 2-4 weeks, recommended later

Goals:

- Expand domestic model presets and routing:
  - DeepSeek flash/pro templates
  - GLM/Zhipu chat and agent-compatible templates
  - Kimi and Kimi Coding Plan templates
  - Qwen/Tongyi templates
  - Doubao templates
  - MiniMax templates
- Improve custom endpoint setup for OpenAI-compatible and
  Anthropic-compatible APIs.
- Remote channels such as Lark/Feishu, DingTalk, WeChat bridge, or Telegram.
- Desktop voice input with cancel and edit before send.

Why later:

- These features look impressive but have heavy stability, permission, account,
  notification, and security requirements.
- GuGu should first make the local desktop agent workflow excellent.
- Provider presets are useful, but the core provider abstraction already works;
  the UI/workbench polish should land first.

Acceptance criteria:

- Domestic model presets can be added without editing JSON by hand.
- Agent-compatible providers clearly indicate which protocol they use.
- Fast/pro model routing works for providers that expose both tiers.
- Remote messages do not leak local paths or secrets.
- Remote tasks have explicit permission boundaries.
- Voice input is editable and never auto-sends without user intent.

## Suggested Calendar

| Week | Phase | Main output |
| --- | --- | --- |
| Week 1 | Phase 0 + Phase 1 | Design, capability bar, draft autosave, long paste handling |
| Week 2 | Phase 1.5 | Conversation UI polish, palette cleanup, compact tool feedback |
| Week 3 | Phase 2 part 1 | Workbench shell and tool activity grouping |
| Week 4 | Phase 2 part 2 | Diff view, file list, chat-to-workbench linking |
| Week 5 | Phase 3 | Image/text/Markdown/PDF/GLM result preview |
| Week 6 | Phase 4 | Config export, import preview, secret masking |
| Week 7 | Phase 4 finish + Phase 5 design | Config polish and session fork design |
| Week 8 | Phase 5 | Session fork, checkpoints, recovery UX |
| Week 9+ | Phase 6 or polish | Domestic model presets, remote channels, voice input, performance |

## Priority

P0:

- Capability state display
- Conversation UI polish
- Right-side workbench
- Diff and file preview
- GLM parse result preview
- Config export/import

P1:

- Draft autosave
- Long paste to attachment
- Session fork
- Tool activity grouping
- Domestic model preset templates

P2:

- Voice input
- Remote bot channels
- Team config distribution
- Full Office preview

## Branch Strategy

Use `feature-hwh-dev` as the long-running integration branch.

Suggested short-lived branches:

- `feat/capability-bar`
- `feat/conversation-ui-polish`
- `feat/agent-workbench`
- `feat/file-preview`
- `feat/config-portability`
- `feat/session-fork`

Merge each feature branch back into `feature-hwh-dev`. Merge `feature-hwh-dev`
to `dev` only after a stable checkpoint.

## Validation Strategy

For each desktop phase:

```powershell
cd desktop
bun run lint
bun run test
```

For server API changes:

```powershell
bun test src/server/__tests__/<related-test>.test.ts
```

For Tauri, workbench, or preview changes:

```powershell
.\restart-gugu-dev.cmd
```

Manual checklist:

- New sessions, old sessions, and restored history still work.
- The composer is not cramped by new controls.
- Long tasks do not flood the main chat.
- Recoverable failures appear as neutral notices.
- Config export does not include plaintext secrets by default.

## Non-Goals

- Do not copy Proma's full data directory or architecture.
- Do not ship remote channels in the first pass.
- Do not chase every international model provider; domestic providers are the
  default priority.
- Do not export API keys by default.
- Do not automatically roll back user filesystem changes.
- Do not support every Office format in the first file-preview version.

## Next Step

Start with Phase 0 and Phase 1. They are low-risk and immediately improve
main-screen clarity. Then do Phase 1.5 before the workbench so the daily chat
experience feels smoother first. After that, build Phase 2: the right-side Agent
Workbench. That should be the first major structural leap.
