import { createElement } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filesystemApi } from '../../api/filesystem'
import { getFileIcon, WorkspaceFileTree } from './WorkspaceFileTree'

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    listWorkspaceDir: vi.fn(),
    readWorkspaceTextFile: vi.fn(),
    open: vi.fn(),
    reveal: vi.fn(),
  },
}))

vi.mock('../chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => createElement('pre', null, code),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getFileIcon', () => {
  it('distinguishes common workspace file types and keeps a fallback', () => {
    expect(getFileIcon('knowledge-map-smoke.md')).toMatchObject({
      glyph: 'markdown',
      color: 'text-[#519ABA]',
    })
    expect(getFileIcon('create_excel.py')).toMatchObject({
      glyph: 'terminal',
      color: 'text-[#FFD43B]',
    })
    expect(getFileIcon('Best_Skills_2026.xlsx')).toMatchObject({
      glyph: 'table_view',
      color: 'text-[#21A366]',
    })
    expect(getFileIcon('Dockerfile')).toMatchObject({
      glyph: 'deployed_code',
      color: 'text-[#2496ED]',
    })
    expect(getFileIcon('unknown.bin')).toMatchObject({ glyph: 'draft' })
  })
})

describe('WorkspaceFileTree', () => {
  it('ignores directory and preview responses from the previous workspace', async () => {
    const oldDirectory = deferred<Awaited<ReturnType<typeof filesystemApi.listWorkspaceDir>>>()
    const oldPreview = deferred<Awaited<ReturnType<typeof filesystemApi.readWorkspaceTextFile>>>()

    vi.mocked(filesystemApi.listWorkspaceDir).mockImplementation(async (root) => {
      if (root === 'D:/Old') return oldDirectory.promise
      return {
        root,
        path: root,
        truncated: false,
        entries: [{ name: 'new.md', path: 'D:/New/new.md', isDirectory: false, size: 3 }],
      }
    })
    vi.mocked(filesystemApi.readWorkspaceTextFile).mockImplementation(async (root) => {
      if (root === 'D:/Old') return oldPreview.promise
      return {
        name: 'new.md',
        path: 'D:/New/new.md',
        language: 'markdown',
        content: 'new workspace content',
        size: 21,
        truncated: false,
      }
    })

    const fallback = createElement('div', null, 'fallback')
    const { rerender } = render(createElement(WorkspaceFileTree, {
      root: 'D:/Old',
      initialPath: 'old.md',
      fallback,
    }))
    await waitFor(() => {
      expect(filesystemApi.listWorkspaceDir).toHaveBeenCalledWith('D:/Old', undefined)
      expect(filesystemApi.readWorkspaceTextFile).toHaveBeenCalledWith('D:/Old', 'old.md')
    })

    rerender(createElement(WorkspaceFileTree, {
      root: 'D:/New',
      initialPath: 'new.md',
      fallback,
    }))
    expect(await screen.findByText('new workspace content')).toBeInTheDocument()
    expect((await screen.findAllByText('new.md')).length).toBeGreaterThan(0)

    await act(async () => {
      oldDirectory.resolve({
        root: 'D:/Old',
        path: 'D:/Old',
        truncated: false,
        entries: [{ name: 'old.md', path: 'D:/Old/old.md', isDirectory: false, size: 3 }],
      })
      oldPreview.resolve({
        name: 'old.md',
        path: 'D:/Old/old.md',
        language: 'markdown',
        content: 'old workspace content',
        size: 21,
        truncated: false,
      })
      await Promise.all([oldDirectory.promise, oldPreview.promise])
    })

    expect(screen.queryByText('old workspace content')).not.toBeInTheDocument()
    expect(screen.queryByText('old.md')).not.toBeInTheDocument()
    expect(screen.getByText('new workspace content')).toBeInTheDocument()
  })
})
