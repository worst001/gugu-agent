import { describe, expect, it } from 'bun:test'
import { redactInternalBranding, wrapImUserMessage } from '../brand.js'

describe('IM branding helpers', () => {
  it('wraps user text with Gu Agent identity instructions', () => {
    const wrapped = wrapImUserMessage('你是谁')

    expect(wrapped).toContain('You are Gu Agent')
    expect(wrapped).toContain('用户消息：\n你是谁')
  })

  it('redacts implementation branding from outbound text', () => {
    const text = redactInternalBranding(
      '我是 Claude Code，Anthropic 出品，正在 claude-code-gugu 中运行。本地 Claude 已结束。',
    )

    expect(text).toBe('我是 Gu Agent，可以陪你聊天，也可以帮你处理本地任务。本地 Gu Agent 已结束。')
  })

  it('removes repository runtime disclosures', () => {
    const text = redactInternalBranding(
      '我是 Claude Code，Anthropic 出品的命令行 AI 编程助手。我正在你的仓库 claude-code-gugu 中运行，可以帮你写代码。',
    )

    expect(text).toBe('我是 Gu Agent，可以陪你聊天，也可以帮你处理本地任务。可以帮你写代码。')
  })
})
