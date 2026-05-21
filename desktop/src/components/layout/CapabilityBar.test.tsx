import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CapabilityBar } from './CapabilityBar'
import { useCapabilityStore, type CapabilitySummary } from '../../stores/capabilityStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

const refreshCapabilities = vi.fn()

const summary: CapabilitySummary = {
  providerName: 'DeepSeek',
  providerId: 'deepseek',
  model: {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: '',
    context: '128k',
  },
  effort: 'max',
  attachmentParser: {
    status: 'needs_config',
    enabled: true,
    hasApiKey: false,
    label: 'Needs key',
  },
  mcp: {
    total: 2,
    connected: 1,
    attention: 1,
  },
  skills: {
    total: 4,
    invocable: 3,
  },
  plugins: {
    total: 5,
    enabled: 4,
    errors: 0,
  },
  cwd: 'D:/repo',
  updatedAt: Date.now(),
  errors: {},
}

describe('CapabilityBar', () => {
  beforeEach(() => {
    refreshCapabilities.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ sidebarOpen: true, pendingSettingsTab: null })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-1', title: 'Session', type: 'session', status: 'idle' }],
      activeTabId: 'session-1',
    })
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        title: 'Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: 'D:/repo',
        workDir: 'D:/repo',
        workDirExists: true,
      }],
    })
    useCapabilityStore.setState({
      summary,
      isLoading: false,
      refreshCapabilities,
    })
  })

  it('renders the current capability summary', () => {
    render(<CapabilityBar />)

    expect(screen.getByText('Capabilities')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek V4 Pro')).toBeInTheDocument()
    expect(screen.getByText('Max')).toBeInTheDocument()
    expect(screen.getByText('Needs key')).toBeInTheDocument()
    expect(screen.getByText('1 need attention')).toBeInTheDocument()
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('Host shell')).toBeInTheDocument()
    expect(refreshCapabilities).toHaveBeenCalledWith('D:/repo')
  })

  it('routes capability chips to the matching settings tab', () => {
    render(<CapabilityBar />)

    fireEvent.click(screen.getByRole('button', { name: /glm/i }))

    expect(useTabStore.getState().activeTabId).toBe('__settings__')
    expect(useUIStore.getState().pendingSettingsTab).toBe('attachmentParser')

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }))

    expect(useTabStore.getState().activeTabId).toBe('__settings__')
    expect(useUIStore.getState().pendingSettingsTab).toBe('terminal')
  })
})
