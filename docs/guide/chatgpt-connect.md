# ChatGPT Connect

ChatGPT Connect lets cc-haha use ChatGPT/Codex-backed GPT models without a traditional OpenAI API key.

The implementation follows OpenCode's Codex auth flow:

- OAuth issuer: `https://auth.openai.com`
- Browser callback: `http://localhost:1455/auth/callback`
- Token storage: `~/.claude/cc-haha/chatgpt-oauth.json` with `0600` permissions
- Inference endpoint: `https://chatgpt.com/backend-api/codex/responses`

## Usage

Desktop:

1. Open Settings → Providers.
2. Use ChatGPT Connect.
3. Complete the browser authorization flow.
4. cc-haha creates and activates the ChatGPT provider automatically.

CLI:

```bash
/connect
```

For environments where the browser cannot receive the local callback:

```bash
/connect --device
```

## Notes And Risks

- This depends on ChatGPT web OAuth and Codex backend behavior, which OpenAI can change or restrict.
- The OAuth client id is compatible with the OpenCode-style Codex flow, but it is not a normal OpenAI API key flow.
- Only local code should be able to read the stored refresh token. Do not sync `~/.claude/cc-haha/chatgpt-oauth.json` to shared storage.
- If port `1455` is occupied by another auth flow, connect will fail until that process exits.
