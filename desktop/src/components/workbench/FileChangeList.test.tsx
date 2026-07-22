import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type { WorkbenchFileChange } from './workbenchModel'
import { FileChangeList } from './FileChangeList'

const changes: WorkbenchFileChange[] = [
  makeChange('src/App.tsx', 'edited'),
  makeChange('src/utils/format.ts', 'created'),
  makeChange('docs/guide.md', 'deleted'),
]

describe('FileChangeList', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useWorkbenchStore.setState({ sessions: {}, panelWidth: 390 })
  })

  it('navigates changed files as a searchable path tree', () => {
    render(
      <FileChangeList
        sessionId="session-1"
        fileChanges={changes}
        selectedFilePath={null}
        totalFileCount={3}
        filesTruncated={false}
      />,
    )

    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /src 2/i }))
    expect(screen.getByText('App.tsx')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search changed files' }), {
      target: { value: 'format' },
    })
    expect(screen.getByText('format.ts')).toBeInTheDocument()
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('format.ts'))
    expect(
      useWorkbenchStore.getState().getSessionState('session-1').selectedFilePath,
    ).toBe('src/utils/format.ts')
  })
})

function makeChange(
  filePath: string,
  kind: WorkbenchFileChange['kind'],
): WorkbenchFileChange {
  return {
    id: `git:${filePath}`,
    filePath,
    toolUseId: `git:${filePath}`,
    toolName: 'Git',
    kind,
    summary: kind,
    binary: false,
    truncated: false,
    timestamp: 1,
  }
}
