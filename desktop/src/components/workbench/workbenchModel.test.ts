import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../types/chat'
import {
  buildWorkbenchModel,
  findSelectedFileChange,
  findSelectedPreview,
} from './workbenchModel'

describe('buildWorkbenchModel', () => {
  it('aggregates tool activity, file changes, and previews from chat messages', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-write',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: { file_path: 'src/App.tsx', content: 'export const title = "GuGu"\n' },
        timestamp: 1,
      },
      {
        id: 'result-write',
        type: 'tool_result',
        toolUseId: 'write-1',
        content: 'created',
        isError: false,
        timestamp: 2,
      },
      {
        id: 'tool-edit',
        type: 'tool_use',
        toolName: 'Edit',
        toolUseId: 'edit-1',
        input: {
          file_path: 'src/App.tsx',
          old_string: 'GuGu',
          new_string: 'Claude Code GuGu',
        },
        timestamp: 3,
      },
      {
        id: 'tool-bash',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'bash-1',
        input: { command: 'bun test', description: 'Run tests' },
        timestamp: 4,
      },
      {
        id: 'result-bash',
        type: 'tool_result',
        toolUseId: 'bash-1',
        content: 'all tests passed',
        isError: false,
        timestamp: 5,
      },
      {
        id: 'tool-multi',
        type: 'tool_use',
        toolName: 'MultiEdit',
        toolUseId: 'multi-1',
        input: {
          file_path: 'src/App.tsx',
          edits: [
            { old_string: 'title', new_string: 'heading' },
            { old_string: 'GuGu', new_string: 'Claude Code GuGu' },
          ],
        },
        timestamp: 6,
      },
      {
        id: 'tool-notebook',
        type: 'tool_use',
        toolName: 'NotebookEdit',
        toolUseId: 'notebook-1',
        input: {
          notebook_path: 'analysis.ipynb',
          cell_id: 'cell-a',
          new_source: 'print("after")',
          edit_mode: 'replace',
        },
        timestamp: 7,
      },
      {
        id: 'result-notebook',
        type: 'tool_result',
        toolUseId: 'notebook-1',
        content: {
          original_file: '{"cells":[{"source":"print(\\"before\\")"}]}',
          updated_file: '{"cells":[{"source":"print(\\"after\\")"}]}',
        },
        isError: false,
        timestamp: 8,
      },
    ]

    const model = buildWorkbenchModel(messages)

    expect(model.activities.map((activity) => activity.toolName)).toEqual([
      'Write',
      'Edit',
      'Bash',
      'MultiEdit',
      'NotebookEdit',
    ])
    expect(model.activities.map((activity) => activity.status)).toEqual([
      'done',
      'running',
      'done',
      'running',
      'done',
    ])
    expect(model.fileChanges).toHaveLength(4)
    expect(model.fileChanges[0]).toMatchObject({
      kind: 'created',
      filePath: 'src/App.tsx',
      oldText: '',
    })
    expect(model.fileChanges[1]).toMatchObject({
      kind: 'edited',
      filePath: 'src/App.tsx',
      oldText: 'GuGu',
      newText: 'Claude Code GuGu',
    })
    expect(model.fileChanges[2]).toMatchObject({
      kind: 'multi_edit',
      filePath: 'src/App.tsx',
      oldText: 'title\n\n...\n\nGuGu',
      newText: 'heading\n\n...\n\nClaude Code GuGu',
    })
    expect(model.fileChanges[3]).toMatchObject({
      kind: 'notebook_edit',
      filePath: 'analysis.ipynb',
      oldText: '{"cells":[{"source":"print(\\"before\\")"}]}',
      newText: '{"cells":[{"source":"print(\\"after\\")"}]}',
    })
    expect(model.previews.some((preview) => preview.content.includes('all tests passed'))).toBe(true)
  })

  it('selects the latest file change by path and falls back to previews', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-a',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-a',
        input: { file_path: 'src/a.ts', content: 'a' },
        timestamp: 1,
      },
      {
        id: 'tool-b',
        type: 'tool_use',
        toolName: 'Edit',
        toolUseId: 'edit-a',
        input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
        timestamp: 2,
      },
    ]

    const model = buildWorkbenchModel(messages)

    expect(findSelectedFileChange(model, 'src/a.ts', null)?.toolUseId).toBe('edit-a')
    expect(findSelectedPreview(model, 'write-a', null)?.content).toBe('a')
  })

  it('hides unavailable WebSearch tool failures from workbench activity', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-search',
        type: 'tool_use',
        toolName: 'WebSearch',
        toolUseId: 'search-1',
        input: { query: 'latest anime rankings' },
        timestamp: 1,
      },
      {
        id: 'result-search',
        type: 'tool_result',
        toolUseId: 'search-1',
        content: '<tool_use_error>Error: No such tool available: WebSearch</tool_use_error>',
        isError: true,
        timestamp: 2,
      },
      {
        id: 'tool-write',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: { file_path: 'index.html', content: '<!DOCTYPE html>' },
        timestamp: 3,
      },
    ]

    const model = buildWorkbenchModel(messages)

    expect(model.resultMap.has('search-1')).toBe(false)
    expect(model.activities.map((activity) => activity.toolName)).toEqual(['Write'])
    expect(model.fileChanges).toHaveLength(1)
  })

  it('extracts attachment previews with GLM parsed Markdown metadata', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        type: 'user_text',
        content: '这是什么',
        timestamp: 1,
        attachments: [
          {
            type: 'image',
            name: 'screen.png',
            data: 'data:image/png;base64,abc123',
            mimeType: 'image/png',
          },
        ],
        attachmentParser: {
          promptText: '<附件解析结果>\n# 截图\n</附件解析结果>',
          results: [
            {
              name: 'screen.png',
              type: 'image',
              mimeType: 'image/png',
              method: 'vision',
              markdown: '# 截图\n一个应用界面。',
            },
          ],
        },
      },
    ]

    const model = buildWorkbenchModel(messages)

    expect(model.attachmentPreviews).toHaveLength(1)
    expect(model.attachmentPreviews[0]).toMatchObject({
      id: 'user-1:attachment-0',
      name: 'screen.png',
      kind: 'image',
      parserMethod: 'vision',
      parsedMarkdown: '# 截图\n一个应用界面。',
      promptText: '<附件解析结果>\n# 截图\n</附件解析结果>',
    })
  })
})
