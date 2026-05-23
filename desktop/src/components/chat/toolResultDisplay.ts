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
  const compact = cleaned.replace(/\s+/g, ' ').trim()
  const missingTool = getMissingToolName(compact)
  if (missingTool) {
    return `${missingTool} is unavailable in this runtime.`
  }

  if (/ripgrep is not available|ensure rg --version works/i.test(compact)) {
    return 'ripgrep is not available. Install ripgrep and retry.'
  }

  if (
    /python venv creation failed|NO PYTHON|python .*not (found|recognized)|python3 .*not (found|recognized)|venv/i
      .test(compact)
  ) {
    return 'Python environment is not ready. Open Computer Use settings to finish setup.'
  }

  const statusCode = compact.match(/status code\s+(\d{3})/i)
  if (statusCode?.[1] === '403') {
    return 'Target access was blocked.'
  }
  if (statusCode?.[1]) {
    return `Request failed with HTTP ${statusCode[1]}.`
  }

  const firstLine = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find(Boolean)
  return firstLine || 'Tool call failed.'
}

function getMissingToolName(text: string): string | null {
  const missingTool = text.match(/No such tool available:\s*([A-Za-z][\w-]*)/i)
  return missingTool?.[1] ?? null
}
