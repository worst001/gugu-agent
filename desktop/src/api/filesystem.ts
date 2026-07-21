import { api } from './client'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

type BrowseResult = {
  currentPath: string
  parentPath: string
  entries: DirEntry[]
  query?: string
}

type RevealResult = {
  ok: true
  path: string
  isDirectory: boolean
}

export type FileMetadata = {
  name: string
  path: string
  isDirectory: boolean
  size: number
  mimeType?: string
}

type FileMetadataResponse = {
  files: FileMetadata[]
}

type WorkspacePreviewResponse = {
  url: string
}

type NativeRevealResult = {
  path: string
  is_directory?: boolean
  isDirectory?: boolean
}

export type WorkspaceDirEntry = {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export type WorkspaceDirResult = {
  root: string
  path: string
  entries: WorkspaceDirEntry[]
  truncated: boolean
}

export type WorkspaceTextFileResult = {
  name: string
  path: string
  language: string
  content: string
  size: number
  truncated: boolean
}

type NativeWorkspaceDirEntry = {
  name: string
  path: string
  is_directory?: boolean
  isDirectory?: boolean
  size: number
}

type NativeWorkspaceDirResult = {
  root: string
  path: string
  entries: NativeWorkspaceDirEntry[]
  truncated: boolean
}

async function revealWithNativeCommand(path: string): Promise<RevealResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<NativeRevealResult>('reveal_path', { path })
    return {
      ok: true,
      path: result.path,
      isDirectory: Boolean(result.isDirectory ?? result.is_directory),
    }
  } catch {
    return null
  }
}

async function openWithNativeCommand(path: string): Promise<RevealResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<NativeRevealResult>('open_path', { path })
    return {
      ok: true,
      path: result.path,
      isDirectory: Boolean(result.isDirectory ?? result.is_directory),
    }
  } catch {
    return null
  }
}

export const filesystemApi = {
  browse(path?: string, options?: { includeFiles?: boolean }) {
    const q = new URLSearchParams()
    if (path) q.set('path', path)
    if (options?.includeFiles) q.set('includeFiles', 'true')
    const qs = q.toString()
    return api.get<BrowseResult>(`/api/filesystem/browse${qs ? `?${qs}` : ''}`)
  },

  search(query: string, cwd?: string) {
    const q = new URLSearchParams({ search: query, maxResults: '200' })
    if (cwd) q.set('path', cwd)
    return api.get<BrowseResult>(`/api/filesystem/browse?${q}`)
  },

  metadata(paths: string[]) {
    return api.post<FileMetadataResponse>('/api/filesystem/metadata', { paths })
  },

  prepareWorkspacePreview(sessionId: string, path: string) {
    return api.post<WorkspacePreviewResponse>('/api/filesystem/preview', { sessionId, path })
  },

  async reveal(path: string): Promise<RevealResult> {
    try {
      return await api.post<RevealResult>('/api/filesystem/reveal', { path })
    } catch (error) {
      const nativeResult = await revealWithNativeCommand(path)
      if (nativeResult) return nativeResult
      throw error
    }
  },

  async open(path: string): Promise<RevealResult> {
    try {
      return await api.post<RevealResult>('/api/filesystem/open', { path })
    } catch (error) {
      const nativeResult = await openWithNativeCommand(path)
      if (nativeResult) return nativeResult
      throw error
    }
  },

  async listWorkspaceDir(root: string, path?: string): Promise<WorkspaceDirResult> {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<NativeWorkspaceDirResult>('list_workspace_dir', {
      input: { root, path },
    })
    return {
      ...result,
      entries: result.entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        isDirectory: Boolean(entry.isDirectory ?? entry.is_directory),
        size: entry.size,
      })),
    }
  },

  async readWorkspaceTextFile(root: string, path: string): Promise<WorkspaceTextFileResult> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<WorkspaceTextFileResult>('read_workspace_text_file', {
      input: { root, path },
    })
  },
}
