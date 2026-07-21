import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonlAgentTaskEventLog } from '../../agentTask/events/jsonlEventLog.js'
import { AgentTaskService } from '../../agentTask/service.js'
import type { AgentTask } from '../../agentTask/types.js'
import {
  handleAgentTasksApi,
  setAgentTaskServiceForTests,
} from '../api/agent-tasks.js'
import { handleApiRequest } from '../router.js'

const originalFlag = process.env.CC_GUGU_AGENT_TASK_RUNTIME
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
let tempDir: string
let service: AgentTaskService

async function writeSession(
  sessionId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  const dir = join(tempDir, 'projects', '-tmp-agent-task-api')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, sessionId + '.jsonl'),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  )
}

async function callApi(
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<Response> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const url = new URL(req.url)
  return handleAgentTasksApi(
    req,
    url,
    url.pathname.split('/').filter(Boolean),
  )
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'agent-task-api-test-'))
  service = new AgentTaskService(new JsonlAgentTaskEventLog(tempDir))
  setAgentTaskServiceForTests(service)
  process.env.CC_GUGU_AGENT_TASK_RUNTIME = '1'
  process.env.CLAUDE_CONFIG_DIR = tempDir
})

afterEach(async () => {
  setAgentTaskServiceForTests(null)
  if (originalFlag === undefined) {
    delete process.env.CC_GUGU_AGENT_TASK_RUNTIME
  } else {
    process.env.CC_GUGU_AGENT_TASK_RUNTIME = originalFlag
  }
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await rm(tempDir, { recursive: true, force: true })
})

