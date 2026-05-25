import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PermissionModeSelector } from './PermissionModeSelector'
import { useSettingsStore } from '../../stores/settingsStore'

describe('PermissionModeSelector', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en', permissionMode: 'acceptEdits' })
  })

  it('does not show plan mode in the execution permissions menu', () => {
    render(<PermissionModeSelector />)

    fireEvent.click(screen.getByRole('button', { name: /auto accept/i }))

    expect(screen.getByText('Execution Permissions')).toBeInTheDocument()
    expect(screen.getByText('Ask permissions')).toBeInTheDocument()
    expect(screen.getByText('Auto accept edits')).toBeInTheDocument()
    expect(screen.getByText('Bypass permissions')).toBeInTheDocument()
    expect(screen.queryByText('Plan mode')).not.toBeInTheDocument()
    expect(screen.queryByText('Architecture & reasoning only, no files')).not.toBeInTheDocument()
  })

  it('displays legacy plan permission mode as ask permissions', () => {
    render(<PermissionModeSelector value="plan" />)

    expect(screen.getByRole('button', { name: /ask permissions/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ask permissions/i }))

    expect(screen.queryByText('Plan mode')).not.toBeInTheDocument()
  })

  it('does not open the menu while disabled', () => {
    render(<PermissionModeSelector disabled disabledReason="Wait for this turn to finish" />)

    const button = screen.getByRole('button', { name: /auto accept/i })
    expect(button).toBeDisabled()

    fireEvent.click(button)

    expect(screen.queryByText('Execution Permissions')).not.toBeInTheDocument()
  })
})
