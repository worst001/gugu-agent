import { extractAgentRunModeDisplayText } from '../constants/agentRunModes'

const FALLBACK_SESSION_TITLE = 'New Session'
const TITLE_MAX_LEN = 80

function extractAttachmentParserDisplayText(content: string): string | null {
  if (!content.includes('<附件解析结果>') || !content.includes('<用户正文>')) {
    return null
  }
  const match = content.match(/<用户正文>\s*([\s\S]*?)\s*<\/用户正文>/)
  return match?.[1] ?? null
}

export function sanitizeSessionTitle(title: string): string {
  let stripped = title
  for (let i = 0; i < 3; i += 1) {
    const next = extractAgentRunModeDisplayText(stripped)
      ?? extractAttachmentParserDisplayText(stripped)
    if (next === null || next === stripped) break
    stripped = next
  }

  const cleaned = stripped.replace(/\s+/g, ' ').trim()
  if (
    !cleaned ||
    cleaned.startsWith('[Workflow:') ||
    cleaned.startsWith('[Agent mode:') ||
    cleaned.includes('CE automation (binding)') ||
    cleaned.includes('<附件解析结果>')
  ) {
    return FALLBACK_SESSION_TITLE
  }

  return cleaned.length > TITLE_MAX_LEN ? `${cleaned.slice(0, TITLE_MAX_LEN)}...` : cleaned
}
