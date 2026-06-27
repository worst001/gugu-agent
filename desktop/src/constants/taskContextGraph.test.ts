import { describe, expect, it } from 'vitest'
import {
  TASK_CONTEXT_GRAPH,
  buildTaskContextMessage,
  buildTaskContextNotice,
  classifyTaskContext,
  extractTaskContextDisplayText,
  inferTaskContextInputTypes,
  resolveTaskContextModelPreference,
} from './taskContextGraph'

describe('taskContextGraph', () => {
  it('defines a complete static graph with stable unique ids', () => {
    expect(TASK_CONTEXT_GRAPH.length).toBeGreaterThanOrEqual(20)

    const ids = new Set<string>()
    for (const node of TASK_CONTEXT_GRAPH) {
      expect(node.id).toBeTruthy()
      expect(ids.has(node.id)).toBe(false)
      ids.add(node.id)

      expect(node.label).toBeTruthy()
      expect(node.aliases.length).toBeGreaterThan(0)
      expect(node.inputTypes.length).toBeGreaterThan(0)
      expect(node.outputTypes.length).toBeGreaterThan(0)
      expect(node.recommendedModel).toMatch(/^(flash|pro|vision)$/u)
      expect(node.guardrails.length).toBeGreaterThan(0)
      expect(node.checklist.length).toBeGreaterThan(0)
    }
  })

  it('infers common attachment input types from names and mime types', () => {
    expect(inferTaskContextInputTypes([
      { name: 'sales.xlsx' },
      { name: 'brief.pdf' },
      { name: 'poster.png' },
      { name: 'notes', type: 'text/plain' },
    ])).toEqual(['spreadsheet', 'pdf', 'image', 'text'])
  })

  it('uses explicit toolbox selection when no final output format conflicts', () => {
    const result = classifyTaskContext({
      officeTool: 'document-summary',
      text: '顺便帮我看一段代码报错',
    })

    expect(result.primaryNodeId).toBe('document-summary')
    expect(result.taskType).toBe('document-summary')
    expect(result.source).toBe('office-tool')
    expect(result.confidence).toBe(1)
  })

  it('keeps explicitly requested final output ahead of a conflicting toolbox route', () => {
    const result = classifyTaskContext({
      officeTool: 'document-summary',
      text: '把这个 PDF 转成 PPT，先给我页面结构',
      attachments: [{ name: 'brief.pdf' }],
    })

    expect(result.primaryNodeId).toBe('ppt-draft')
    expect(result.taskType).toBe('ppt-draft')
    expect(result.matchedSignals).toEqual(expect.arrayContaining(['explicit-output:ppt-draft']))
  })

  it('recognizes brand and social copywriting tasks', () => {
    const result = classifyTaskContext({
      text: '帮我写一篇适合小红书的品牌文案，突出差异化',
    })

    expect(result.taskType).toMatch(/^(brand-content|social-copywriting)$/u)
    expect(result.matchedNodeIds).toEqual(expect.arrayContaining(['brand-content']))
    expect(result.recommendedModel).toBe('pro')
    expect(result.checklist.join('\n')).toMatch(/卖点|Selling point|目标人群|Target audience/iu)
  })

  it('recognizes WeChat article scenarios as social copywriting', () => {
    const result = classifyTaskContext({
      text: '帮我写一篇公众号文章，面向中小企业老板讲 Gugu Agent 的价值',
    })

    expect(result.primaryNodeId).toBe('wechat-article')
    expect(result.taskType).toBe('social-copywriting')
    expect(result.platforms).toContain('wechat')
    expect(result.skills).toEqual(expect.arrayContaining(['document-master']))
    expect(result.tools).not.toContain('WebFetch')
  })

  it('only suggests WebFetch for social copywriting when the user gives web context', () => {
    const result = classifyTaskContext({
      text: '根据这个链接写一篇小红书文案：https://example.com/product',
    })

    expect(result.taskType).toBe('social-copywriting')
    expect(result.tools).toContain('WebFetch')
  })

  it('recognizes ecommerce product selection analysis scenarios', () => {
    const result = classifyTaskContext({
      text: '分析这份商品 Top 表，帮我找潜力商品和选品机会',
      attachments: [{ name: 'products-top.xlsx' }],
    })

    expect(result.primaryNodeId).toBe('ecommerce-selection-analysis')
    expect(result.taskType).toBe('spreadsheet-analysis')
    expect(result.skills).toEqual(expect.arrayContaining(['spreadsheet-master', 'excel-master']))
    expect(result.checklist.join('\n')).toMatch(/Gross margin|Opportunity tier|Next action/iu)
  })

  it('recognizes bug-fix requests and prefers the strong coding path', () => {
    const result = classifyTaskContext({
      text: '这个报错怎么修，页面提交后 crash 了',
      workDir: 'D:/project/app',
    })

    expect(result.primaryNodeId).toBe('bug-fix')
    expect(result.taskType).toBe('bug-fix')
    expect(result.recommendedModel).toBe('pro')
    expect(result.mcp).toContain('codegraph')
  })

  it('does not confuse TypeScript with social video script tasks', () => {
    const result = classifyTaskContext({
      text: '这个 TypeScript 报错怎么修，给我定位原因',
    })

    expect(result.primaryNodeId).toBe('bug-fix')
    expect(result.taskType).toBe('bug-fix')
    expect(result.mcp).toContain('codegraph')
  })

  it('routes programming scripts to coding while keeping video scripts social', () => {
    const coding = classifyTaskContext({
      text: '帮我写一个 Python 脚本处理 Excel',
    })
    const video = classifyTaskContext({
      text: '帮我写一个抖音短视频脚本',
    })

    expect(coding.primaryNodeId).toBe('coding')
    expect(coding.taskType).toBe('coding')
    expect(video.primaryNodeId).toBe('douyin-script')
    expect(video.taskType).toBe('social-copywriting')
  })

  it('routes spreadsheet attachments to spreadsheet analysis', () => {
    const result = classifyTaskContext({
      text: '分析一下',
      attachments: [{ name: 'orders-2026.xlsx' }],
    })

    expect(result.primaryNodeId).toBe('spreadsheet-analysis')
    expect(result.taskType).toBe('spreadsheet-analysis')
    expect(result.skills).toEqual(expect.arrayContaining(['excel-master']))
  })

  it('keeps explicit PPT output ahead of source document helpers', () => {
    const result = classifyTaskContext({
      text: '把这个 PDF 转成 PPT',
      attachments: [{ name: 'product-plan.pdf' }],
    })

    expect(result.primaryNodeId).toBe('ppt-draft')
    expect(result.taskType).toBe('ppt-draft')
    expect(result.skills).toEqual(expect.arrayContaining(['ppt-master']))
    expect(result.skills).toEqual(expect.arrayContaining(['pdf-master', 'local-office-files']))
  })

  it('recognizes explicit spreadsheet deliverables from natural language', () => {
    const result = classifyTaskContext({
      text: '把这些数据整理成 Excel 表格，方便我继续编辑',
      attachments: [{ name: 'notes.pdf' }],
    })

    expect(result.primaryNodeId).toBe('spreadsheet-analysis')
    expect(result.taskType).toBe('spreadsheet-analysis')
    expect(result.matchedSignals).toEqual(expect.arrayContaining(['explicit-output:spreadsheet-analysis']))
  })

  it('recognizes report and work-log deliverables', () => {
    const result = classifyTaskContext({
      text: '写一份工作日报，沉淀今天的推进情况',
    })

    expect(result.primaryNodeId).toBe('report-writing')
    expect(result.taskType).toBe('report-writing')
  })

  it('recognizes app operation requests as computer use', () => {
    const result = classifyTaskContext({
      text: '帮我打开腾讯会议，设置一个半小时后的会议',
    })

    expect(result.primaryNodeId).toBe('computer-use')
    expect(result.taskType).toBe('computer-use')
    expect(result.riskLevel).toBe('high')
  })

  it('keeps casual chat on the general path', () => {
    const result = classifyTaskContext({ text: 'hello，今天怎么样' })

    expect(result.primaryNodeId).toBe('general-chat')
    expect(result.taskType).toBe('general-chat')
    expect(result.recommendedModel).toBe('flash')
    expect(result.confidence).toBeGreaterThan(0)
  })
  it('wraps clear specialized tasks with an internal route scaffold', () => {
    const result = buildTaskContextMessage('Please debug this crash', {
      text: 'Please debug this crash',
      workDir: 'D:/project/app',
    })

    expect(result).not.toBeNull()
    expect(result?.wire).toContain('[Gugu context router]')
    expect(result?.wire).toContain('Detected task:')
    expect(result?.wire).toContain('User message:')
    expect(result?.wire).toContain('Please debug this crash')
    expect(result?.wire).toContain('CodeGraph is an optional structure-understanding enhancement')
    expect(result?.display).toBe('Please debug this crash')
    expect(extractTaskContextDisplayText(result?.wire ?? '')).toBe('Please debug this crash')
  })

  it('does not wrap casual chat', () => {
    expect(buildTaskContextMessage('hello', { text: 'hello' })).toBeNull()
  })

  it('maps task context to a one-turn model lane preference without forcing flash', () => {
    const bugFix = classifyTaskContext({
      text: 'Please debug this crash',
      workDir: 'D:/project/app',
    })
    const mailDraft = classifyTaskContext({
      officeTool: 'mail-draft',
      text: 'Draft a short follow-up email',
    })
    const casual = classifyTaskContext({ text: 'hello' })

    expect(resolveTaskContextModelPreference(bugFix)).toBe('strong')
    expect(resolveTaskContextModelPreference(mailDraft)).toBeUndefined()
    expect(resolveTaskContextModelPreference(casual)).toBeUndefined()
  })

  it('builds a user-facing task notice without internal skill names', () => {
    const message = buildTaskContextMessage('Build a launch deck', {
      officeTool: 'ppt-draft',
      text: 'Build a launch deck',
    })
    const notice = message
      ? buildTaskContextNotice(message.classification, message.modelPreference)
      : null

    expect(notice).toContain('已识别为')
    expect(notice).toContain('PPT')
    expect(notice).not.toContain('ppt-master')
    expect(notice).not.toContain('[Gugu context router]')
  })

  it('does not include project profile context in the hidden scaffold', () => {
    const message = buildTaskContextMessage('Build a launch deck', {
      text: 'Build a launch deck',
      officeTool: 'ppt-draft',
    })

    expect(message?.wire).not.toContain('Local project profile')
    expect(message?.wire).not.toContain('Project Profile')
  })
})
