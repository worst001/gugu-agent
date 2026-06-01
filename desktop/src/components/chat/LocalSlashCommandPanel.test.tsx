import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { getInspectionMock } = vi.hoisted(() => ({
  getInspectionMock: vi.fn(),
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getInspection: getInspectionMock,
  },
}))

import { LocalSlashCommandPanel } from './LocalSlashCommandPanel'

describe('LocalSlashCommandPanel', () => {
  it('shows an empty 0% context state when no active session exists', async () => {
    render(<LocalSlashCommandPanel command="context" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/当前没有选中的活跃会话|No active session selected/)).not.toBeInTheDocument()
  })

  it('does not expose Session not found in the context panel', async () => {
    getInspectionMock.mockRejectedValue(new Error('Session not found: missing-session'))

    render(
      <LocalSlashCommandPanel
        command="context"
        sessionId="missing-session"
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/Session not found/)).not.toBeInTheDocument()
  })

  it('reports a loaded context snapshot to the caller', async () => {
    const onContextSnapshot = vi.fn()
    getInspectionMock
      .mockResolvedValueOnce({
        active: true,
        status: {
          sessionId: 'active-session',
          workDir: '/tmp/project',
          permissionMode: 'default',
        },
        errors: {},
      })
      .mockResolvedValueOnce({
        active: true,
        status: {
          sessionId: 'active-session',
          workDir: '/tmp/project',
          permissionMode: 'default',
        },
        context: {
          categories: [],
          totalTokens: 36_300,
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          percentage: 18,
          gridRows: [],
          model: 'gugu-managed-main',
          memoryFiles: [],
          mcpTools: [],
          agents: [],
        },
        errors: {},
      })

    render(
      <LocalSlashCommandPanel
        command="context"
        sessionId="active-session"
        onContextSnapshot={onContextSnapshot}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onContextSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        percentage: 18,
        totalTokens: 36_300,
      }))
    })
  })
})
