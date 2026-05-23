import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { useSettingsStore } from '../stores/settingsStore'
import { ComputerUseSettings } from './ComputerUseSettings'

const {
  MOCK_GET_STATUS,
  MOCK_RUN_SETUP,
  MOCK_INSTALL_PYTHON,
  MOCK_GET_INSTALLED_APPS,
  MOCK_GET_AUTHORIZED_APPS,
  MOCK_SET_AUTHORIZED_APPS,
  MOCK_OPEN_SETTINGS,
} = vi.hoisted(() => ({
  MOCK_GET_STATUS: vi.fn(),
  MOCK_RUN_SETUP: vi.fn(),
  MOCK_INSTALL_PYTHON: vi.fn(),
  MOCK_GET_INSTALLED_APPS: vi.fn(),
  MOCK_GET_AUTHORIZED_APPS: vi.fn(),
  MOCK_SET_AUTHORIZED_APPS: vi.fn(),
  MOCK_OPEN_SETTINGS: vi.fn(),
}))

vi.mock('../api/computerUse', () => ({
  computerUseApi: {
    getStatus: MOCK_GET_STATUS,
    runSetup: MOCK_RUN_SETUP,
    installPython: MOCK_INSTALL_PYTHON,
    getInstalledApps: MOCK_GET_INSTALLED_APPS,
    getAuthorizedApps: MOCK_GET_AUTHORIZED_APPS,
    setAuthorizedApps: MOCK_SET_AUTHORIZED_APPS,
    openSettings: MOCK_OPEN_SETTINGS,
  },
}))

const macMissingPythonStatus = {
  platform: 'darwin',
  supported: true,
  python: {
    installed: false,
    version: null,
    path: null,
  },
  venv: {
    created: false,
    path: '/Users/test/.claude/.runtime/venv',
  },
  dependencies: {
    installed: false,
    requirementsFound: true,
  },
  permissions: {
    accessibility: null,
    screenRecording: null,
  },
}

describe('ComputerUseSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    MOCK_GET_STATUS.mockResolvedValue(macMissingPythonStatus)
    MOCK_RUN_SETUP.mockResolvedValue({ success: true, steps: [] })
    MOCK_INSTALL_PYTHON.mockResolvedValue({
      success: false,
      steps: [{ name: 'homebrew', ok: false, message: 'Homebrew not found' }],
    })
    MOCK_GET_INSTALLED_APPS.mockResolvedValue({ apps: [] })
    MOCK_GET_AUTHORIZED_APPS.mockResolvedValue({
      authorizedApps: [],
      grantFlags: { clipboardRead: true, clipboardWrite: true, systemKeyCombos: true },
    })
    MOCK_SET_AUTHORIZED_APPS.mockResolvedValue({ ok: true })
    MOCK_OPEN_SETTINGS.mockResolvedValue({ ok: true })
  })

  it('shows a macOS first-time setup guide before the environment is ready', async () => {
    render(<ComputerUseSettings />)

    expect(await screen.findByText('macOS first-time setup')).toBeInTheDocument()
    expect(screen.getAllByText('Install Python 3').length).toBeGreaterThan(0)
    expect(screen.getByText('Create runtime')).toBeInTheDocument()
    expect(screen.getByText('Grant permissions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Install Python 3/i })).toBeInTheDocument()
  })

  it('lets macOS users open privacy settings from the guide', async () => {
    render(<ComputerUseSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /Open Accessibility Settings/i }))
    expect(MOCK_OPEN_SETTINGS).toHaveBeenCalledWith('Privacy_Accessibility')

    fireEvent.click(screen.getByRole('button', { name: /Open Screen Recording Settings/i }))
    expect(MOCK_OPEN_SETTINGS).toHaveBeenCalledWith('Privacy_ScreenCapture')
  })

  it('offers automatic Python installation on macOS', async () => {
    render(<ComputerUseSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /Install Python 3/i }))

    await waitFor(() => {
      expect(MOCK_INSTALL_PYTHON).toHaveBeenCalledTimes(1)
    })
  })
})
