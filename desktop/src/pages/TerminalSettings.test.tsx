import { act, render, screen, waitFor } from '@testing-library/react'
import type { ITheme } from '@xterm/xterm'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const terminalMocks = vi.hoisted(() => {
  const terminalInstance = {
    cols: 80,
    rows: 24,
    loadAddon: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    clear: vi.fn(),
    refresh: vi.fn(),
    options: { theme: undefined as ITheme | undefined },
  }
  const fitInstance = {
    fit: vi.fn(),
  }
  return {
    available: false,
    terminalInstance,
    fitInstance,
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onOutput: vi.fn(),
    onExit: vi.fn(),
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn((options) => {
    terminalMocks.terminalInstance.options = options
    return terminalMocks.terminalInstance
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => terminalMocks.fitInstance),
}))

vi.mock('../api/terminal', () => ({
  terminalApi: {
    isAvailable: () => terminalMocks.available,
    spawn: terminalMocks.spawn,
    write: terminalMocks.write,
    resize: terminalMocks.resize,
    kill: terminalMocks.kill,
    onOutput: terminalMocks.onOutput,
    onExit: terminalMocks.onExit,
  },
}))

import { TerminalSettings } from './TerminalSettings'

describe('TerminalSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    terminalMocks.available = false
    terminalMocks.spawn.mockReset()
    terminalMocks.write.mockReset()
    terminalMocks.resize.mockReset()
    terminalMocks.kill.mockReset()
    terminalMocks.onOutput.mockReset()
    terminalMocks.onExit.mockReset()
    terminalMocks.terminalInstance.loadAddon.mockClear()
    terminalMocks.terminalInstance.open.mockClear()
    terminalMocks.terminalInstance.dispose.mockClear()
    terminalMocks.terminalInstance.onData.mockClear()
    terminalMocks.terminalInstance.write.mockClear()
    terminalMocks.terminalInstance.writeln.mockClear()
    terminalMocks.terminalInstance.clear.mockClear()
    terminalMocks.terminalInstance.refresh.mockClear()
    terminalMocks.terminalInstance.cols = 80
    terminalMocks.terminalInstance.rows = 24
    terminalMocks.fitInstance.fit.mockClear()
    terminalMocks.onOutput.mockResolvedValue(vi.fn())
    terminalMocks.onExit.mockResolvedValue(vi.fn())
    terminalMocks.write.mockResolvedValue(undefined)
    terminalMocks.resize.mockResolvedValue(undefined)
    terminalMocks.kill.mockResolvedValue(undefined)
    terminalMocks.spawn.mockResolvedValue({
      session_id: 7,
      shell: '/bin/zsh',
      cwd: '/Users/test',
    })
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  it('shows a desktop-runtime empty state outside Tauri', () => {
    render(<TerminalSettings />)

    expect(screen.getByText('Desktop runtime required')).toBeInTheDocument()
    expect(terminalMocks.spawn).not.toHaveBeenCalled()
  })

  it('starts a host terminal session when Tauri is available', async () => {
    terminalMocks.available = true

    render(<TerminalSettings />)

    await waitFor(() => {
      expect(terminalMocks.spawn).toHaveBeenCalledWith({ cols: 80, rows: 24 })
    })
    expect(screen.getByText('/bin/zsh')).toBeInTheDocument()
    expect(screen.getByText('/Users/test')).toBeInTheDocument()
    expect(terminalMocks.terminalInstance.open).toHaveBeenCalled()
    expect(terminalMocks.fitInstance.fit).toHaveBeenCalled()
    expect(terminalMocks.terminalInstance.refresh).toHaveBeenCalled()
  })

  it('updates xterm colors when the app theme changes', async () => {
    terminalMocks.available = true
    document.documentElement.style.setProperty('--color-terminal-bg', '#fefcf8')
    document.documentElement.style.setProperty('--color-terminal-black', '#211b17')

    render(<TerminalSettings />)
    await waitFor(() => expect(terminalMocks.spawn).toHaveBeenCalled())
    expect(terminalMocks.terminalInstance.options.theme?.background).toBe('#fefcf8')
    expect(terminalMocks.terminalInstance.options.theme?.black).toBe('#211b17')

    act(() => {
      document.documentElement.style.setProperty('--color-terminal-bg', '#101820')
      document.documentElement.style.setProperty('--color-terminal-black', '#29384a')
      useUIStore.getState().setTheme('blue-dark')
    })

    await waitFor(() => {
      expect(terminalMocks.terminalInstance.options.theme?.background).toBe('#101820')
      expect(terminalMocks.terminalInstance.options.theme?.black).toBe('#29384a')
    })
  })

  it('writes matching terminal output events into xterm', async () => {
    terminalMocks.available = true
    let outputHandler: ((payload: { session_id: number; data: string }) => void) | undefined
    terminalMocks.onOutput.mockImplementation(async (handler) => {
      outputHandler = handler
      return vi.fn()
    })

    render(<TerminalSettings />)
    await waitFor(() => expect(terminalMocks.spawn).toHaveBeenCalled())

    act(() => {
      outputHandler?.({ session_id: 7, data: 'hello\r\n' })
      outputHandler?.({ session_id: 8, data: 'ignored\r\n' })
    })

    expect(terminalMocks.terminalInstance.write).toHaveBeenCalledWith('hello\r\n')
    expect(terminalMocks.terminalInstance.write).not.toHaveBeenCalledWith('ignored\r\n')
  })

  it('debounces backend resize while refreshing the local terminal immediately', async () => {
    terminalMocks.available = true

    render(<TerminalSettings />)
    await waitFor(() => expect(terminalMocks.spawn).toHaveBeenCalled())
    terminalMocks.resize.mockClear()

    terminalMocks.terminalInstance.cols = 100
    terminalMocks.terminalInstance.rows = 30
    act(() => window.dispatchEvent(new Event('resize')))
    terminalMocks.terminalInstance.cols = 120
    terminalMocks.terminalInstance.rows = 34
    act(() => window.dispatchEvent(new Event('resize')))

    expect(terminalMocks.terminalInstance.refresh).toHaveBeenCalled()
    expect(terminalMocks.resize).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(terminalMocks.resize).toHaveBeenCalledWith(7, 120, 34)
    })
    expect(terminalMocks.resize).toHaveBeenCalledTimes(1)
  })
})
