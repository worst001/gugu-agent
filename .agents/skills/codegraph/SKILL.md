---
name: codegraph
description: Use CodeGraph for local code knowledge graphs, architecture maps, symbol lookup, call graphs, dependency tracing, impact analysis, and questions like "how does X work", "where is X defined", "what calls Y", or "what breaks if I change Z". Prefer CodeGraph MCP tools or the codegraph CLI over grep/read loops for structural codebase exploration, and guide users to initialize .codegraph when missing.
---

# CodeGraph

Use CodeGraph as the first tool for structural codebase understanding. It builds a local, indexed code knowledge graph so the agent can answer architecture and flow questions without repeatedly scanning files.

## Best-Fit Scenarios

Use CodeGraph when the user is asking for relationships, not text:

- Architecture maps and "how does this area work?"
- "Where is this symbol defined?"
- "What calls this function?" / "What does this function call?"
- "How does X reach Y?"
- "What breaks if I change this?"
- Affected tests, impact radius, route/controller entry points, or framework wiring.
- Large codebases where repeated `Glob`/`Grep`/`Read` exploration would waste many turns.

Do not use CodeGraph as the first move for:

- Exact UI copy, logs, comments, config keys, env vars, or user-visible strings.
- Newly edited files that may not have reached the index yet.
- Non-code assets or generated output where a direct file read is clearer.
- Tasks where the user only wants a terminal command, file listing, or exact raw output.

## Usage Patterns From Official Docs

CodeGraph's own examples position it as a semantic code-intelligence layer: the agent should query the local index for entry points, symbol relationships, call graphs, and impact radius instead of exploring a large repository with repeated `find`/`grep`/`read` calls.

Good real-world uses:

- Feature work: map the relevant area first, then inspect the few surfaced files before editing.
- Bug fixing: trace how data or control reaches a failing function, handler, component, or service.
- Code review and refactoring: check callers, callees, dependency impact, and affected tests before changing shared code.
- Architecture onboarding: produce a concise map of modules, entry points, and relationships for a large or unfamiliar codebase.

Avoid using CodeGraph for:

- Literal search tasks such as UI copy, error messages, config keys, logs, comments, or exact filenames.
- Tiny one-file tasks where reading the file directly is clearer than querying an index.
- Directory browsing, attachment handling, shell execution, or file-system operations.
- Fresh generated files or edits that may not have synced into the index yet.

## Operating Rules

1. Prefer available CodeGraph MCP tools when the session exposes them:
   - `codegraph_context` for broad task context.
   - `codegraph_search` for symbol lookup by name.
   - `codegraph_trace` for a call path from one symbol to another.
   - `codegraph_callers`, `codegraph_callees`, and `codegraph_impact` for dependency questions.
   - `codegraph_explore` when several related source snippets are needed at once.
2. This skill is guidance, not proof that CodeGraph is installed. Do not claim CodeGraph is available unless an MCP tool is exposed or `codegraph --version` succeeds.
3. If MCP tools are not available, check `codegraph --version` only when the user specifically wants CodeGraph, a knowledge graph, architecture mapping, call tracing, or large-codebase exploration. If the command is missing, briefly say CodeGraph is not installed and fall back to normal code inspection unless the user asks how to install it.
4. If the project has no `.codegraph/` directory and the user wants a knowledge graph, architecture map, or flow analysis, ask to initialize it with `codegraph init -i`. After initializing or changing MCP configuration, the agent may need to restart before tools appear.
5. Use native search only for literal text, user-facing copy, comments, log messages, config keys, or when CodeGraph cannot answer the question.
6. Do not spawn separate explorer agents just to inspect files when CodeGraph can answer directly. Query the graph first, then read only the files that remain necessary.

## Suggested Workflow

For architecture or "how does this work" requests:

1. Run `codegraph_context` with the task description.
2. Run one focused `codegraph_explore` for the surfaced symbols/files.
3. Answer with the main entry points, relationships, and concrete file references.
4. Include a Mermaid graph when the user asks for a knowledge graph or when a visual map would make the flow clearer.

For change-impact requests:

1. Run `codegraph_impact` on the symbol to be changed.
2. Inspect the highest-risk callers with `codegraph_explore`.
3. Summarize affected modules, tests to run, and compatibility risks.

For affected-test questions:

1. Prefer `codegraph_impact` or the CLI `codegraph affected` flow if MCP does not expose a dedicated affected-tests tool.
2. Treat the result as a candidate test set, not proof that no other tests matter.

For missing or stale indexes:

1. If `.codegraph/` is missing, initialize with `codegraph init -i` after user approval.
2. If recent edits are not visible, wait briefly or tell the user the index may still be syncing.
3. If CodeGraph reports unsupported files, fall back to `rg` and direct reads for that part only.
4. If indexing is slow or noisy, suggest excluding heavy directories such as `node_modules`, build outputs, and generated artifacts.

## Good Local Examples

- Good: "Explain the checkout flow" -> `codegraph_context`, then one `codegraph_explore`.
- Good: "Who calls `fulfillOrder`?" -> `codegraph_callers`.
- Good: "What happens if I change `glob()`?" -> `codegraph_impact`.
- Bad: "Find the exact text 'Claude Desktop'" -> use `rg`, because this is literal copy.
- Bad: "List files in this folder" -> use native shell listing, not CodeGraph.

## User-Facing Notes

Explain that CodeGraph is local: it indexes source code on the user's machine and does not require uploading code to a remote service. Keep the explanation short unless the user asks how it works.
