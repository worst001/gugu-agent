import { extractAgentRunModeDisplayText } from '../constants/agentRunModes'
import { isOfficeToolInternalFallbackRequest } from '../constants/officeTools'
import { extractTaskContextDisplayText } from '../constants/taskContextGraph'

export const FALLBACK_SESSION_TITLE = 'New Session'
const TITLE_MAX_LEN = 80

function extractAttachmentParserDisplayText(content: string): string | null {
  if (content.includes('<attachment_parse_results>') && content.includes('<user_message>')) {
    const match = content.match(/<user_message>\s*([\s\S]*?)\s*<\/user_message>/)
    return match?.[1] ?? null
  }

  if (!content.includes('<附件解析结果>') || !content.includes('<用户正文>')) {
    return null
  }
  const match = content.match(/<用户正文>\s*([\s\S]*?)\s*<\/用户正文>/)
  return match?.[1] ?? null
}

function extractOfficeToolboxDisplayText(content: string): string | null {
  if (!content.startsWith('[Office toolbox:') || !content.includes('User request:')) {
    return null
  }
  const match = content.match(/(?:^|\n)User request:\s*\n([\s\S]*)$/)
  const request = match?.[1] ?? null
  if (request !== null && isOfficeToolInternalFallbackRequest(request)) return ''
  return request
}

function looksLikeHiddenScaffoldTitle(title: string): boolean {
  return title.startsWith('[Workflow:') ||
    title.startsWith('[Agent mode:') ||
    title.startsWith('[Office toolbox:') ||
    title.startsWith('[Gugu context router]') ||
    title.includes('CE automation (binding)') ||
    title.includes('Default mode remains natural') ||
    title.includes('product-facing planning mode') ||
    title.includes('Gugu Agent Office Toolbox') ||
    title.includes('Internal single-run task context') ||
    title.includes('<attachment_parse_results>') ||
    title.includes('<闄勦欢瑙ｆ瀽缁撴灉>')
}

export function sanitizeSessionTitle(title: string): string {
  let stripped = title
  for (let i = 0; i < 3; i += 1) {
    const next = extractTaskContextDisplayText(stripped)
      ?? extractAgentRunModeDisplayText(stripped)
      ?? extractAttachmentParserDisplayText(stripped)
      ?? extractOfficeToolboxDisplayText(stripped)
    if (next === null || next === stripped) break
    stripped = next
  }

  const cleaned = stripped.replace(/\s+/g, ' ').trim()
  if (
    !cleaned ||
    cleaned.startsWith('[Workflow:') ||
    cleaned.startsWith('[Agent mode:') ||
    looksLikeHiddenScaffoldTitle(cleaned) ||
    cleaned.includes('CE automation (binding)') ||
    cleaned.includes('<attachment_parse_results>') ||
    cleaned.includes('<附件解析结果>')
  ) {
    return FALLBACK_SESSION_TITLE
  }

  return cleaned.length > TITLE_MAX_LEN ? `${cleaned.slice(0, TITLE_MAX_LEN)}...` : cleaned
}
