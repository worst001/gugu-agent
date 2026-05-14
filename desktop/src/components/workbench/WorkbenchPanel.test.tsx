import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { UIMessage } from '../../types/chat'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { WorkbenchPanel } from './WorkbenchPanel'

vi.mock('../chat/DiffViewer', () => ({
  DiffViewer: ({ filePath, oldString, newString }: {
    filePath: string
    oldString: string
    newString: string
  }) => (
    <div data-testid="diff-preview">
      {filePath}
      {oldString}
      {newString}
    </div>
  ),
}))

vi.mock('../chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-preview">{code}</pre>,
}))

vi.mock('../markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}))

const messages: UIMessage[] = [
  {
    id: 'tool-write',
    type: 'tool_use',
    toolName: 'Write',
    toolUseId: 'write-1',
    input: { file_path: 'src/App.tsx', content: 'export const title = "GuGu"' },
    timestamp: 1,
  },
  {
    id: 'result-write',
    type: 'tool_result',
    toolUseId: 'write-1',
    content: 'created',
    isError: false,
    timestamp: 2,
  },
  {
    id: 'tool-bash',
    type: 'tool_use',
    toolName: 'Bash',
    toolUseId: 'bash-1',
    input: { command: 'bun test', description: 'Run tests' },
    timestamp: 3,
  },
  {
    id: 'result-bash',
    type: 'tool_result',
    toolUseId: 'bash-1',
    content: 'all tests passed',
    isError: false,
    timestamp: 4,
  },
]

describe('WorkbenchPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useWorkbenchStore.setState({ sessions: {} })
  })

  it('opens from the rail and renders activity, diff, and preview tabs', () => {
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    fireEvent.click(screen.getByLabelText('Open workbench'))

    expect(screen.getByText('Agent Workbench')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /diff/i }))
    expect(screen.getByTestId('diff-preview')).toHaveTextContent('src/App.tsx')
    expect(screen.getByTestId('diff-preview')).toHaveTextContent('export const title')

    fireEvent.click(screen.getByRole('tab', { name: /preview/i }))
    expect(screen.getByTestId('code-preview')).toHaveTextContent('export const title')
  })

  it('selects bash output from the activity list into the preview tab', () => {
    useWorkbenchStore.getState().openWorkbench('session-1')
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    fireEvent.click(screen.getByRole('button', { name: /Bash/i }))

    expect(screen.getByTestId('code-preview')).toHaveTextContent('all tests passed')
  })

  it('renders attachment previews with parsed Markdown and sent prompt text', () => {
    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'preview' })
    render(
      <WorkbenchPanel
        sessionId="session-1"
        messages={[
          {
            id: 'user-1',
            type: 'user_text',
            content: '这是什么',
            timestamp: 1,
            attachments: [
              {
                type: 'image',
                name: 'screen.png',
                data: 'data:image/png;base64,abc123',
                mimeType: 'image/png',
              },
            ],
            attachmentParser: {
              promptText: '<附件解析结果>\n# 截图\n</附件解析结果>',
              results: [
                {
                  name: 'screen.png',
                  type: 'image',
                  mimeType: 'image/png',
                  method: 'vision',
                  markdown: '# 截图\n一个应用界面。',
                },
              ],
            },
          },
        ]}
      />,
    )

    expect(screen.getAllByText('screen.png').length).toBeGreaterThan(0)
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('一个应用界面')

    fireEvent.click(screen.getByText('Text sent to the main model'))
    expect(screen.getByTestId('code-preview')).toHaveTextContent('附件解析结果')
  })
})
