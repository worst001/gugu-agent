import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configBackupApi } from '../api/configBackup'
import {
  flushDesktopStateWrites,
  reloadDesktopProfile,
  resetDesktopProfileData,
} from '../stores/desktopProfilePersistence'
import { ConfigBackupSettings } from './ConfigBackupSettings'

vi.mock('../stores/desktopProfilePersistence', () => ({
  flushDesktopStateWrites: vi.fn(),
  reloadDesktopProfile: vi.fn(),
  resetDesktopProfileData: vi.fn(),
}))

vi.mock('../api/configBackup', () => ({
  configBackupApi: {
    exportConfig: vi.fn(),
    previewImport: vi.fn(),
    importConfig: vi.fn(),
  },
}))

describe('ConfigBackupSettings desktop data reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(flushDesktopStateWrites).mockResolvedValue()
    vi.mocked(reloadDesktopProfile).mockResolvedValue(null)
    vi.mocked(resetDesktopProfileData).mockResolvedValue()
  })

  it('requires confirmation before resetting app-owned profile data', async () => {
    render(<ConfigBackupSettings />)

    fireEvent.click(screen.getByRole('button', { name: /Reset desktop data$/ }))
    expect(screen.getByText('Reset desktop data?')).toBeInTheDocument()
    expect(resetDesktopProfileData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset and reload' }))

    await waitFor(() => expect(resetDesktopProfileData).toHaveBeenCalledTimes(1))
  })

  it('flushes pending desktop writes before importing and reloading', async () => {
    const configPackage = {
      format: 'gugu-config-export',
      version: 2,
      exportedAt: '2026-07-14T00:00:00.000Z',
      app: { name: 'Gugu Agent', configDir: 'D:/config' },
      secretsIncluded: false,
      sections: {},
    }
    const preview = {
      valid: true,
      format: 'gugu-config-export',
      version: 2,
      secretsIncluded: false,
      items: [],
      summary: { add: 0, overwrite: 0, skip: 0 },
    }
    vi.mocked(configBackupApi.previewImport).mockResolvedValue({
      preview,
    } as never)
    vi.mocked(configBackupApi.importConfig).mockResolvedValue({
      ok: true,
      preview,
    } as never)

    const { container } = render(<ConfigBackupSettings />)
    const input = container.querySelector<HTMLInputElement>('input[type=file]')
    expect(input).not.toBeNull()

    fireEvent.change(input!, {
      target: {
        files: [
          new File(
            [JSON.stringify(configPackage)],
            'gugu-config-export.json',
            { type: 'application/json' },
          ),
        ],
      },
    })

    await waitFor(() => {
      expect(configBackupApi.previewImport).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Import' }))

    await waitFor(() => {
      expect(configBackupApi.importConfig).toHaveBeenCalledTimes(1)
      expect(reloadDesktopProfile).toHaveBeenCalledTimes(1)
    })
    expect(
      vi.mocked(flushDesktopStateWrites).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(configBackupApi.importConfig).mock.invocationCallOrder[0]!,
    )
  })
})
