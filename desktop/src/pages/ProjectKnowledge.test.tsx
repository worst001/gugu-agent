import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentTasksApi } from '../api/agentTasks'
import { createProjectKnowledgeTabId } from '../constants/projectKnowledge'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import type { WorkspaceKnowledgeMap } from '../types/agentTask'
import { ProjectKnowledge } from './ProjectKnowledge'

vi.mock('../api/agentTasks', () => ({
  agentTasksApi: {
    workspaceKnowledge: vi.fn(),
  },
}))

const knowledgeMap: WorkspaceKnowledgeMap = {
  workspaceId: 'ws_v1_project',
  generatedAt: '2026-07-19T00:00:00.000Z',
  summary: {
    taskCount: 1,
    candidateCount: 1,
    sourceCount: 1,
    artifactCount: 1,
    potentialConflictCount: 0,
    truncated: false,
  },
  tasks: [{
    taskId: 'task-1',
    sessionId: 'session-1',
    title: 'Prepare Douyin launch scripts',
    role: 'short_video_operator',
    completedAt: '2026-07-19T00:00:00.000Z',
    candidateCount: 1,
    sourceCount: 1,
    artifactPaths: ['deliverables/scripts.docx'],
  }],
  sources: [{
    sourceId: 'source-1',
    title: 'Brand guide',
    kind: 'file',
    locator: {
      kind: 'file',
      path: 'docs/brand-guide.md',
      toolUseId: 'read-1',
    },
    observedAt: '2026-07-18T00:00:00.000Z',
    taskIds: ['task-1'],
  }],
  artifacts: [{
    path: 'deliverables/scripts.docx',
    taskIds: ['task-1'],
  }],
  knowledgeItems: [{
    id: 'candidate-1',
    kind: 'task_outcome',
    state: 'pending',
    text: 'Use a three-second proof-first opening hook.',
    createdAt: '2026-07-19T00:00:00.000Z',
    taskId: 'task-1',
    taskTitle: 'Prepare Douyin launch scripts',
  }],
  potentialConflicts: [],
}

beforeEach(() => {
  vi.mocked(agentTasksApi.workspaceKnowledge).mockResolvedValue({ knowledgeMap })
  useSettingsStore.setState({ locale: 'en' })
  const tabId = createProjectKnowledgeTabId('D:\\Gugu\\short-video')
  useTabStore.setState({
    tabs: [{ sessionId: tabId, title: 'Project Knowledge', type: 'knowledge', status: 'idle' }],
    activeTabId: tabId,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProjectKnowledge', () => {
  it('shows traceable project records and a task-centered relationship view', async () => {
    render(<ProjectKnowledge />)

    expect((await screen.findAllByText('Prepare Douyin launch scripts')).length)
      .toBeGreaterThan(0)
    expect(screen.getByText('Brand guide')).toBeTruthy()
    expect(screen.getByText('Use a three-second proof-first opening hook.')).toBeTruthy()
    expect(screen.getByText('deliverables/scripts.docx')).toBeTruthy()
    expect(agentTasksApi.workspaceKnowledge).toHaveBeenCalledWith(
      'D:\\Gugu\\short-video',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Relationships' }))
    expect(screen.getByText('Task')).toBeTruthy()
    expect(screen.getByText('Artifacts and outcomes')).toBeTruthy()
  })

  it('ignores a stale response after switching projects', async () => {
    let resolveFirst: ((value: { knowledgeMap: WorkspaceKnowledgeMap }) => void) | undefined
    let resolveSecond: ((value: { knowledgeMap: WorkspaceKnowledgeMap }) => void) | undefined
    vi.mocked(agentTasksApi.workspaceKnowledge).mockImplementation((path) =>
      new Promise((resolve) => {
        if (path.includes('first')) resolveFirst = resolve
        else resolveSecond = resolve
      })
    )
    const firstTab = createProjectKnowledgeTabId('D:\\Gugu\\first')
    const secondTab = createProjectKnowledgeTabId('D:\\Gugu\\second')
    useTabStore.setState({
      tabs: [{
        sessionId: firstTab,
        title: 'First knowledge',
        type: 'knowledge',
        status: 'idle',
      }],
      activeTabId: firstTab,
    })
    render(<ProjectKnowledge />)

    act(() => {
      useTabStore.setState({
        tabs: [{
          sessionId: secondTab,
          title: 'Second knowledge',
          type: 'knowledge',
          status: 'idle',
        }],
        activeTabId: secondTab,
      })
    })
    const secondMap = {
      ...knowledgeMap,
      tasks: [{ ...knowledgeMap.tasks[0]!, title: 'Second project task' }],
      knowledgeItems: knowledgeMap.knowledgeItems.map((item) => ({
        ...item,
        taskTitle: 'Second project task',
      })),
    }
    await act(async () => {
      resolveSecond?.({ knowledgeMap: secondMap })
    })
    expect((await screen.findAllByText('Second project task')).length)
      .toBeGreaterThan(0)

    await act(async () => {
      resolveFirst?.({ knowledgeMap })
    })
    expect(screen.getAllByText('Second project task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Prepare Douyin launch scripts')).toBeNull()
  })
  it('filters across sources and related task records', async () => {
    render(<ProjectKnowledge />)
    await screen.findByText('Brand guide')

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search sources, tasks, or artifacts' }),
      { target: { value: 'proof-first' } },
    )

    await waitFor(() => {
      expect(screen.getAllByText('Prepare Douyin launch scripts').length)
        .toBeGreaterThan(0)
      expect(screen.queryByText('Brand guide')).toBeNull()
    })
  })
})
