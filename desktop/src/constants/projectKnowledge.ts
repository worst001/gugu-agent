export const PROJECT_KNOWLEDGE_TAB_PREFIX = '__project_knowledge__:'

export function createProjectKnowledgeTabId(workspacePath: string): string {
  return PROJECT_KNOWLEDGE_TAB_PREFIX + encodeURIComponent(workspacePath)
}

export function parseProjectKnowledgeTabId(tabId: string): string | null {
  if (!tabId.startsWith(PROJECT_KNOWLEDGE_TAB_PREFIX)) return null
  try {
    const workspacePath = decodeURIComponent(
      tabId.slice(PROJECT_KNOWLEDGE_TAB_PREFIX.length),
    ).trim()
    return workspacePath || null
  } catch {
    return null
  }
}
