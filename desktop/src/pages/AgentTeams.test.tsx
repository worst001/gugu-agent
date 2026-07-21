import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAgentTaskStore } from '../stores/agentTaskStore'
import { useSettingsStore } from '../stores/settingsStore'
import { AgentTeams } from './AgentTeams'

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useAgentTaskStore.setState({
    capabilityLoaded: true,
    enabled: true,
    roles: ['knowledge_worker', 'short_video_operator'],
    rolePacks: [{
      id: 'knowledge_worker',
      version: '1.0.0',
      displayName: 'Knowledge Worker',
      mission: 'Deliver source-backed artifacts.',
      responsibilities: ['Research', 'Draft', 'Verify'],
    }],
    teams: [{
      id: 'knowledge_delivery',
      version: '1.0.0',
      displayName: 'Knowledge delivery team',
      mission: 'Deliver source-backed work.',
      primaryRole: 'knowledge_worker',
      taskTemplates: [{
        id: 'document_delivery',
        version: '1.0.0',
        displayName: 'Deliver a document',
        description: 'Prepare a verified document.',
        kind: 'delivery',
        primaryRole: 'knowledge_worker',
      }],
    }],
  })
})

afterEach(() => {
  cleanup()
})

describe('AgentTeams', () => {
  it('shows product-owned teams and read-only professional standards', () => {
    render(<AgentTeams />)

    expect(screen.getByText('Professional teams')).toBeInTheDocument()
    expect(screen.getByText('Knowledge delivery team')).toBeInTheDocument()
    expect(screen.getByText('Deliver a document')).toBeInTheDocument()
    expect(screen.getByText('Professional standards')).toBeInTheDocument()
    expect(screen.getByText('Knowledge Worker')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create assistant' }))
      .not.toBeInTheDocument()
    expect(screen.queryByText('My assistants')).not.toBeInTheDocument()
  })
})
