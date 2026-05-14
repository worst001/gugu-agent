import { create } from 'zustand'

export type WorkbenchTab = 'activity' | 'diff' | 'preview'

type SessionWorkbenchState = {
  isOpen: boolean
  activeTab: WorkbenchTab
  selectedToolUseId: string | null
  selectedFilePath: string | null
  selectedAttachmentId: string | null
}

type WorkbenchSelection = {
  activeTab?: WorkbenchTab
  selectedToolUseId?: string | null
  selectedFilePath?: string | null
  selectedAttachmentId?: string | null
}

type WorkbenchStore = {
  sessions: Record<string, SessionWorkbenchState>
  getSessionState: (sessionId: string) => SessionWorkbenchState
  openWorkbench: (sessionId: string, selection?: WorkbenchSelection) => void
  closeWorkbench: (sessionId: string) => void
  toggleWorkbench: (sessionId: string) => void
  setActiveTab: (sessionId: string, tab: WorkbenchTab) => void
  selectTool: (sessionId: string, toolUseId: string | null, tab?: WorkbenchTab) => void
  selectFile: (sessionId: string, filePath: string | null, tab?: WorkbenchTab) => void
  selectAttachment: (sessionId: string, attachmentId: string | null) => void
}

const DEFAULT_WORKBENCH_STATE: SessionWorkbenchState = {
  isOpen: false,
  activeTab: 'activity',
  selectedToolUseId: null,
  selectedFilePath: null,
  selectedAttachmentId: null,
}

function getStateFor(
  sessions: Record<string, SessionWorkbenchState>,
  sessionId: string,
): SessionWorkbenchState {
  return sessions[sessionId] ?? DEFAULT_WORKBENCH_STATE
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  sessions: {},

  getSessionState: (sessionId) => getStateFor(get().sessions, sessionId),

  openWorkbench: (sessionId, selection) => {
    set((state) => {
      const current = getStateFor(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...current,
            isOpen: true,
            activeTab: selection?.activeTab ?? current.activeTab,
            selectedToolUseId:
              selection && 'selectedToolUseId' in selection
                ? selection.selectedToolUseId ?? null
                : current.selectedToolUseId,
            selectedFilePath:
              selection && 'selectedFilePath' in selection
                ? selection.selectedFilePath ?? null
                : current.selectedFilePath,
            selectedAttachmentId:
              selection && 'selectedAttachmentId' in selection
                ? selection.selectedAttachmentId ?? null
                : current.selectedAttachmentId,
          },
        },
      }
    })
  },

  closeWorkbench: (sessionId) => {
    set((state) => {
      const current = getStateFor(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...current,
            isOpen: false,
          },
        },
      }
    })
  },

  toggleWorkbench: (sessionId) => {
    set((state) => {
      const current = getStateFor(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...current,
            isOpen: !current.isOpen,
          },
        },
      }
    })
  },

  setActiveTab: (sessionId, tab) => {
    set((state) => {
      const current = getStateFor(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...current,
            isOpen: true,
            activeTab: tab,
          },
        },
      }
    })
  },

  selectTool: (sessionId, toolUseId, tab) => {
    get().openWorkbench(sessionId, {
      activeTab: tab,
      selectedToolUseId: toolUseId,
      selectedAttachmentId: null,
    })
  },

  selectFile: (sessionId, filePath, tab) => {
    get().openWorkbench(sessionId, {
      activeTab: tab,
      selectedFilePath: filePath,
      selectedAttachmentId: null,
    })
  },

  selectAttachment: (sessionId, attachmentId) => {
    get().openWorkbench(sessionId, {
      activeTab: 'preview',
      selectedAttachmentId: attachmentId,
      selectedToolUseId: null,
      selectedFilePath: null,
    })
  },
}))
