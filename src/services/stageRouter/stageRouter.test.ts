import { describe, expect, test } from 'bun:test'

import {
  buildStagePlanPrompt,
  DEFAULT_STAGE_ROUTER,
  formatStageRouterStatus,
} from './stageRouter.js'

describe('stage router status', () => {
  test('formats the active routing policy', () => {
    const status = formatStageRouterStatus({
      ...DEFAULT_STAGE_ROUTER,
      enabled: true,
      executorModel: 'deepseek-v4',
      cursorCommand: 'agent',
      cursorModel: 'gpt-5.5-extra-high',
      cursorReasoning: 'extra-high',
    })

    expect(status).toContain('Stage router: enabled')
    expect(status).toContain('Planner: cursor')
    expect(status).toContain('Reviewer: cursor')
    expect(status).toContain('Executor model: deepseek-v4')
    expect(status).toContain('Cursor command: agent')
    expect(status).toContain('Cursor model: gpt-5.5-extra-high')
    expect(status).toContain('Cursor reasoning: extra-high')
  })

  test('shows default Cursor model when no model is configured', () => {
    const status = formatStageRouterStatus({
      ...DEFAULT_STAGE_ROUTER,
      cursorModel: '',
      cursorReasoning: '',
    })

    expect(status).toContain('Cursor model: default')
    expect(status).toContain('Cursor reasoning: auto')
  })
})

describe('stage router prompts', () => {
  test('keeps ChatGPT planning bounded for DeepSeek execution', () => {
    const prompt = buildStagePlanPrompt('add the feature', 'deepseek-v4')

    expect(prompt).toContain('add the feature')
    expect(prompt).toContain('deepseek-v4')
    expect(prompt).toContain('Do not edit files or run write operations')
    expect(prompt).toContain('DeepSeek execution prompt')
  })
})
