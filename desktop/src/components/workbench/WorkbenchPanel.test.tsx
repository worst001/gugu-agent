import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { UIMessage } from '../../types/chat'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { WorkbenchPanel } from './WorkbenchPanel'
import { filesystemApi } from '../../api/filesystem'
import { nativeBrowserApi } from '../../api/nativeBrowser'
import type { NativeBrowserEvent } from '../../api/nativeBrowser'
import { openExternalFromAppAction } from '../../utils/appActions'

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

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    listWorkspaceDir: vi.fn(),
    readWorkspaceTextFile: vi.fn(),
    open: vi.fn(),
    reveal: vi.fn(),
  },
}))

vi.mock('../../utils/appActions', () => ({
  openExternalFromAppAction: vi.fn(),
}))

vi.mock('../../api/nativeBrowser', () => ({
  nativeBrowserApi: {
    isAvailable: vi.fn(() => true),
    create: vi.fn(async ({ sessionId, url }: { sessionId: string; url: string }) => ({ sessionId, url })),
    navigate: vi.fn(async ({ sessionId, url }: { sessionId: string; url: string }) => ({ sessionId, url })),
    setBounds: vi.fn(async () => {}),
    goBack: vi.fn(async () => {}),
    goForward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    listen: vi.fn(async () => vi.fn()),
  },
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
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ terminalDrawerOpen: false })
    useWorkbenchStore.setState({ sessions: {}, panelWidth: 390 })
    vi.mocked(filesystemApi.listWorkspaceDir).mockReset()
    vi.mocked(filesystemApi.readWorkspaceTextFile).mockReset()
    vi.mocked(filesystemApi.open).mockReset()
    vi.mocked(filesystemApi.reveal).mockReset()
    vi.mocked(openExternalFromAppAction).mockReset()
    vi.mocked(nativeBrowserApi.isAvailable).mockReturnValue(true)
    vi.mocked(nativeBrowserApi.create).mockClear()
    vi.mocked(nativeBrowserApi.navigate).mockClear()
    vi.mocked(nativeBrowserApi.setBounds).mockClear()
    vi.mocked(nativeBrowserApi.goBack).mockClear()
    vi.mocked(nativeBrowserApi.goForward).mockClear()
    vi.mocked(nativeBrowserApi.reload).mockClear()
    vi.mocked(nativeBrowserApi.stop).mockClear()
    vi.mocked(nativeBrowserApi.close).mockClear()
    vi.mocked(nativeBrowserApi.hide).mockClear()
    vi.mocked(nativeBrowserApi.listen).mockClear()
  })

  it('hides the workbench when closed and opens from the floating control', () => {
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    const collapsedPanel = screen.getByTestId('workbench-collapsed')
    expect(collapsedPanel).toBeInTheDocument()
    expect(collapsedPanel).not.toHaveClass('hidden')
    expect(collapsedPanel.className).not.toContain('xl:block')
    expect(screen.queryByText('Agent Workbench')).not.toBeInTheDocument()

    const openButton = screen.getByLabelText('Open workbench')
    expect(openButton.className).toContain('absolute right-3 top-2')
    expect(openButton).toHaveClass('h-7', 'w-7', 'bg-transparent')
    expect(openButton).not.toHaveClass('border', 'shadow-sm')

    fireEvent.click(openButton)
    expect(screen.getByTestId('workbench-panel')).toBeInTheDocument()
    expect(screen.getByText('Agent Workbench')).toBeInTheDocument()
    expect(screen.getByLabelText('Collapse workbench').className).toContain('absolute right-3 top-2')

    fireEvent.click(screen.getByRole('tab', { name: /review/i }))

    expect(screen.getByTestId('workbench-panel')).toBeInTheDocument()
    expect(screen.getByTestId('diff-preview')).toHaveTextContent('src/App.tsx')
  })

  it('toggles the terminal drawer from the floating workbench controls', () => {
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }))

    expect(useUIStore.getState().terminalDrawerOpen).toBe(true)
    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(useUIStore.getState().terminalDrawerOpen).toBe(false)
  })

  it('renders review, browser, files, and activity tabs when open', () => {
    useWorkbenchStore.getState().openWorkbench('session-1')
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    expect(screen.getByText('Agent Workbench')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /browser/i })).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /review/i }))
    expect(screen.getByTestId('diff-preview')).toHaveTextContent('src/App.tsx')
    expect(screen.getByTestId('diff-preview')).toHaveTextContent('export const title')

    fireEvent.click(screen.getByRole('tab', { name: /files/i }))
    expect(screen.getByTestId('code-preview')).toHaveTextContent('export const title')
  })

  it('creates the native browser from the browser workbench tab and navigates from the address bar', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect)

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'browser' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    const address = screen.getByLabelText('Enter URL or search')
    expect(address).toBeInTheDocument()
    expect(address).toHaveValue('')
    expect(screen.getByText('Enter a URL or search to open a page.')).toBeInTheDocument()
    expect(nativeBrowserApi.create).not.toHaveBeenCalled()

    fireEvent.change(address, { target: { value: 'github.com' } })
    fireEvent.submit(address.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(nativeBrowserApi.create).toHaveBeenCalledWith({
        sessionId: 'session-1',
        url: 'https://github.com',
        bounds: { x: 10, y: 20, width: 400, height: 300 },
      })
    })
    expect(nativeBrowserApi.close).not.toHaveBeenCalled()
    expect(nativeBrowserApi.navigate).not.toHaveBeenCalled()

    rectSpy.mockRestore()
  })

  it('hides the native browser when leaving the browser tab', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect)

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'browser' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    const address = screen.getByLabelText('Enter URL or search')
    fireEvent.change(address, { target: { value: 'github.com' } })
    fireEvent.submit(address.closest('form') as HTMLFormElement)
    await waitFor(() => expect(nativeBrowserApi.create).toHaveBeenCalled())
    await waitFor(() => {
      expect(useWorkbenchStore.getState().getSessionState('session-1').browserUrl).toBe('https://github.com')
    })

    fireEvent.click(screen.getByRole('tab', { name: /activity/i }))

    await waitFor(() => expect(nativeBrowserApi.hide).toHaveBeenCalledWith('session-1'))

    fireEvent.click(screen.getByRole('tab', { name: /browser/i }))

    await waitFor(() => {
      expect(nativeBrowserApi.create).toHaveBeenCalledTimes(2)
    })
    expect(nativeBrowserApi.create).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      url: 'https://github.com',
      bounds: { x: 10, y: 20, width: 400, height: 300 },
    })
    expect(screen.getByLabelText('Enter URL or search')).toHaveValue('https://github.com')

    rectSpy.mockRestore()
  })

  it('opens a search query only after the user submits it', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect)

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'browser' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    const address = screen.getByLabelText('Enter URL or search')
    expect(nativeBrowserApi.create).not.toHaveBeenCalled()

    fireEvent.change(address, { target: { value: '测试一下' } })
    fireEvent.submit(address.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(nativeBrowserApi.create).toHaveBeenCalledWith({
        sessionId: 'session-1',
        url: 'https://www.baidu.com/s?wd=%E6%B5%8B%E8%AF%95%E4%B8%80%E4%B8%8B',
        bounds: { x: 10, y: 20, width: 400, height: 300 },
      })
    })
    expect(nativeBrowserApi.navigate).not.toHaveBeenCalled()

    rectSpy.mockRestore()
  })

  it('shows a recoverable notice when the native browser keeps loading too long', async () => {
    let browserEventHandler: ((event: NativeBrowserEvent) => void) | null = null
    vi.mocked(nativeBrowserApi.listen).mockImplementationOnce(async (handler) => {
      browserEventHandler = handler
      return vi.fn()
    })

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'browser' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    await waitFor(() => expect(browserEventHandler).not.toBeNull())

    vi.useFakeTimers()
    try {
      act(() => {
        browserEventHandler?.({
          sessionId: 'session-1',
          event: 'loading-started',
          url: 'https://www.baidu.com/',
        })
      })

      expect(screen.getByText('Loading page...')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(30_000)
      })

      expect(screen.getByText('Page is taking longer than usual. You can keep waiting or open it externally.')).toBeInTheDocument()

      act(() => {
        browserEventHandler?.({
          sessionId: 'session-1',
          event: 'loading-finished',
          url: 'https://www.baidu.com/',
        })
      })

      expect(screen.queryByText('Page is taking longer than usual. You can keep waiting or open it externally.')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers to open blocked browser popups and downloads externally', async () => {
    let browserEventHandler: ((event: NativeBrowserEvent) => void) | null = null
    vi.mocked(nativeBrowserApi.listen).mockImplementationOnce(async (handler) => {
      browserEventHandler = handler
      return vi.fn()
    })

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'browser' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    await waitFor(() => expect(browserEventHandler).not.toBeNull())

    act(() => {
      browserEventHandler?.({
        sessionId: 'session-1',
        event: 'new-window',
        url: 'https://popup.example/',
      })
    })

    expect(screen.getByText('This page tried to open a new window. Use the external browser button if needed.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open in external browser' }))
    expect(openExternalFromAppAction).toHaveBeenCalledWith('https://popup.example/')

    act(() => {
      browserEventHandler?.({
        sessionId: 'session-1',
        event: 'download-requested',
        url: 'https://download.example/file.zip',
      })
    })

    expect(screen.getByText('This page requested a download. Open it in your external browser to download safely.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open in external browser' }))
    expect(openExternalFromAppAction).toHaveBeenLastCalledWith('https://download.example/file.zip')
  })

  it('allows the workbench to resize beyond the old half-width cap', () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1800 })

    useWorkbenchStore.getState().setPanelWidth(1000)
    useWorkbenchStore.getState().openWorkbench('session-1')
    render(<WorkbenchPanel sessionId="session-1" messages={messages} />)

    const panel = screen.getByTestId('workbench-panel')
    expect(panel).toHaveStyle({ width: '1000px' })
    expect(panel).toHaveStyle({ maxWidth: 'max(240px, calc(100% - 480px))' })

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
  })

  it('renders a workspace file tree and previews a selected file', async () => {
    vi.mocked(filesystemApi.listWorkspaceDir).mockImplementation(async (_root, path) => ({
      root: 'D:/Project',
      path: path ?? 'D:/Project',
      truncated: false,
      entries: path
        ? [
            { name: 'App.tsx', path: 'D:/Project/src/App.tsx', isDirectory: false, size: 12 },
          ]
        : [
            { name: 'src', path: 'D:/Project/src', isDirectory: true, size: 0 },
            { name: 'README.md', path: 'D:/Project/README.md', isDirectory: false, size: 8 },
          ],
    }))
    vi.mocked(filesystemApi.readWorkspaceTextFile).mockResolvedValue({
      name: 'App.tsx',
      path: 'D:/Project/src/App.tsx',
      language: 'typescript',
      content: 'export const app = true',
      size: 23,
      truncated: false,
    })

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'preview' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} workDir="D:/Project" />)

    expect(await screen.findByText('Project')).toBeInTheDocument()
    expect(await screen.findByText('src')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /src/i }))
    expect(await screen.findByText('App.tsx')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /App.tsx/i }))
    expect(await screen.findByText('export const app = true')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '定位' }))
    expect(filesystemApi.reveal).toHaveBeenCalledWith('D:/Project/src/App.tsx')

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(filesystemApi.open).toHaveBeenCalledWith('D:/Project/src/App.tsx')
  })

  it('shows recovery actions when a workspace file cannot be previewed', async () => {
    vi.mocked(filesystemApi.listWorkspaceDir).mockResolvedValue({
      root: 'D:/Project',
      path: 'D:/Project',
      truncated: false,
      entries: [
        { name: 'report.xlsx', path: 'D:/Project/report.xlsx', isDirectory: false, size: 1024 },
      ],
    })
    vi.mocked(filesystemApi.readWorkspaceTextFile).mockRejectedValue(new Error('只能预览 UTF-8 文本文件'))

    useWorkbenchStore.getState().openWorkbench('session-1', { activeTab: 'preview' })
    render(<WorkbenchPanel sessionId="session-1" messages={messages} workDir="D:/Project" />)

    fireEvent.click(await screen.findByRole('button', { name: /report.xlsx/i }))

    expect(await screen.findByText('不能预览此文件')).toBeInTheDocument()
    expect(screen.getByText('只能预览 UTF-8 文本文件')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '在目录中定位' }))
    expect(filesystemApi.reveal).toHaveBeenCalledWith('D:/Project/report.xlsx')

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }))
    expect(filesystemApi.open).toHaveBeenCalledWith('D:/Project/report.xlsx')
  })

  it('shows WebFetch output in the activity tab', () => {
    useWorkbenchStore.getState().openWorkbench('session-1')
    render(
      <WorkbenchPanel
        sessionId="session-1"
        messages={[
          {
            id: 'tool-web',
            type: 'tool_use',
            toolName: 'WebFetch',
            toolUseId: 'web-1',
            input: { url: 'https://example.com', prompt: 'summarize' },
            timestamp: 1,
          },
          {
            id: 'result-web',
            type: 'tool_result',
            toolUseId: 'web-1',
            content: 'Example Domain summary',
            isError: false,
            timestamp: 2,
          },
        ]}
      />,
    )

    expect(screen.getByText('WebFetch')).toBeInTheDocument()
    expect(screen.getByText('Example Domain summary')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open in external browser/i }))
    expect(openExternalFromAppAction).toHaveBeenCalledWith('https://example.com')
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
