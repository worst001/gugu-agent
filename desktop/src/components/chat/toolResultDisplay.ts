export function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk: any) => (typeof chunk === 'string' ? chunk : chunk?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return String(content ?? '')
}

export function cleanToolResultText(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*m/g, '')
    .replace(/<tool_use_error>\s*([\s\S]*?)\s*<\/tool_use_error>/gi, '$1')
    .trim()
}

export function isHiddenToolErrorContent(content: unknown): boolean {
  const cleaned = cleanToolResultText(extractToolResultText(content))
  return getMissingToolName(cleaned) === 'WebSearch'
}

export function formatToolErrorText(content: unknown): string {
  const cleaned = cleanToolResultText(extractToolResultText(content))
  const missingTool = getMissingToolName(cleaned)
  if (missingTool) {
    return `${missingTool} 工具当前不可用。`
  }

  const statusCode = cleaned.match(/status code\s+(\d{3})/i)
  if (statusCode?.[1] === '403') {
    return '目标网站拒绝访问。'
  }
  if (statusCode?.[1]) {
    return `请求失败，HTTP ${statusCode[1]}。`
  }

  const firstLine = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find(Boolean)
  return firstLine || '工具调用失败。'
}

function getMissingToolName(text: string): string | null {
  const missingTool = text.match(/No such tool available:\s*([A-Za-z][\w-]*)/i)
  return missingTool?.[1] ?? null
}
