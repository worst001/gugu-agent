import { create } from 'zustand'

export type WorkbenchTab = 'activity' | 'diff' | 'preview'

const WORKBENCH_WIDTH_STORAGE_KEY = 'gugu-agent-workbench-width-v1'
const DEFAULT_WORKBENCH_WIDTH = 390
const MIN_WORKBENCH_WIDTH = 320
const MAX_WORKBENCH_WIDTH = 720

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
  panelWidth: number
  getSessionState: (sessionId: string) => SessionWorkbenchState
  setPanelWidth: (width: number) => void
  resetPanelWidth: () => void
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

function getMaxWorkbenchWidth(): number {
  if (typeof window === 'undefined') return MAX_WORKBENCH_WIDTH
  return Math.min(MAX_WORKBENCH_WIDTH, Math.max(MIN_WORKBENCH_WIDTH, Math.floor(window.innerWidth * 0.5)))
}

function clampWorkbenchWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WORKBENCH_WIDTH
  return Math.min(getMaxWorkbenchWidth(), Math.max(MIN_WORKBENCH_WIDTH, Math.round(width)))
}

function getStoredWorkbenchWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY))
    if (Number.isFinite(stored)) return clampWorkbenchWidth(stored)
  } catch { /* localStorage unavailable */ }
  return DEFAULT_WORKBENCH_WIDTH
}

function getStateFor(
  sessions: Record<string, SessionWorkbenchState>,
  sessionId: string,
): SessionWorkbenchState {
  return sessions[sessionId] ?? DEFAULT_WORKBENCH_STATE
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  sessions: {},
  panelWidth: getStoredWorkbenchWidth(),

  getSessionState: (sessionId) => getStateFor(get().sessions, sessionId),

  setPanelWidth: (width) => {
    const next = clampWorkbenchWidth(width)
    try { localStorage.setItem(WORKBENCH_WIDTH_STORAGE_KEY, String(next)) } catch { /* noop */ }
    set({ panelWidth: next })
  },

  resetPanelWidth: () => {
    try { localStorage.removeItem(WORKBENCH_WIDTH_STORAGE_KEY) } catch { /* noop */ }
    set({ panelWidth: DEFAULT_WORKBENCH_WIDTH })
  },

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
