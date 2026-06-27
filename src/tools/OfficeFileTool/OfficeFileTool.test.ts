import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../../tools.js'
import { OfficeFileTool } from './OfficeFileTool.js'

describe('OfficeFileTool', () => {
  test('is registered as a built-in tool', () => {
    expect(getAllBaseTools().some(tool => tool.name === OfficeFileTool.name)).toBe(true)
  })

  test('documents the no-overwrite spreadsheet flow', async () => {
    const prompt = await OfficeFileTool.prompt()

    expect(prompt).toContain('CSV')
    expect(prompt).toContain('XLSX')
    expect(prompt).toContain('sort_rows')
    expect(prompt).toContain('dedupe_rows')
    expect(prompt).toContain('filter_rows')
    expect(prompt).toContain('create_docx')
    expect(prompt).toContain('create_pptx')
    expect(prompt).toContain('replace_text')
    expect(prompt).toContain('Always generate a new output file')
  })

  test('accepts basic DOCX generation input without a source file', () => {
    const parsed = OfficeFileTool.inputSchema.safeParse({
      operation: 'create_docx',
      output_path: 'summary.docx',
      content: 'Meeting notes',
    })

    expect(parsed.success).toBe(true)
  })

  test('accepts basic PPTX generation input without a source file', () => {
    const parsed = OfficeFileTool.inputSchema.safeParse({
      operation: 'create_pptx',
      output_path: 'deck.pptx',
      content: '# Intro\n- Point',
    })

    expect(parsed.success).toBe(true)
  })

  test('accepts DOCX text replacement input', () => {
    const parsed = OfficeFileTool.inputSchema.safeParse({
      operation: 'replace_text',
      file_path: 'source.docx',
      output_path: 'output.docx',
      find_text: 'old',
      replacement_text: 'new',
    })

    expect(parsed.success).toBe(true)
  })
})
