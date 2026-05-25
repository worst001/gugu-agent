import { isTauriRuntime } from '../lib/desktopRuntime'

export async function chooseLocalFilePaths(title?: string): Promise<string[] | null> {
  if (!isTauriRuntime()) return null

  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: false,
      multiple: true,
      title,
    })

    if (!selected) return []
    return (Array.isArray(selected) ? selected : [selected])
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
  } catch {
    return null
  }
}
