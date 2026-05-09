import { create } from 'zustand'
import { CE_WORKFLOW_DEFAULT_ROLE_ID } from '../constants/ceWorkflowRoles'

const STORAGE_KEY = 'cc-haha-ce-workflow-role-v1'

export const DRAFT_CE_WORKFLOW_KEY = '__draft__'

type CeWorkflowRoleStore = {
  selections: Record<string, string>
  setRole: (key: string, roleId: string) => void
  clearRole: (key: string) => void
  moveRole: (fromKey: string, toKey: string) => void
}

function loadSelections(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, string>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // noop
  }
}

export const useCeWorkflowRoleStore = create<CeWorkflowRoleStore>((set) => ({
  selections: loadSelections(),

  setRole: (key, roleId) =>
    set((state) => {
      const selections = { ...state.selections, [key]: roleId }
      persistSelections(selections)
      return { selections }
    }),

  clearRole: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      return { selections: rest }
    }),

  moveRole: (fromKey, toKey) =>
    set((state) => {
      const roleId = state.selections[fromKey] ?? CE_WORKFLOW_DEFAULT_ROLE_ID
      const { [fromKey]: _removed, ...rest } = state.selections
      const selections = { ...rest, [toKey]: roleId }
      persistSelections(selections)
      return { selections }
    }),
}))
