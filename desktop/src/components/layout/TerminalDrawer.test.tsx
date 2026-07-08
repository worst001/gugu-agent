import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { TerminalDrawer } from './TerminalDrawer'

vi.mock('../../pages/TerminalSettings', () => ({
  TerminalSettings: ({ active, compact, testId }: { active: boolean; compact: boolean; testId: string }) => (
    <div data-testid={testId} data-active={String(active)} data-compact={String(compact)} />
  ),
}))

describe('TerminalDrawer', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ terminalDrawerOpen: true })
  })

  it('keeps the compact terminal mounted and closes through the drawer chrome', () => {
    render(<TerminalDrawer open />)

    expect(screen.getByTestId('terminal-drawer')).toHaveAttribute('data-open', 'true')
    expect(Number.parseInt(screen.getByTestId('terminal-drawer').style.height, 10)).toBeGreaterThan(0)
    expect(screen.getByTestId('terminal-drawer-host')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('terminal-drawer-host')).toHaveAttribute('data-compact', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(useUIStore.getState().terminalDrawerOpen).toBe(false)
  })

  it('collapses in layout instead of overlaying the chat area', () => {
    const { rerender } = render(<TerminalDrawer open={false} />)

    expect(screen.getByTestId('terminal-drawer')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('terminal-drawer')).toHaveClass('h-0')
    expect(screen.getByTestId('terminal-drawer-host')).toHaveAttribute('data-active', 'false')

    rerender(<TerminalDrawer open />)

    expect(screen.getByTestId('terminal-drawer')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('terminal-drawer')).toHaveClass('min-h-[220px]')
    expect(screen.getByTestId('terminal-drawer-host')).toHaveAttribute('data-active', 'true')
  })

  it('resizes from the top edge', () => {
    render(<TerminalDrawer open />)

    const drawer = screen.getByTestId('terminal-drawer')
    const initialHeight = Number.parseInt(drawer.style.height, 10)

    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize terminal panel' }), {
      clientY: 400,
    })
    expect(drawer).toHaveAttribute('data-resizing', 'true')

    fireEvent.mouseMove(document, { clientY: 300 })
    fireEvent.mouseUp(document)

    expect(Number.parseInt(drawer.style.height, 10)).toBeGreaterThan(initialHeight)
    expect(drawer).toHaveAttribute('data-resizing', 'false')
  })
})
