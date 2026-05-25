# Global Usage (Run from Any Directory)


If you want to run `cc-gugu` directly from any project directory, set up one of the following. Once configured, `cc-gugu` will automatically recognize your current working directory. The older `claude-gugu` entrypoint remains available for compatibility.

## macOS / Linux

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Option 1: Add to PATH (recommended)
export PATH="$HOME/path/to/claude-code-gugu/bin:$PATH"

# Option 2: Alias
alias cc-gugu="$HOME/path/to/claude-code-gugu/bin/cc-gugu"
```

Then reload the config:

```bash
source ~/.bashrc  # or source ~/.zshrc
```

## Windows (Git Bash)

Add to `~/.bashrc`:

```bash
export PATH="$HOME/path/to/claude-code-gugu/bin:$PATH"
```

## Verify

After setup, navigate to any project directory and test:

```bash
cd ~/your-other-project
cc-gugu
# Ask "What is the current directory?" — it should show ~/your-other-project
```
