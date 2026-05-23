type TauriDragDropEvent = {
  payload?: {
    type?: string
    paths?: string[]
  }
}

type TauriFileDropHandlers = {
  onHover?: () => void
  onLeave?: () => void
  onDrop: (paths: string[]) => void
}

export async function listenForTauriFileDrop({
  onHover,
  onLeave,
  onDrop,
}: TauriFileDropHandlers): Promise<(() => void) | null> {
  try {
    const mod = await import('@tauri-apps/api/webview')
    const webview = mod.getCurrentWebview()
    return await webview.onDragDropEvent((event: TauriDragDropEvent) => {
      const payload = event.payload
      if (!payload) return

      if (payload.type === 'drop') {
        onLeave?.()
        const paths = Array.isArray(payload.paths) ? payload.paths : []
        if (paths.length > 0) onDrop(paths)
        return
      }

      if (payload.type === 'over' || payload.type === 'enter') {
        onHover?.()
        return
      }

      if (payload.type === 'leave' || payload.type === 'cancel') {
        onLeave?.()
      }
    })
  } catch {
    return null
  }
}
