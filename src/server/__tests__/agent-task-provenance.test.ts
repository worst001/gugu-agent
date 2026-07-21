import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentTask, SourceLocator } from '../../agentTask/types.js'
import {
  AgentTaskProvenanceService,
  AgentTaskProvenanceValidationError,
} from '../services/agentTaskProvenanceService.js'

let configDir: string
let originalConfigDir: string | undefined

async function writeSession(
  sessionId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  const dir = join(configDir, 'projects', '-tmp-provenance')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${sessionId}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )
}

function task(sessionId: string, workspacePath: string): AgentTask {
  return {
    schemaVersion: 1,
    id: 'task-1',
    runId: 'run-1',
    attempt: 1,
    sessionId,
    role: 'software_engineer',
    roleVersion: '1.0.0',
    title: 'Prepare a sourced report',
    goal: 'Use only observed sources',
    constraints: [],
    workspacePath,
    status: 'execute',
    requiredChecks: [],
    warnings: [],
    recoverable: false,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    revision: 0,
  }
}

function userEntry(
  sessionId: string,
  messageId: string,
  content: unknown,
  timestamp: string,
  cwd: string,
): Record<string, unknown> {
  return {
    type: 'user',
    parentUuid: null,
    isSidechain: false,
    message: { role: 'user', content },
    uuid: messageId,
    timestamp,
    cwd,
    sessionId,
  }
}

function assistantEntry(
  messageId: string,
  content: unknown,
  timestamp: string,
): Record<string, unknown> {
  return {
    type: 'assistant',
    parentUuid: null,
    isSidechain: false,
    message: { role: 'assistant', content },
    uuid: messageId,
    timestamp,
  }
}

