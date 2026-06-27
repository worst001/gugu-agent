export function normalizeProjectKey(project: string | null | undefined): string {
  const trimmed = project?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}

export function expandProjectKeys(projects: Array<string | null | undefined>): string[] {
  const keys = new Set<string>()
  for (const project of projects) {
    const raw = project?.trim() ?? ''
    if (!raw) continue
    keys.add(raw)
    const normalized = normalizeProjectKey(raw)
    if (normalized) keys.add(normalized)
  }
  return Array.from(keys)
}

export function projectMatchesKey(project: string | null | undefined, key: string): boolean {
  const raw = project?.trim() ?? ''
  const normalized = normalizeProjectKey(raw)
  return Boolean(raw && (raw === key || normalized === normalizeProjectKey(key)))
}

export function isProjectInSet(projectSet: Set<string>, project: string | null | undefined): boolean {
  const raw = project?.trim() ?? ''
  if (!raw) return false
  return projectSet.has(raw) || projectSet.has(normalizeProjectKey(raw))
}
