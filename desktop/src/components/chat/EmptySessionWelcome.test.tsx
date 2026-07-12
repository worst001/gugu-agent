import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { EmptySessionWelcome } from './EmptySessionWelcome'

describe('EmptySessionWelcome', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('shows the shared starter actions and prefills the selected prompt', () => {
    const onSelectPrompt = vi.fn()
    render(<EmptySessionWelcome onSelectPrompt={onSelectPrompt} />)

    const actions = screen.getAllByRole('button')
    expect(actions).toHaveLength(6)

    fireEvent.click(actions[0]!)
    expect(onSelectPrompt).toHaveBeenCalledTimes(1)
    expect(onSelectPrompt.mock.calls[0]![0]).toEqual(expect.any(String))
    expect(onSelectPrompt.mock.calls[0]![0].length).toBeGreaterThan(0)
  })
})