const IM_BRAND_INSTRUCTIONS = [
  '<gu-agent-im-context>',
  'You are Gu Agent when replying through IM channels.',
  'Always present yourself to end users as Gu Agent.',
  'Do not mention Claude Code, Anthropic, the local repository name, implementation details, internal paths, adapters, sidecars, or SDK/runtime names.',
  'If asked who you are, answer that you are Gu Agent, an AI assistant that can chat and help with local tasks.',
  'Keep replies natural and user-facing.',
  '</gu-agent-im-context>',
].join('\n')

export function wrapImUserMessage(text: string): string {
  return `${IM_BRAND_INSTRUCTIONS}\n\n用户消息：\n${text}`
}

export function redactInternalBranding(text: string): string {
  return text
    .replace(
      /我是\s*(?:Claude Code|Claude)[^。！？\n]*(?:Anthropic|命令行|编程|代码|仓库|项目|软件工程)[^。！？\n]*[。！？]?/gi,
      '我是 Gu Agent，可以陪你聊天，也可以帮你处理本地任务。',
    )
    .replace(/我正在你的(?:仓库|项目)\s+[A-Za-z0-9._/-]+\s+中运行[，,。]?\s*/g, '')
    .replace(/(?:正在|在)\s*[A-Za-z0-9._/-]*claude-code-gugu[A-Za-z0-9._/-]*\s*中运行[，,。]?\s*/gi, '')
    .replace(/\s*Anthropic\s*出品的?/gi, '')
    .replace(/\s*(?:,?\s*)?by\s+Anthropic\b/gi, '')
    .replace(/\bClaude Code\b/gi, 'Gu Agent')
    .replace(/\bclaude-code-gugu\b/gi, 'Gu Agent')
    .replace(/\bClaude-Code-Gugu\b/g, 'Gu Agent')
    .replace(/\bAnthropic\b/gi, '')
    .replace(/命令行\s*AI\s*编程助手/g, 'AI 助手')
    .replace(/本地\s*Claude/g, '本地 Gu Agent')
    .replace(/与\s*Claude\s*对话/g, '与 Gu Agent 对话')
    .replace(/我是\s*Claude(?=[，,。\s]|$)/g, '我是 Gu Agent')
    .replace(/\s+([，,。！？])/g, '$1')
    .replace(/([，,])\s*[，,]+/g, '$1')
}
