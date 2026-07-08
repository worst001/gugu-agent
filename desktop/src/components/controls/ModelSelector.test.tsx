import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelSelector } from './ModelSelector'
import { useSettingsStore } from '../../stores/settingsStore'

describe('ModelSelector', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'en',
      currentModel: {
        id: 'gugu-managed-main',
        name: 'gugu-managed-main',
        description: 'Main model',
        context: '',
      },
      availableModels: [
        {
          id: 'claude-opus-4-7',
          name: 'Opus 4.7',
          description: 'Most capable for ambitious work',
          context: '1m',
        },
        {
          id: 'gugu-managed-main',
          name: 'gugu-managed-main',
          description: 'Main model',
          context: '',
        },
      ],
      activeProviderName: 'Gugu Managed',
      effortLevel: 'medium',
      setModel: vi.fn(async () => {}),
      setEffort: vi.fn(async () => {}),
    })
  })

  it('hides built-in Claude defaults from the model list', () => {
    render(<ModelSelector />)

    fireEvent.click(screen.getByRole('button', { name: /gugu-managed-main/i }))

    expect(screen.queryByText('Opus 4.7')).not.toBeInTheDocument()
    expect(screen.getAllByText('gugu-managed-main').length).toBeGreaterThan(0)
  })

  it('persists plain model selections through the settings store', () => {
    const setModel = vi.fn(async () => {})
    useSettingsStore.setState({
      setModel,
      availableModels: [
        {
          id: 'gugu-managed-main',
          name: 'gugu-managed-main',
          description: 'Main model',
          context: '',
        },
        {
          id: 'custom-main',
          name: 'custom-main',
          description: 'Custom model',
          context: '',
        },
      ],
    })
    render(<ModelSelector />)

    fireEvent.click(screen.getByRole('button', { name: /gugu-managed-main/i }))
    fireEvent.click(screen.getByRole('button', { name: 'custom-main' }))

    expect(setModel).toHaveBeenCalledWith('custom-main')
  })
})