describe('AgentTask API', () => {
  it('routes capability discovery through the main API router', async () => {
    const req = new Request('http://localhost/api/agent-tasks/capabilities')
    const response = await handleApiRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      enabled: true,
      roles: [
        'software_engineer',
        'knowledge_worker',
        'short_video_operator',
      ],
      rolePacks: [
        {
          id: 'software_engineer',
          version: '1.0.0',
          displayName: 'Software Engineer',
        },
        {
          id: 'knowledge_worker',
          version: '1.0.0',
          displayName: 'Knowledge Worker',
        },
        {
          id: 'short_video_operator',
          version: '1.0.0',
          displayName: 'Short Video Operator',
        },
      ],
      teams: [
        {
          id: 'software_delivery',
          version: '1.0.0',
          primaryRole: 'software_engineer',
        },
        {
          id: 'knowledge_delivery',
          version: '1.0.0',
          primaryRole: 'knowledge_worker',
        },
        {
          id: 'short_video_production',
          version: '1.0.0',
          primaryRole: 'short_video_operator',
        },
      ],
    })
  })

  it('exposes capability but hides the runtime while the flag is off', async () => {
    delete process.env.CC_GUGU_AGENT_TASK_RUNTIME

    const capability = await callApi('/api/agent-tasks/capabilities')
    expect(capability.status).toBe(200)
    expect(await capability.json()).toMatchObject({ enabled: false })

    const list = await callApi('/api/agent-tasks')
    expect(list.status).toBe(404)
  })

  it('rejects a non-object JSON body without returning 500', async () => {
    const req = new Request('http://localhost/api/agent-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    const url = new URL(req.url)

    const response = await handleAgentTasksApi(
      req,
      url,
      url.pathname.split('/').filter(Boolean),
    )

    expect(response.status).toBe(400)
  })
  it('rejects invalid nested request fields', async () => {
    const response = await callApi('/api/agent-tasks', 'POST', {
      title: 'Invalid request',
      goal: 'Must not reach the service',
      sessionId: 'session-api',
      workspacePath: 'D:/workspace',
      constraints: 'not-an-array',
      requiredChecks: [],
    })

    expect(response.status).toBe(400)
  })
  it('lets a product-created task declare checks during REST planning', async () => {
    const create = await callApi('/api/agent-tasks', 'POST', {
      title: 'Prepare report',
      goal: 'Create a verified report',
      sessionId: 'session-product-created',
      workspacePath: 'D:/workspace',
      role: 'knowledge_worker',
    })
    expect(create.status).toBe(201)
    const created = (await create.json() as { task: { id: string } }).task

    await callApi('/api/agent-tasks/' + created.id + '/begin', 'POST', {})
    await callApi('/api/agent-tasks/' + created.id + '/scout', 'POST', {
      summary: 'Located source material.',
    })
    const plan = await callApi(
      '/api/agent-tasks/' + created.id + '/plan',
      'POST',
      {
        requiredChecks: [{
          id: 'artifact',
          label: 'Report exists',
          command: 'test -f report.md',
          required: true,
        }],
        plan: {
          summary: 'Create and verify the report.',
          steps: ['Write report', 'Verify report'],
          verificationCheckIds: ['artifact'],
        },
      },
    )

    expect(plan.status).toBe(200)
    expect(await plan.json()).toMatchObject({
      task: {
        status: 'execute',
        requiredChecks: [{ id: 'artifact', required: true }],
      },
    })
  })

  it('accepts local assistant metadata through the REST create contract', async () => {
    const response = await callApi('/api/agent-tasks', 'POST', {
      title: 'Prepare launch brief',
      goal: 'Create a verified launch brief',
      sessionId: 'session-assistant-api',
      workspacePath: 'D:/workspace',
      teamId: 'knowledge_delivery',
      taskTemplateId: 'document_delivery',
      role: 'knowledge_worker',
      assistantOverlay: {
        id: 'custom-launch',
        name: 'Launch planner',
        baseRole: 'knowledge_worker',
        sourceUpdatedAt: '2026-07-20T00:00:00.000Z',
        instructions: 'Use concise sections and preserve sources.',
      },
      requiredChecks: [{
        id: 'verify',
        label: 'Verify output',
        command: 'test -f launch.md',
        required: true,
      }],
    })
    const { task } = (await response.json()) as { task: AgentTask }

    expect(response.status).toBe(201)
    expect(task).toMatchObject({
      role: 'knowledge_worker',
      assistantId: 'custom-launch',
      assistantName: 'Launch planner',
      definitionSnapshot: {
        team: { id: 'knowledge_delivery', version: '1.0.0' },
        taskTemplate: { id: 'document_delivery', version: '1.0.0' },
        workflow: { id: 'verified_delivery', version: '1.0.0' },
        roles: [{
          role: 'knowledge_worker',
          assistant: {
            id: 'custom-launch',
            instructions: 'Use concise sections and preserve sources.',
          },
        }],
      },
    })
  })
  it('records an explicit fatal workflow failure', async () => {
    const create = await callApi('/api/agent-tasks', 'POST', {
      title: 'Fatal workflow error',
      goal: 'Record the failed attempt',
      sessionId: 'session-failed',
      workspacePath: 'D:/workspace',
      requiredChecks: [
        {
          id: 'tests',
          label: 'Regression test',
          command: 'bun test',
          required: true,
        },
      ],
    })
    const { task } = (await create.json()) as { task: AgentTask }

    const failed = await callApi(
      '/api/agent-tasks/' + task.id + '/fail',
      'POST',
      { reason: 'Fatal scout error' },
    )
    const payload = (await failed.json()) as { task: AgentTask }

    expect(failed.status).toBe(200)
    expect(payload.task.status).toBe('failed')
  })
  it('persists trusted sources locally and reads them after restart', async () => {
    const sessionId = '44444444-4444-4444-8444-444444444444'
    const workspacePath = join(tempDir, 'workspace')
    const filePath = join(workspacePath, 'facts.md')
    await mkdir(workspacePath, { recursive: true })
    await writeFile(filePath, 'Verified project facts.\n', 'utf8')
    await writeSession(sessionId, [
      {
        type: 'user',
        parentUuid: null,
        isSidechain: false,
        message: { role: 'user', content: 'Use the verified facts.' },
        uuid: 'user-source',
        timestamp: '2026-07-17T00:01:00.000Z',
        cwd: workspacePath,
        sessionId,
      },
      {
        type: 'assistant',
        parentUuid: 'user-source',
        isSidechain: false,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'Read:api',
              name: 'Read',
              input: { file_path: filePath },
            },
          ],
        },
        uuid: 'assistant-read',
        timestamp: '2026-07-17T00:02:00.000Z',
      },
      {
        type: 'user',
        parentUuid: 'assistant-read',
        isSidechain: false,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'Read:api',
              content: 'Verified project facts.',
            },
          ],
        },
        uuid: 'read-result',
        timestamp: '2026-07-17T00:03:00.000Z',
        cwd: workspacePath,
        sessionId,
      },
    ])

    const create = await callApi('/api/agent-tasks', 'POST', {
      title: 'Prepare a sourced report',
      goal: 'Use only observed sources',
      sessionId,
      workspacePath,
      requiredChecks: [
        {
          id: 'sources',
          label: 'Validate source trace',
          command: 'bun test provenance',
          required: true,
        },
      ],
    })
    expect(create.status).toBe(201)
    const { task } = (await create.json()) as { task: AgentTask }
    const eventsBefore = (await service.getTaskDetail(task.id)).events

    const missing = await callApi(
      '/api/agent-tasks/' + task.id + '/provenance',
    )
    expect(await missing.json()).toEqual({ provenancePack: null })

    const unverifiableAttachmentPath = await callApi(
      '/api/agent-tasks/' + task.id + '/provenance',
      'POST',
      {
        sources: [{
          kind: 'attachment',
          messageId: 'user-source',
          attachmentIndex: 0,
          path: filePath,
        }],
      },
    )
    expect(unverifiableAttachmentPath.status).toBe(400)

    const persisted = await callApi(
      '/api/agent-tasks/' + task.id + '/provenance',
      'POST',
      {
        sources: [
          { kind: 'message', messageId: 'user-source' },
          { kind: 'file', path: filePath, toolUseId: 'Read:api' },
        ],
      },
    )
    expect(persisted.status).toBe(201)
    const payload = (await persisted.json()) as {
      provenancePack: {
        id: string
        taskId: string
        runId: string
        sources: Array<{ locator: { kind: string } }>
      }
    }
    expect(payload.provenancePack).toMatchObject({
      taskId: task.id,
      runId: task.runId,
    })
    expect(payload.provenancePack.sources.map((source) => source.locator.kind))
      .toEqual(['message', 'file'])

    const stored = JSON.parse(await readFile(
      join(
        tempDir,
        task.id,
        'provenance',
        payload.provenancePack.id + '.json',
      ),
      'utf8',
    )) as { id: string }
    expect(stored.id).toBe(payload.provenancePack.id)

    const refreshedService = new AgentTaskService(service.eventLog)
    setAgentTaskServiceForTests(refreshedService)
    const recovered = await callApi(
      '/api/agent-tasks/' + task.id + '/provenance',
    )
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual(payload)
    const recoveredDetail = await callApi('/api/agent-tasks/' + task.id)
    expect(await recoveredDetail.json()).toMatchObject({
      provenancePack: payload.provenancePack,
    })
    expect((await refreshedService.getTaskDetail(task.id)).events)
      .toEqual(eventsBefore)

    const forged = await callApi(
      '/api/agent-tasks/' + task.id + '/provenance',
      'POST',
      {
        sources: [
          { kind: 'file', path: join(workspacePath, 'forged.md'), toolUseId: 'Read:api' },
        ],
      },
    )
    expect(forged.status).toBe(400)

    await refreshedService.failTask(task.id, 'Source collection stopped')
    const terminalWrite = await callApi(
      '/api/agent-tasks/' + task.id + '/provenance',
      'POST',
      {
        sources: [
          { kind: 'message', messageId: 'user-source' },
        ],
      },
    )
    expect(terminalWrite.status).toBe(400)
  })
  it('runs a golden Bugfix Task through the complete REST lifecycle', async () => {
    const create = await callApi('/api/agent-tasks', 'POST', {
      title: 'Fix API regression',
      goal: 'Restore the expected response',
      sessionId: 'session-api',
      workspacePath: 'D:/workspace',
      requiredChecks: [
        {
          id: 'tests',
          label: 'Regression test',
          command: 'bun test regression.test.ts',
          required: true,
        },
      ],
    })
    expect(create.status).toBe(201)
    const { task: created } = (await create.json()) as { task: AgentTask }

    await callApi(`/api/agent-tasks/${created.id}/begin`, 'POST', {})
    await callApi(`/api/agent-tasks/${created.id}/scout`, 'POST', {
      summary: 'Found the failing response mapper.',
    })
    await callApi(`/api/agent-tasks/${created.id}/plan`, 'POST', {
      plan: {
        summary: 'Patch the mapper and run the regression test.',
        steps: ['Patch response mapper', 'Run regression test'],
        verificationCheckIds: ['tests'],
      },
    })
    await callApi(`/api/agent-tasks/${created.id}/execution`, 'POST', {
      summary: 'Patched the response mapper.',
    })

    const refreshedService = new AgentTaskService(service.eventLog)
    setAgentTaskServiceForTests(refreshedService)
    const detailBeforeVerification = await callApi(
      `/api/agent-tasks/${created.id}`,
    )
    const before = (await detailBeforeVerification.json()) as {
      task: AgentTask
    }
    expect(before.task.status).toBe('verify')

    const verification = await callApi(
      `/api/agent-tasks/${created.id}/verification`,
      'POST',
      {
        results: [
          {
            checkId: 'tests',
            command: 'bun test regression.test.ts',
            status: 'passed',
            exitCode: 0,
            stdout: '1 pass',
            stderr: '',
            startedAt: '2026-07-13T00:00:00.000Z',
            completedAt: '2026-07-13T00:00:01.000Z',
            durationMs: 1000,
          },
        ],
        changedFiles: ['src/responseMapper.ts'],
      },
    )
    expect(verification.status).toBe(200)

    const invalidReview = await callApi(
      '/api/agent-tasks/' + created.id + '/review',
      'POST',
      { status: 'approved' },
    )
    expect(invalidReview.status).toBe(400)
    const review = await callApi(
      `/api/agent-tasks/${created.id}/review`,
      'POST',
      {
        status: 'unavailable',
        summary: 'Reviewer unavailable in the test fixture.',
      },
    )
    const { task: completed } = (await review.json()) as { task: AgentTask }
    expect(completed.status).toBe('completed')

    const sessionTasks = await callApi(
      '/api/agent-tasks?sessionId=session-api',
    )
    const list = (await sessionTasks.json()) as { tasks: AgentTask[] }
    expect(list.tasks).toHaveLength(1)
    expect(list.tasks[0].evidencePackId).toBeDefined()

    const followupResponse = await callApi('/api/agent-tasks', 'POST', {
      title: 'Prevent another response regression',
      goal: 'Reuse the prior response mapper fix',
      sessionId: 'session-followup',
      workspacePath: 'D:/workspace',
      requiredChecks: [
        {
          id: 'tests',
          label: 'Regression test',
          command: 'bun test regression.test.ts',
          required: true,
        },
      ],
    })
    const { task: followup } = (await followupResponse.json()) as {
      task: AgentTask
    }
    const knowledgeResponse = await callApi(
      '/api/agent-tasks/' +
        followup.id +
        '/knowledge-context?query=response%20mapper&limit=2',
    )
    expect(await knowledgeResponse.json()).toMatchObject({
      knowledgeContext: {
        query: 'response mapper',
        truncated: false,
        items: [
          {
            sourceTaskId: created.id,
            state: 'pending',
            text: 'Patched the response mapper.',
          },
        ],
      },
    })
    const mapResponse = await callApi(
      '/api/agent-tasks/' + followup.id + '/knowledge-map',
    )
    expect(await mapResponse.json()).toMatchObject({
      knowledgeMap: {
        summary: {
          taskCount: 1,
          candidateCount: 1,
          potentialConflictCount: 0,
          truncated: false,
        },
        tasks: [{ taskId: created.id }],
        knowledgeItems: [{ taskId: created.id }],
      },
    })

    const workspaceMapResponse = await callApi(
      '/api/agent-tasks/workspace-knowledge?workspacePath=' +
        encodeURIComponent('D:/workspace'),
    )
    expect(workspaceMapResponse.status).toBe(200)
    expect(await workspaceMapResponse.json()).toMatchObject({
      knowledgeMap: {
        workspaceId: expect.stringMatching(/^ws_v1_[a-f0-9]{64}$/),
        tasks: [{ taskId: created.id }],
      },
    })

    const missingWorkspace = await callApi(
      '/api/agent-tasks/workspace-knowledge',
    )
    expect(missingWorkspace.status).toBe(400)
    const invalidLimit = await callApi(
      '/api/agent-tasks/' + followup.id + '/knowledge-context?limit=0',
    )
    expect(invalidLimit.status).toBe(400)
  })
})
