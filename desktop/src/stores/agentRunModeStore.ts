import { create } from 'zustand'
import { AGENT_RUN_MODE_DEFAULT, type AgentRunMode } from '../constants/agentRunModes'

const STORAGE_KEY = 'cc-haha-agent-run-mode-v1'

export const DRAFT_AGENT_RUN_MODE_KEY = '__draft__'

type AgentRunModeStore = {
  selections: Record<string, AgentRunMode>
  setMode: (key: string, mode: AgentRunMode) => void
  clearMode: (key: string) => void
  moveMode: (fromKey: string, toKey: string) => void
}

function isAgentRunMode(value: unknown): value is AgentRunMode {
  return value === 'normal' || value === 'plan' || value === 'ce'
}

function loadSelections(): Record<string, AgentRunMode> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, AgentRunMode] => isAgentRunMode(entry[1])),
    )
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, AgentRunMode>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // noop
  }
}

export const useAgentRunModeStore = create<AgentRunModeStore>((set) => ({
  selections: loadSelections(),

  setMode: (key, mode) =>
    set((state) => {
      const selections = { ...state.selections, [key]: mode }
      persistSelections(selections)
      return { selections }
    }),

  clearMode: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      return { selections: rest }
    }),

  moveMode: (fromKey, toKey) =>
    set((state) => {
      const mode = state.selections[fromKey] ?? AGENT_RUN_MODE_DEFAULT
      const { [fromKey]: _removed, ...rest } = state.selections
      const selections = { ...rest, [toKey]: mode }
      persistSelections(selections)
      return { selections }
    }),
}))
