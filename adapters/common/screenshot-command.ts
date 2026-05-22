const SCREENSHOT_COMMANDS = new Set([
  '/screenshot',
  '/screen',
  '/shot',
  '截图',
  '截屏',
  '屏幕截图',
  '发截图',
  '发一张截图',
  '截图给我',
  '截屏给我',
  '截个图',
  '截一下屏',
  '再试一次截图',
  '再试一次截屏',
  '重新截图',
  '重新截屏',
  '测试截图',
  '测试截屏',
])

export function isScreenshotCommand(text: string): boolean {
  const normalized = normalizeScreenshotText(text)
  if (SCREENSHOT_COMMANDS.has(normalized)) return true

  const directCandidate = normalized
    .replace(/^@.*?\s+(?=(截图|截屏|屏幕截图|截个图|截一下屏|screenshot|screen shot))/i, '')
    .replace(/^gu agent\s+(?=(截图|截屏|屏幕截图|截个图|截一下屏|screenshot|screen shot))/i, '')
    .replace(/[。！？!?.，,]/g, '')
    .trim()
  if (SCREENSHOT_COMMANDS.has(directCandidate)) return true

  if (!/(截图|截屏|屏幕截图|截个图|截一下屏|screenshot|screen shot)/i.test(normalized)) {
    return false
  }
  if (/(怎么|如何|为什么|功能|权限|失败|不能|无法|看看这个截图)/.test(normalized)) {
    return false
  }

  return /(帮我|给我|发我|发给我|发送|直接|现在|当前|一下|一张|当前屏幕|再试|重试|重新|测试|试试|试一下|试一次)/.test(normalized)
}

function normalizeScreenshotText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\[cq:at,[^\]]+]/gi, ' ')
    .replace(/<@[^>]+>/g, ' ')
    .replace(/<at[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
