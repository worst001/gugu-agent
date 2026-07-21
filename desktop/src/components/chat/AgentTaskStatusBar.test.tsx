import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type { AgentTask, AgentTaskDetail } from '../../types/agentTask'
import { AgentTaskStatusBar } from './AgentTaskStatusBar'
import { AgentTaskEvidenceView } from '../workbench/AgentTaskEvidenceView'

const originalSendMessage = useChatStore.getState().sendMessage

const originalActions = {
  refreshCurrentTask: useAgentTaskStore.getState().refreshCurrentTask,
  refreshKnowledgeMap: useAgentTaskStore.getState().refreshKnowledgeMap,
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
    roleVersion: '1.0.0',
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
  useChatStore.setState({ sessions: {}, sendMessage: originalSendMessage })
  useAgentTaskStore.setState({
    capabilityLoaded: true,
    enabled: true,
    rolePacks: [],
    teams: [],
    sessionId: 'session-1',
    tasks: [],
    currentTask: null,
    detail: null,
    knowledgeMap: null,
    actionPending: false,
    error: null,
    ...originalActions,
  })
})

afterEach(() => {
  cleanup()
})

describe('AgentTaskStatusBar', () => {
  it('shows the real owner, stage, and Role Pack responsibility', () => {
    const task = createTask({
      status: 'execute',
      evidencePackId: undefined,
      review: undefined,
    })
    useAgentTaskStore.setState({
      rolePacks: [{
        id: 'software_engineer',
        version: '1.0.0',
        displayName: 'Software Engineer',
        mission: 'Deliver verified software changes.',
        responsibilities: [
          'Inspect the repository before editing.',
          'Run required checks before completion.',
        ],
      }],
      tasks: [task],
      currentTask: task,
      detail: { task, events: [] },
    })

    const { container } = render(
      <AgentTaskStatusBar sessionId="session-1" />,
    )

    expect(
      screen.getByText('This task is owned by Software Engineer'),
    ).toBeTruthy()
    expect(screen.getByText('Execute')).toBeTruthy()
    expect(container.querySelector('[style*=width]')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: /Fix regression/ }),
    )
    expect(screen.getByText('Work stages')).toBeTruthy()
    expect(screen.getByText('Stage 4/6')).toBeTruthy()
    expect(screen.getByText('Confirm goal')).toBeTruthy()
    expect(screen.getByText('Produce result')).toBeTruthy()
    expect(screen.queryByText('Actual collaboration')).toBeNull()
    expect(screen.getByText('Role capability')).toBeTruthy()
    expect(screen.getByText('Deliver verified software changes.')).toBeTruthy()
    expect(screen.getByText('Responsibility for this task')).toBeTruthy()
    expect(screen.getByText('Restore expected behavior')).toBeTruthy()
    expect(
      screen.getByText('Inspect the repository before editing.'),
    ).toBeTruthy()
  })

  it('opens persisted evidence in the existing Workbench', () => {
    const detail = createDetail()
    useAgentTaskStore.setState({
      tasks: [detail.task],
      currentTask: detail.task,
      detail,
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)

    expect(screen.getByText('Fix regression')).toBeTruthy()
    expect(
      screen.getByText('This task is owned by Software Engineer'),
    ).toBeTruthy()
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

  it('uses role-specific status copy for knowledge work', () => {
    const task = createTask({
      role: 'knowledge_worker',
      title: 'Prepare launch brief',
      status: 'execute',
      evidencePackId: undefined,
      review: undefined,
    })
    useAgentTaskStore.setState({
      tasks: [task],
      currentTask: task,
      detail: { task, events: [] },
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)

    expect(
      screen.getByText('This task is owned by Knowledge Worker'),
    ).toBeTruthy()
    expect(screen.getByText('Producing artifact')).toBeTruthy()
  })
  it('shows a selected assistant and requests a real review child', () => {
    const sendMessage = vi.fn()
    const task = createTask({
      assistantId: 'custom-reviewer',
      assistantName: 'Release reviewer',
      definitionSnapshot: {
        schemaVersion: 1,
        team: { id: 'software_delivery', version: '1.0.0' },
        taskTemplate: { id: 'bug_fix', version: '1.0.0' },
        workflow: { id: 'verified_delivery', version: '1.0.0' },
        roles: [{
          slotId: 'primary',
          kind: 'primary',
          role: 'software_engineer',
          roleVersion: '1.0.0',
        }],
        capabilities: {
          required: ['repository_read'],
          optional: [],
        },
        completionContract: {
          definitionOfDone: ['Checks passed'],
          outputContracts: ['review_outcome'],
        },
      },
    })
    useChatStore.setState({ sendMessage })
    useAgentTaskStore.setState({
      teams: [{
        id: 'software_delivery',
        version: '1.0.0',
        displayName: 'Software delivery team',
        mission: '',
        primaryRole: 'software_engineer',
        taskTemplates: [{
          id: 'software_independent_review',
          version: '1.0.0',
          displayName: 'Independent review',
          description: '',
          kind: 'independent_review',
          primaryRole: 'software_engineer',
        }],
      }],
      tasks: [task],
      currentTask: task,
      detail: createDetail(task),
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)

    expect(
      screen.getByText('This task is owned by Release reviewer'),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Professional review' }),
    )

    expect(sendMessage).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('parentTaskId "task-1"'),
      undefined,
      {
        displayContent: 'Review completed task: Fix regression',
      },
    )
    const reviewRequest = sendMessage.mock.calls[0]?.[1] as string
    expect(reviewRequest).toContain('teamId "software_delivery"')
    expect(reviewRequest).toContain(
      'taskTemplateId "software_independent_review"',
    )
  })

  it('shows a review member only after a persisted review task exists', () => {
    const parent = createTask()
    const reviewTask = createTask({
      id: 'task-review',
      runId: 'run-review',
      parentTaskId: parent.id,
      relation: 'review',
      title: 'Independent review of regression fix',
      status: 'execute',
      evidencePackId: undefined,
      review: undefined,
    })
    useAgentTaskStore.setState({
      tasks: [parent, reviewTask],
      currentTask: parent,
      detail: createDetail(parent),
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)

    expect(screen.getByText('1 review assistants')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Fix regression/ }))
    expect(screen.getByText('Actual collaboration')).toBeTruthy()
    expect(screen.getByText('1 collaborators')).toBeTruthy()
    expect(screen.queryByText('Primary assistant')).toBeNull()
    expect(screen.getByText('Independent review')).toBeTruthy()
    expect(
      screen.getByText('Independent review of regression fix'),
    ).toBeTruthy()
  })
  it('shows the short-video operator as the task owner', () => {
    const task = createTask({
      role: 'short_video_operator',
      title: 'Prepare Douyin scripts',
      status: 'execute',
      evidencePackId: undefined,
      review: undefined,
    })
    useAgentTaskStore.setState({
      tasks: [task],
      currentTask: task,
      detail: { task, events: [] },
    })

    render(<AgentTaskStatusBar sessionId="session-1" />)

    expect(
      screen.getByText('This task is owned by Short Video Operator'),
    ).toBeTruthy()
    expect(screen.getByText('Producing artifact')).toBeTruthy()
  })
})

describe('AgentTaskEvidenceView', () => {
  it('refreshes task detail when the evidence view opens', () => {
    const detail = createDetail()
    const refreshCurrentTask = vi.fn().mockResolvedValue(undefined)
    const refreshKnowledgeMap = vi.fn().mockResolvedValue(undefined)
    useAgentTaskStore.setState({
      sessionId: 'session-1',
      currentTask: detail.task,
      detail,
      refreshCurrentTask,
      refreshKnowledgeMap,
    })

    const { rerender } = render(<AgentTaskEvidenceView detail={detail} />)

    expect(refreshCurrentTask).toHaveBeenCalledOnce()
    expect(refreshKnowledgeMap).toHaveBeenCalledOnce()

    rerender(
      <AgentTaskEvidenceView
        detail={createDetail(createTask({ revision: 9 }))}
      />,
    )

    expect(refreshCurrentTask).toHaveBeenCalledOnce()
    expect(refreshKnowledgeMap).toHaveBeenCalledTimes(2)
  })

  it('renders structured checks, changed files, and review outcome', () => {
    render(<AgentTaskEvidenceView detail={createDetail()} />)

    expect(screen.getByText('bun test regression.test.ts')).toBeTruthy()
    expect(screen.getByText('src/responseMapper.ts')).toBeTruthy()
    expect(
      screen.getByText('Reviewer timed out; verification passed.'),
    ).toBeTruthy()
  })

  it('shows task sources with expandable excerpts', () => {
    const detail = createDetail()
    detail.provenancePack = {
      schemaVersion: 1,
      id: 'provenance-1',
      taskId: detail.task.id,
      runId: detail.task.runId,
      attempt: detail.task.attempt,
      workspaceId: 'ws_v1_abc',
      sessionId: 'session-1',
      createdAt: '2026-07-13T00:00:01.000Z',
      sources: [
        {
          id: 'source-1',
          sessionId: 'session-1',
          title: 'facts.md',
          locator: {
            kind: 'file',
            path: 'D:/Project/facts.md',
            toolUseId: 'Read:1',
          },
          observedAt: '2026-07-13T00:00:00.000Z',
          excerpt: 'Verified project facts.',
        },
        {
          id: 'source-2',
          sessionId: 'session-1',
          title: 'https://example.com/guide',
          locator: {
            kind: 'url',
            url: 'https://example.com/guide',
            toolUseId: 'WebFetch:1',
          },
          observedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
    }

    render(<AgentTaskEvidenceView detail={detail} />)

    expect(screen.getByText('Sources used')).toBeTruthy()
    expect(screen.getByText('Sources used by this task: 2')).toBeTruthy()
    const fileSource = screen.getByText('facts.md')
    const details = fileSource.closest('details')
    expect(details?.open).toBe(false)
    fireEvent.click(fileSource)
    expect(details?.open).toBe(true)
    expect(screen.getByText('https://example.com/guide')).toBeTruthy()
    expect(screen.getByText('Verified project facts.')).toBeTruthy()
  })

  it('shows the project knowledge summary and potential conflicts', () => {
    const detail = createDetail()
    useAgentTaskStore.setState({
      currentTask: detail.task,
      refreshCurrentTask: vi.fn().mockResolvedValue(undefined),
      refreshKnowledgeMap: vi.fn().mockResolvedValue(undefined),
      knowledgeMap: {
        workspaceId: 'ws_v1_project',
        generatedAt: '2026-07-17T00:00:00.000Z',
        summary: {
          taskCount: 2,
          candidateCount: 4,
          sourceCount: 3,
          artifactCount: 1,
          potentialConflictCount: 1,
          truncated: false,
        },
        tasks: [
          {
            taskId: 'task-prior',
            title: 'Prior response fix',
            role: 'software_engineer',
            completedAt: '2026-07-16T00:00:00.000Z',
            candidateCount: 2,
            sourceCount: 3,
            artifactPaths: ['reports/fix.md'],
          },
        ],
        sources: [],
        artifacts: [{ path: 'reports/fix.md', taskIds: ['task-1', 'task-prior'] }],
        knowledgeItems: [],
        potentialConflicts: [
          {
            kind: 'shared_artifact_path',
            artifactPath: 'reports/fix.md',
            taskIds: ['task-1', 'task-prior'],
          },
        ],
      },
    })

    render(<AgentTaskEvidenceView detail={detail} />)

    expect(screen.getByText('Project knowledge')).toBeTruthy()
    expect(screen.getByText('Prior response fix')).toBeTruthy()
    expect(screen.getByText('Potential conflicts: 1')).toBeTruthy()
    expect(screen.getByText('reports/fix.md')).toBeTruthy()
  })

  it('discloses a bounded scan even when no knowledge row is visible', () => {
    const detail = createDetail()
    useAgentTaskStore.setState({
      currentTask: detail.task,
      refreshCurrentTask: vi.fn().mockResolvedValue(undefined),
      refreshKnowledgeMap: vi.fn().mockResolvedValue(undefined),
      knowledgeMap: {
        workspaceId: 'ws_v1_project',
        generatedAt: '2026-07-17T00:00:00.000Z',
        summary: {
          taskCount: 0,
          candidateCount: 0,
          sourceCount: 0,
          artifactCount: 0,
          potentialConflictCount: 0,
          truncated: true,
        },
        tasks: [],
        sources: [],
        artifacts: [],
        knowledgeItems: [],
        potentialConflicts: [],
      },
    })

    render(<AgentTaskEvidenceView detail={detail} />)

    expect(screen.getByText('No prior task knowledge recorded.')).toBeTruthy()
    expect(screen.getByText(
      'Showing a bounded subset of local knowledge.',
    )).toBeTruthy()
  })
})
