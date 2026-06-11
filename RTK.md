# RTK Integration

RTK is Gugu's preferred command-output compression helper. Desktop release builds should make an app-managed `rtk` available on the Claude child process PATH so normal users get the token-saving behavior without installing anything globally. Development machines may also provide `rtk` from a user-local install.

Use RTK for broad, noisy, or repeated command output when `rtk` is available:

- `rtk git status`, `rtk git diff`, `rtk git log`
- `rtk grep`, `rtk find`, `rtk read`
- `rtk test <command>` for test runners when only failures matter
- `rtk vitest`, `rtk tsc`, `rtk cargo test`, and similar supported wrappers

Use the raw command when exact unfiltered output matters:

- `rtk --version` or command lookup fails in an old build or local dev environment
- commands whose output is consumed by another program
- JSON or other machine-readable output
- interactive commands
- commands where line-for-line logs are the subject of the task
- unsupported commands or any RTK parse ambiguity

If RTK is unavailable, silently fall back to the raw command. Do not ask normal users to install RTK; missing RTK is a Gugu packaging/runtime issue, not a user setup task.

The desktop app prepends the verified app-managed RTK directory to child process PATH. Release validation must verify `rtk --version` and a supported wrapper such as `rtk git status` inside a desktop-launched session before publishing.
