// Source: src/server/services/sessionService.ts

export type SessionListItem = {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  workDir: string | null
  workDirExists: boolean
  pinned?: boolean
  archived?: boolean
  unread?: boolean
}

export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  timestamp: string
  model?: string
  origin?: { kind?: string }
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}
