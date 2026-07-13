import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type { AgentTask, AgentTaskDetail } from '../../types/agentTask'
import { AgentTaskStatusBar } from './AgentTaskStatusBar'
import { AgentTaskEvidenceView } from '../workbench/AgentTaskEvidenceView'

const originalActions = {
  beginCurrentTask: useAgentTaskStore.getState().beginCurrentTask,
  resolveCurrentTask: useAgentTaskStore.getState().resolveCurrentTask,
  resumeCurrentTask: useAgentTaskStore.getState().resumeCurrentTask,
}

function createTask(
  overrides: Partial<AgentTask> = {},
): AgentTask {
  return {
    schemaVersion: 1,
    id: 'task-1',
    runId: 'run-1',
    attempt: 1,
    sessionId: 'session-1',
    role: 'software_engineer',
    title: 'Fix regression',
    goal: 'Restore expected behavior',
    constraints: [],
    status: 'completed',
    requiredChecks: [
      {
        id: 'tests',
        label: 'Regression tests',
        command: 'bun test regression.test.ts',
        required: true,
      },
    ],
    evidencePackId: 'evidence-1',
    review: {
      status: 'unavailable',
      summary: 'Reviewer timed out; verification passed.',
      findings: [],
      completedAt: '2026-07-13T00:00:02.000Z',
    },
    warnings: [],
    recoverable: false,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:02.000Z',
    revision: 8,
    ...overrides,
  }
}

function createDetail(task = createTask()): AgentTaskDetail {
  return {
    task,
    events: [],
    evidencePack: {
      schemaVersion: 1,
      id: 'evidence-1',
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      createdAt: '2026-07-13T00:00:01.000Z',
      checks: [
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
      artifacts: [],
    },
  }
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useWorkbenchStore.setState({ sessions: {} })
  useAgentTaskStore.setState({
    capabilityLoaded: true,
    enabled: true,
    sessionId: 'session-1',
    tasks: [],
    currentTask: null,
    detail: null,
    actionPending: false,
    error: null,
    ...originalActions,
  })
})

afterEach(() => {
  cleanup()
})

describe('AgentTaskStatusBar', () => {
  it('opens persisted evidence in the existing Workbench', () => {
    const detail = createDetail()
    useAgentTaskStore.setState({
      tasks: [detail.task],
      currentTask: detail.task,
      detail,
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)

    expect(screen.getByText('Fix regression')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open verification evidence',
      }),
    )

    const workbench = useWorkbenchStore
      .getState()
      .getSessionState('session-1')
    expect(workbench.isOpen).toBe(true)
    expect(workbench.activeTab).toBe('evidence')
  })

  it('offers an explicit resume action for interrupted attempts', () => {
    const resume = vi.fn().mockResolvedValue(undefined)
    const task = createTask({
      status: 'interrupted',
      recoverable: true,
      evidencePackId: undefined,
      review: undefined,
    })
    useAgentTaskStore.setState({
      tasks: [task],
      currentTask: task,
      detail: { task, events: [] },
      resumeCurrentTask: resume,
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    expect(resume).toHaveBeenCalledOnce()
  })
})

describe('AgentTaskEvidenceView', () => {
  it('renders structured checks, changed files, and review outcome', () => {
    render(<AgentTaskEvidenceView detail={createDetail()} />)

    expect(screen.getByText('bun test regression.test.ts')).toBeTruthy()
    expect(screen.getByText('src/responseMapper.ts')).toBeTruthy()
    expect(
      screen.getByText('Reviewer timed out; verification passed.'),
    ).toBeTruthy()
  })
})