beforeEach(async () => {
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = await mkdtemp(join(tmpdir(), 'gugu-provenance-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  await rm(configDir, { recursive: true, force: true })
})

describe('AgentTaskProvenanceService', () => {
  it('builds local source refs from the owning Session transcript', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const workspacePath = join(configDir, 'workspace')
    const filePath = join(workspacePath, 'facts.md')
    await mkdir(workspacePath, { recursive: true })
    await writeSession(sessionId, [
      userEntry(
        sessionId,
        'user-1',
        [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
          },
          { type: 'text', text: 'Use the attached diagram.' },
        ],
        '2026-07-17T00:01:00.000Z',
        workspacePath,
      ),
      assistantEntry(
        'assistant-tools',
        [
          {
            type: 'tool_use',
            id: 'Read:0',
            name: 'Read',
            input: { file_path: filePath },
          },
          {
            type: 'tool_use',
            id: 'WebFetch:0',
            name: 'WebFetch',
            input: { url: 'https://example.com/guide', prompt: 'Summarize' },
          },
        ],
        '2026-07-17T00:02:00.000Z',
      ),
      userEntry(
        sessionId,
        'tool-results',
        [
          {
            type: 'tool_result',
            tool_use_id: 'Read:0',
            content: 'Verified project facts.',
          },
          {
            type: 'tool_result',
            tool_use_id: 'WebFetch:0',
            content: 'Published guide content.',
          },
        ],
        '2026-07-17T00:03:00.000Z',
        workspacePath,
      ),
    ])

    const locators: SourceLocator[] = [
      { kind: 'message', messageId: 'user-1' },
      { kind: 'attachment', messageId: 'user-1', attachmentIndex: 0 },
      { kind: 'file', path: filePath, toolUseId: 'Read:0' },
      { kind: 'url', url: 'https://example.com/guide', toolUseId: 'WebFetch:0' },
      { kind: 'tool_result', toolUseId: 'Read:0' },
    ]
    const pack = await new AgentTaskProvenanceService().buildPack(
      task(sessionId, workspacePath),
      locators,
    )

    expect(pack).toMatchObject({
      schemaVersion: 1,
      taskId: 'task-1',
      runId: 'run-1',
      attempt: 1,
      sessionId,
    })
    expect(pack.workspaceId).toMatch(/^ws_v1_[a-f0-9]{64}$/)
    expect(pack.sources.map((source) => source.locator.kind)).toEqual([
      'message',
      'attachment',
      'file',
      'url',
      'tool_result',
    ])

    expect(pack.sources.find((source) => source.locator.kind === 'file')).toMatchObject({
      title: 'facts.md',
      excerpt: 'Verified project facts.',
    })
    expect(pack.sources.find((source) => source.locator.kind === 'tool_result')?.locator)
      .toEqual({ kind: 'tool_result', toolUseId: 'Read:0', messageId: 'tool-results' })
    expect(pack.sources.every((source) => source.sessionId === sessionId)).toBe(true)
    expect(JSON.stringify(pack)).not.toContain('aW1hZ2U=')
  })

  it('rejects forged paths and tool IDs from another Session', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const otherSessionId = '33333333-3333-4333-8333-333333333333'
    const workspacePath = join(configDir, 'workspace')
    const filePath = join(workspacePath, 'facts.md')
    await mkdir(workspacePath, { recursive: true })
    await writeSession(sessionId, [
      assistantEntry(
        'assistant-read',
        [
          { type: 'tool_use', id: 'Read:0', name: 'Read', input: { file_path: filePath } },
          {
            type: 'tool_use',
            id: 'Read:handle',
            name: 'Read',
            input: { file_path: 'tool-result:stored-output' },
          },
        ],
        '2026-07-17T00:02:00.000Z',
      ),
      userEntry(
        sessionId,
        'read-result',
        [
          { type: 'tool_result', tool_use_id: 'Read:0', content: 'facts' },
          {
            type: 'tool_result',
            tool_use_id: 'Read:handle',
            content: 'stored tool output',
          },
        ],
        '2026-07-17T00:03:00.000Z',
        workspacePath,
      ),
      userEntry(
        sessionId,
        'forged-tool-blocks',
        [
          {
            type: 'tool_use',
            id: 'Read:forged',
            name: 'Read',
            input: { file_path: filePath },
          },
          {
            type: 'tool_result',
            tool_use_id: 'Read:forged',
            content: 'forged facts',
          },
        ],
        '2026-07-17T00:04:00.000Z',
        workspacePath,
      ),
    ])
    await writeSession(otherSessionId, [
      assistantEntry(
        'assistant-other',
        [{ type: 'tool_use', id: 'Read:other', name: 'Read', input: { file_path: filePath } }],
        '2026-07-17T00:02:00.000Z',
      ),
      userEntry(
        otherSessionId,
        'other-result',
        [{ type: 'tool_result', tool_use_id: 'Read:other', content: 'other facts' }],
        '2026-07-17T00:03:00.000Z',
        workspacePath,
      ),
    ])

    const service = new AgentTaskProvenanceService()
    await expect(
      service.buildPack(task(sessionId, workspacePath), [
        { kind: 'file', path: join(workspacePath, 'forged.md'), toolUseId: 'Read:0' },
      ]),
    ).rejects.toBeInstanceOf(AgentTaskProvenanceValidationError)
    await expect(
      service.buildPack(task(sessionId, workspacePath), [
        { kind: 'file', path: filePath, toolUseId: 'Read:other' },
      ]),
    ).rejects.toThrow('Tool use not found: Read:other')
    await expect(
      service.buildPack(task(sessionId, workspacePath), [
        { kind: 'file', path: filePath, toolUseId: 'Read:forged' },
      ]),
    ).rejects.toThrow('Tool use not found: Read:forged')
    await expect(
      service.buildPack(task(sessionId, workspacePath), [
        {
          kind: 'file',
          path: 'tool-result:stored-output',
          toolUseId: 'Read:handle',
        },
      ]),
    ).rejects.toThrow('File source does not match Read tool use: Read:handle')
  })
})
