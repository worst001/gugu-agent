import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
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
let tempDir: string
let service: AgentTaskService

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
})

afterEach(async () => {
  setAgentTaskServiceForTests(null)
  if (originalFlag === undefined) {
    delete process.env.CC_GUGU_AGENT_TASK_RUNTIME
  } else {
    process.env.CC_GUGU_AGENT_TASK_RUNTIME = originalFlag
  }
  await rm(tempDir, { recursive: true, force: true })
})

describe('AgentTask API', () => {
  it('routes capability discovery through the main API router', async () => {
    const req = new Request('http://localhost/api/agent-tasks/capabilities')
    const response = await handleApiRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ enabled: true })
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
  })
})
