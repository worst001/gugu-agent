---
name: rtk-token-saver
description: Use RTK only for supported noisy developer-output wrappers when a compact summary is enough: rtk test, rtk git status/diff/log/show, rtk grep, rtk find, rtk read, rtk tsc, rtk lint, and rtk vitest. Do not prefix arbitrary shell commands with rtk.
---

# RTK Token Saver

Use RTK to keep command output small and useful. RTK wraps specific developer commands and returns compact summaries, grouped failures, and deduplicated logs instead of dumping raw output into the conversation.

## Operating Rules

1. Prefer RTK only for supported broad or noisy developer output:
   - `rtk git status`
   - `rtk git diff`
   - `rtk git show`
   - `rtk git log`
   - `rtk grep <pattern> <path>`
   - `rtk find <pattern> <path>`
   - `rtk read <file>`
   - `rtk test <command>`
   - `rtk vitest`, `rtk tsc`, `rtk lint`
2. Use raw commands when exact output is required, the command is interactive, JSON must be machine-readable, or RTK does not support the command shape.
3. Never prefix arbitrary shell commands with `rtk`. In particular, do not use `rtk ls`, `rtk cd`, `rtk pwd`, `rtk mkdir`, `rtk rm`, `rtk cp`, `rtk mv`, `rtk npm`, `rtk bun install`, `rtk cargo`, `rtk powershell`, or `rtk ssh`.
4. RTK has wrappers beyond this list, but this Gugu skill intentionally avoids them for routine work. They can add permission prompts or hide exact output in user-facing workflows.
5. For directory listing or path inspection, use the native shell command directly: `Get-ChildItem` on Windows, `ls` on POSIX. RTK is not a general shell wrapper for Gugu.
6. This skill is guidance, not proof that RTK is installed. If `rtk --version` fails or `rtk` is not in PATH, silently fall back to the raw command unless the user specifically asked about RTK setup.
7. For failing tests, prefer `rtk test <actual test command>` so only the relevant failures are shown.
8. For source search, prefer CodeGraph for structural questions and RTK-backed `rg`/`grep` only for literal text.

## Usage Patterns From Official Docs

RTK's official usage is command-output compression. It is useful when a shell command would otherwise dump a lot of repetitive text into the AI context, and the compact summary is enough to decide the next step.

Good real-world uses:

- Test runs: `rtk test <command>`, `rtk vitest`, `rtk pytest`, or similar failure-focused summaries.
- Type/lint/build failures: `rtk tsc`, `rtk lint`, or a narrow `rtk test` wrapper for noisy build commands.
- Git inspection: `rtk git status`, `rtk git diff`, `rtk git log`, `rtk git show`.
- Broad literal search: `rtk grep <pattern> <path>` or `rtk find <pattern> <path>` when grouped/truncated output is acceptable.
- Long file inspection: `rtk read <file>` when a summary or capped read is enough.

Avoid using RTK for:

- Built-in agent tools such as `Read`, `Grep`, `Glob`, or `LS`; those do not automatically pass through RTK hook rewriting.
- Ordinary directory listing in user-facing flows. Use native `Get-ChildItem` / `ls` so paths and permissions behave predictably.
- Exact raw logs, exact JSON, interactive commands, setup/install commands, destructive commands, SSH, or commands where compressed output could hide the important detail.
- Arbitrary shell commands just because RTK exists. RTK is a filter for known noisy patterns, not a general command prefix.

## Command Patterns

Use these patterns by default:

```bash
rtk git status
rtk git diff
rtk grep "TODO" src
rtk find "*.ts" src
rtk test bun test
rtk tsc
```

Do not invent new `rtk <command>` forms. If the exact wrapper is not listed here, run the raw command instead.

When RTK output is too compressed for the next step, rerun the narrowest raw command needed for the missing detail. Do not rerun broad raw commands just to be safe.

## User-Facing Notes

When the user asks why output is shorter, explain that RTK reduces token usage by summarizing command output before it reaches the AI context. Keep the full raw command available for cases where exact logs matter.
