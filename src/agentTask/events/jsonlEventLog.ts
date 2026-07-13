import { randomUUID } from 'crypto'
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import * as lockfile from '../../utils/lockfile.js'
import {
  AGENT_TASK_EVENT_TYPES,
  type AgentTaskEvent,
  type AppendAgentTaskEventInput,
} from '../types.js'

const LOCK_OPTIONS = {
  retries: {
    retries: 30,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function isAgentTaskEvent(value: unknown): value is AgentTaskEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<AgentTaskEvent>
  return (
    event.schemaVersion === 1 &&
    typeof event.eventId === 'string' &&
    typeof event.sequence === 'number' &&
    Number.isInteger(event.sequence) &&
    event.sequence > 0 &&
    typeof event.taskId === 'string' &&
    typeof event.runId === 'string' &&
    typeof event.attempt === 'number' &&
    Number.isInteger(event.attempt) &&
    event.attempt > 0 &&
    typeof event.type === 'string' &&
    AGENT_TASK_EVENT_TYPES.includes(
      event.type as (typeof AGENT_TASK_EVENT_TYPES)[number],
    ) &&
    typeof event.timestamp === 'string' &&
    !!event.payload &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload)
  )
}

type ParsedLog = {
  events: AgentTaskEvent[]
  hadMalformedTail: boolean
}

export class AgentTaskEventConflictError extends Error {
  constructor(taskId: string, expected: number, actual: number) {
    super(`AgentTask revision conflict for ${taskId}: expected ${expected}, found ${actual}`)
    this.name = 'AgentTaskEventConflictError'
  }
}

export class AgentTaskLogCorruptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTaskLogCorruptionError'
  }
}

function parseEventLog(content: string, taskId: string): ParsedLog {
  const lines = content.split(/\r?\n/)
  const nonEmpty = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
  const lastLineIndex = nonEmpty.at(-1)?.index ?? -1
  const events: AgentTaskEvent[] = []
  const eventIds = new Set<string>()

  for (const { line, index } of nonEmpty) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      if (index === lastLineIndex) {
        return { events, hadMalformedTail: true }
      }
      throw new AgentTaskLogCorruptionError(
        `Malformed AgentTask event at ${taskId}:${index + 1}`,
      )
    }

    if (!isAgentTaskEvent(parsed)) {
      throw new AgentTaskLogCorruptionError(
        `Invalid AgentTask event at ${taskId}:${index + 1}`,
      )
    }

    if (parsed.taskId !== taskId) {
      throw new AgentTaskLogCorruptionError(
        `AgentTask identity mismatch at ${taskId}:${index + 1}`,
      )
    }

    const expectedSequence = events.length + 1
    if (parsed.sequence !== expectedSequence) {
      throw new AgentTaskLogCorruptionError(
        `AgentTask sequence gap at ${taskId}:${index + 1}`,
      )
    }

    if (eventIds.has(parsed.eventId)) {
      throw new AgentTaskLogCorruptionError(
        `Duplicate AgentTask eventId at ${taskId}:${index + 1}`,
      )
    }

    eventIds.add(parsed.eventId)
    events.push(parsed)
  }

  return { events, hadMalformedTail: false }
}

export class JsonlAgentTaskEventLog {
  readonly rootDir: string

  constructor(rootDir = join(getClaudeConfigHomeDir(), 'agent-tasks')) {
    this.rootDir = rootDir
  }

  getTaskDir(taskId: string): string {
    return join(this.rootDir, sanitizePathComponent(taskId))
  }

  getEventsPath(taskId: string): string {
    return join(this.getTaskDir(taskId), 'events.jsonl')
  }

  async listTaskIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return []
      throw error
    }
  }

  async readTaskEvents(taskId: string): Promise<AgentTaskEvent[]> {
    try {
      const content = await readFile(this.getEventsPath(taskId), 'utf8')
      return parseEventLog(content, taskId).events
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return []
      throw error
    }
  }

  async append(
    input: AppendAgentTaskEventInput,
    expectedRevision?: number,
  ): Promise<AgentTaskEvent> {
    const taskDir = this.getTaskDir(input.taskId)
    await mkdir(taskDir, { recursive: true })

    const lockPath = join(taskDir, '.events.lock')
    await appendFile(lockPath, '')

    let release: (() => Promise<void>) | undefined
    try {
      release = await lockfile.lock(lockPath, LOCK_OPTIONS)
      const eventsPath = this.getEventsPath(input.taskId)
      let parsed: ParsedLog
      try {
        parsed = parseEventLog(
          await readFile(eventsPath, 'utf8'),
          input.taskId,
        )
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) throw error
        parsed = { events: [], hadMalformedTail: false }
      }

      if (
        expectedRevision !== undefined &&
        parsed.events.length !== expectedRevision
      ) {
        throw new AgentTaskEventConflictError(
          input.taskId,
          expectedRevision,
          parsed.events.length,
        )
      }

      if (parsed.hadMalformedTail) {
        const tempPath = `${eventsPath}.${randomUUID()}.tmp`
        const repaired = parsed.events.length
          ? `${parsed.events.map((event) => JSON.stringify(event)).join('\n')}\n`
          : ''
        await writeFile(tempPath, repaired, 'utf8')
        await rename(tempPath, eventsPath)
      }

      const event: AgentTaskEvent = {
        schemaVersion: 1,
        eventId: randomUUID(),
        sequence: parsed.events.length + 1,
        taskId: input.taskId,
        runId: input.runId,
        attempt: input.attempt,
        type: input.type,
        timestamp: input.timestamp ?? new Date().toISOString(),
        payload: input.payload,
      }

      const handle = await open(eventsPath, 'a')
      try {
        await handle.write(`${JSON.stringify(event)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }

      return event
    } finally {
      await release?.()
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    const taskDir = this.getTaskDir(taskId)
    const eventsPath = this.getEventsPath(taskId)
    try {
      await unlink(eventsPath)
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
    }
    try {
      await unlink(join(taskDir, '.events.lock'))
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
    }
  }
}