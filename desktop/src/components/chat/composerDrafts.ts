export const COMPOSER_DRAFTS_STORAGE_KEY = 'cc-haha-composer-drafts-v1'

const MAX_DRAFTS = 50
const MAX_DRAFT_TEXT_LENGTH = 100_000

export type ComposerDraft = {
  text: string
  updatedAt: number
}

type ComposerDraftMap = Record<string, ComposerDraft>

export function loadComposerDraft(sessionId: string): ComposerDraft | null {
  const drafts = readDrafts()
  const draft = drafts[sessionId]
  return draft?.text ? draft : null
}

export function saveComposerDraft(sessionId: string, text: string): void {
  const normalized = text.slice(0, MAX_DRAFT_TEXT_LENGTH)
  if (!normalized.trim()) {
    clearComposerDraft(sessionId)
    return
  }

  const drafts = readDrafts()
  drafts[sessionId] = {
    text: normalized,
    updatedAt: Date.now(),
  }
  writeDrafts(pruneDrafts(drafts))
}

export function clearComposerDraft(sessionId: string): void {
  const drafts = readDrafts()
  if (!drafts[sessionId]) return
  delete drafts[sessionId]
  writeDrafts(drafts)
}

function readDrafts(): ComposerDraftMap {
  try {
    const raw = localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ComposerDraftMap
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function writeDrafts(drafts: ComposerDraftMap): void {
  try {
    localStorage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // localStorage can be disabled or full; losing a draft is better than blocking input.
  }
}

function pruneDrafts(drafts: ComposerDraftMap): ComposerDraftMap {
  const entries = Object.entries(drafts)
    .filter(([, draft]) => draft?.text)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFTS)
  return Object.fromEntries(entries)
}
