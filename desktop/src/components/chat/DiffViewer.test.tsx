import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useSettingsStore } from '../../stores/settingsStore'
import { DiffViewer } from './DiffViewer'

vi.mock('react-diff-viewer-continued', () => ({
  DiffMethod: { WORDS: 'diffWords' },
  default: ({
    showDiffOnly,
    extraLinesSurroundingDiff,
    codeFoldMessageRenderer,
    oldValue,
    newValue,
  }: {
    showDiffOnly?: boolean
    extraLinesSurroundingDiff?: number
    codeFoldMessageRenderer?: (count: number) => React.ReactNode
    oldValue?: string
    newValue?: string
  }) => (
    <div
      data-testid="diff-engine"
      data-show-diff-only={String(showDiffOnly)}
      data-context-lines={extraLinesSurroundingDiff}
      data-values-match={String(oldValue === newValue)}
    >
      {codeFoldMessageRenderer?.(7)}
    </div>
  ),
}))

vi.mock('../shared/CopyButton', () => ({
  CopyButton: () => <button type="button">Copy path</button>,
}))

describe('DiffViewer', () => {
  it('does not treat CRLF and LF as changed content', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <DiffViewer
        filePath="src/same.ts"
        oldString={"same\ncontent\n"}
        newString={"same\r\ncontent\r\n"}
      />,
    )

    expect(screen.getByText('+0')).toBeInTheDocument()
    expect(screen.getByText('-0')).toBeInTheDocument()
    expect(screen.getByTestId('diff-engine')).toHaveAttribute('data-values-match', 'true')
  })

  it('uses real line counts and folds unchanged context', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <DiffViewer
        filePath="src/new.ts"
        oldString=""
        newString={"first\nsecond\n"}
      />,
    )

    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('-0')).toBeInTheDocument()
    expect(screen.getByText('7 unchanged lines')).toBeInTheDocument()
    expect(screen.getByTestId('diff-engine')).toHaveAttribute('data-show-diff-only', 'true')
    expect(screen.getByTestId('diff-engine')).toHaveAttribute('data-context-lines', '3')
  })
})
