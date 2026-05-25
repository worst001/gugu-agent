/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only default session cwd when ~/.claude/settings.json has no defaultSessionWorkDir */
  readonly VITE_DEFAULT_SESSION_WORKDIR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
