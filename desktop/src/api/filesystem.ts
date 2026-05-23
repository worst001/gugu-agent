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

type NativeRevealResult = {
  path: string
  is_directory?: boolean
  isDirectory?: boolean
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

  async reveal(path: string): Promise<RevealResult> {
    try {
      return await api.post<RevealResult>('/api/filesystem/reveal', { path })
    } catch (error) {
      const nativeResult = await revealWithNativeCommand(path)
      if (nativeResult) return nativeResult
      throw error
    }
  },
}
