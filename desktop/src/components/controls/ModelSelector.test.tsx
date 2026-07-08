import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelSelector } from './ModelSelector'
import { useProviderStore } from '../../stores/providerStore'
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
      fetchAll: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setEffort: vi.fn(async () => {}),
    })
    useProviderStore.setState({
      providers: [],
      activeId: 'gugu-managed',
      hasLoadedProviders: true,
      isLoading: false,
      fetchProviders: vi.fn(async () => {}),
      activateProvider: vi.fn(async () => {}),
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

  it('shows configured providers without exposing their internal model ids', () => {
    const activateProvider = vi.fn(async () => {})
    useProviderStore.setState({
      activeId: 'gugu-managed',
      providers: [
        {
          id: 'gugu-managed',
          presetId: 'gugu-managed',
          name: 'Gugu Managed',
          apiKey: '',
          baseUrl: '',
          apiFormat: 'gugu_managed',
          authKind: 'gugu_managed',
          models: {
            main: 'gugu-managed-main',
            haiku: 'gugu-managed-fast',
            sonnet: 'gugu-managed-main',
            opus: 'gugu-managed-main',
          },
        },
        {
          id: 'deepseek',
          presetId: 'deepseek',
          name: 'DeepSeek',
          apiKey: '***',
          baseUrl: 'https://api.deepseek.com',
          apiFormat: 'openai_chat',
          models: {
            main: 'deepseek-v4-pro',
            haiku: 'deepseek-v4-flash',
            sonnet: 'deepseek-v4-pro',
            opus: 'deepseek-v4-pro',
          },
        },
        {
          id: 'chatgpt-provider',
          presetId: 'chatgpt',
          name: 'ChatGPT Connect',
          apiKey: '',
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          apiFormat: 'chatgpt_codex',
          authKind: 'chatgpt_oauth',
          models: {
            main: 'gpt-5.4',
            haiku: 'gpt-5.4-mini',
            sonnet: 'gpt-5.4',
            opus: 'gpt-5.4',
          },
        },
      ],
      activateProvider,
    })

    render(<ModelSelector />)

    fireEvent.click(screen.getByRole('button', { name: /gugu managed/i }))

    expect(screen.getByRole('button', { name: 'DeepSeekV4' })).toBeInTheDocument()
    expect(screen.queryByText('gugu-managed-fast')).not.toBeInTheDocument()
    expect(screen.queryByText('deepseek-v4-pro')).not.toBeInTheDocument()
    expect(screen.queryByText('deepseek-v4-flash')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-5.4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeekV4' }))

    expect(activateProvider).toHaveBeenCalledWith('deepseek')
  })
})
