import { create } from 'zustand'
import type { ThemeMode } from '../types/settings'

const THEME_STORAGE_KEY = 'cc-haha-theme'
const SIDEBAR_WIDTH_STORAGE_KEY = 'gugu-agent-sidebar-width-v1'
const CAPABILITY_PANEL_COLLAPSED_STORAGE_KEY = 'gugu-agent-capability-panel-collapsed-v1'
const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 420

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* localStorage unavailable */ }
  return 'light'
}

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function getStoredSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
    if (Number.isFinite(stored)) return clampSidebarWidth(stored)
  } catch { /* localStorage unavailable */ }
  return DEFAULT_SIDEBAR_WIDTH
}

function getStoredCapabilityPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(CAPABILITY_PANEL_COLLAPSED_STORAGE_KEY) === 'true'
  } catch { /* localStorage unavailable */ }
  return false
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme() {
  applyTheme(getStoredTheme())
}

export type Toast = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export type SettingsTab =
  | 'providers'
  | 'attachmentParser'
  | 'configBackup'
  | 'permissions'
  | 'general'
  | 'adapters'
  | 'terminal'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'computerUse'
  | 'billing'
  | 'about'

type ActiveView = 'code' | 'scheduled' | 'terminal' | 'history' | 'settings'

type UIStore = {
  theme: ThemeMode
  sidebarOpen: boolean
  sidebarWidth: number
  capabilityPanelCollapsed: boolean
  activeView: ActiveView
  pendingSettingsTab: SettingsTab | null
  activeModal: string | null
  toasts: Toast[]

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  resetSidebarWidth: () => void
  setCapabilityPanelCollapsed: (collapsed: boolean) => void
  toggleCapabilityPanel: () => void
  setActiveView: (view: ActiveView) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

export const useUIStore = create<UIStore>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  capabilityPanelCollapsed: getStoredCapabilityPanelCollapsed(),
  activeView: 'code',
  pendingSettingsTab: null,
  activeModal: null,
  toasts: [],

  setTheme: (theme) => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* noop */ }
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* noop */ }
      return { theme: next }
    })
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => {
    const next = clampSidebarWidth(width)
    try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next)) } catch { /* noop */ }
    set({ sidebarWidth: next })
  },
  resetSidebarWidth: () => {
    try { localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY) } catch { /* noop */ }
    set({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })
  },
  setCapabilityPanelCollapsed: (collapsed) => {
    try { localStorage.setItem(CAPABILITY_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed)) } catch { /* noop */ }
    set({ capabilityPanelCollapsed: collapsed })
  },
  toggleCapabilityPanel: () => {
    set((state) => {
      const next = !state.capabilityPanelCollapsed
      try { localStorage.setItem(CAPABILITY_PANEL_COLLAPSED_STORAGE_KEY, String(next)) } catch { /* noop */ }
      return { capabilityPanelCollapsed: next }
    })
  },
  setActiveView: (view) => set({ activeView: view }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    // Auto-remove after duration
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
