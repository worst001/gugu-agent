# RTK Integration

RTK is installed for this development machine and is used to reduce token-heavy shell output before it reaches an AI coding agent.

Use RTK for broad, noisy, or repeated command output:

- `rtk git status`, `rtk git diff`, `rtk git log`
- `rtk grep`, `rtk find`, `rtk ls`
- `rtk test <command>` for test runners when only failures matter
- `rtk vitest`, `rtk tsc`, `rtk cargo test`, and similar supported wrappers
- `rtk gain` and `rtk discover` when checking RTK savings or missed opportunities

Use the raw command when exact unfiltered output matters:

- commands whose output is consumed by another program
- JSON or other machine-readable output
- interactive commands
- commands where line-for-line logs are the subject of the task
- unsupported commands or any RTK parse ambiguity

The desktop app also prepends common user-local binary directories to the Claude CLI child process PATH so global RTK hooks can find `rtk` even when GuGu is launched from the Windows desktop instead of a terminal.
