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

import { ContextUsageIndicator } from './ContextUsageIndicator'

describe('ContextUsageIndicator', () => {
  it('shows 0% only when there is no session context to estimate', () => {
    render(
      <ContextUsageIndicator
        chatState="idle"
        onOpen={vi.fn()}
        onAutoCompact={vi.fn()}
      />,
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('--')).not.toBeInTheDocument()
  })

  it('shows a pending state while a session context estimate is loading', () => {
    getInspectionMock.mockReturnValueOnce(new Promise(() => {}))

    render(
      <ContextUsageIndicator
        sessionId="new-session"
        chatState="idle"
        onOpen={vi.fn()}
        onAutoCompact={vi.fn()}
      />,
    )

    expect(screen.getByText('...')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('--')).not.toBeInTheDocument()
  })

  it('shows the estimated context percentage once available', async () => {
    getInspectionMock.mockResolvedValueOnce({
      contextEstimate: {
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
    })

    render(
      <ContextUsageIndicator
        sessionId="new-session"
        chatState="idle"
        onOpen={vi.fn()}
        onAutoCompact={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('18%')).toBeInTheDocument()
    })
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('--')).not.toBeInTheDocument()
  })

  it('uses a context snapshot supplied by the open context panel', async () => {
    getInspectionMock.mockReturnValueOnce(new Promise(() => {}))
    const snapshot = {
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
    }

    const { rerender } = render(
      <ContextUsageIndicator
        sessionId="new-session"
        chatState="idle"
        contextSnapshot={null}
        onOpen={vi.fn()}
        onAutoCompact={vi.fn()}
      />,
    )

    expect(screen.getByText('...')).toBeInTheDocument()

    rerender(
      <ContextUsageIndicator
        sessionId="new-session"
        chatState="idle"
        contextSnapshot={snapshot}
        onOpen={vi.fn()}
        onAutoCompact={vi.fn()}
      />,
    )

    expect(screen.getByText('18%')).toBeInTheDocument()
  })

  it('falls back to 0% when context inspection is unavailable', async () => {
    getInspectionMock.mockRejectedValueOnce(new Error('Session not found'))

    render(
      <ContextUsageIndicator
        sessionId="missing-session"
        chatState="idle"
        onOpen={vi.fn()}
        onAutoCompact={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('0%')).toBeInTheDocument()
    })
    expect(screen.queryByText('!')).not.toBeInTheDocument()
    expect(screen.queryByText('--')).not.toBeInTheDocument()
  })
})
