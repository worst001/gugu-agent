import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { readZipEntries, type ZipEntry, writeZipEntries } from './zip.js'

export type SpreadsheetCalculationInput = {
  filePath: string
  outputPath?: string
  sheetName?: string
  targetColumn: string
  leftColumn: string
  rightColumn: string
  operator?: 'multiply'
}

export type SpreadsheetTableOperation =
  | 'calculate_column'
  | 'sort_rows'
  | 'dedupe_rows'
  | 'filter_rows'
  | 'basic_stats'

export type SpreadsheetFilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty'

export type SpreadsheetProcessingInput = Partial<SpreadsheetCalculationInput> & {
  filePath: string
  outputPath?: string
  sheetName?: string
  operation: SpreadsheetTableOperation
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
  keyColumns?: string[]
  filterColumn?: string
  filterOperator?: SpreadsheetFilterOperator
  filterValue?: string
  statColumns?: string[]
}

export type SpreadsheetCalculationResult = SpreadsheetProcessingResult & {
  operation: 'calculate_column'
  targetColumn: string
  leftColumn: string
  rightColumn: string
  updatedRows: number
  skippedRows: number
}

export type SpreadsheetProcessingResult = {
  type: 'spreadsheet'
  operation: SpreadsheetTableOperation
  sourcePath: string
  outputPath: string
  fileType: 'csv' | 'xlsx'
  sheetName?: string
  rowCount?: number
  outputRowCount?: number
  affectedRows?: number
  skippedRows?: number
  originalModified: false
  summary: string
  warnings: string[]
}

type ParsedCsv = {
  delimiter: string
  hadBom: boolean
  rows: string[][]
}

type WorksheetRow = {
  rowNumber: number
  cells: Map<number, string>
}

type WorksheetParseResult = {
  rows: WorksheetRow[]
  maxRow: number
  maxColumn: number
}

export function buildOfficeOutputPath(sourcePath: string, outputPath?: string): string {
  if (outputPath?.trim()) {
    return path.resolve(outputPath)
  }

  const parsed = path.parse(path.resolve(sourcePath))
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
  return path.join(parsed.dir, `${parsed.name}.gugu-${stamp}${parsed.ext}`)
}

export async function calculateSpreadsheetColumn(
  input: SpreadsheetCalculationInput,
): Promise<SpreadsheetCalculationResult> {
  const sourcePath = path.resolve(input.filePath)
  const outputPath = buildOfficeOutputPath(sourcePath, input.outputPath)
  const extension = path.extname(sourcePath).toLowerCase()

  if (samePath(sourcePath, outputPath)) {
    throw new Error('输出路径不能和原文件相同。Gugu 默认生成新文件，避免覆盖原始文件。')
  }

  if (extension === '.csv' || extension === '.tsv') {
    await assertOutputCanBeCreated(outputPath)
    return calculateCsvColumn({ ...input, filePath: sourcePath, outputPath })
  }

  if (extension === '.xlsx') {
    await assertOutputCanBeCreated(outputPath)
    return calculateXlsxColumn({ ...input, filePath: sourcePath, outputPath })
  }

  throw new Error('当前 OfficeFile 工具只支持 CSV、TSV 和 XLSX。DOCX/PPTX 处理会在后续阶段接入。')
}

export async function processSpreadsheet(
  input: SpreadsheetProcessingInput,
): Promise<SpreadsheetProcessingResult> {
  if (input.operation === 'calculate_column') {
    return calculateSpreadsheetColumn({
      filePath: input.filePath,
      outputPath: input.outputPath,
      sheetName: input.sheetName,
      targetColumn: input.targetColumn ?? '',
      leftColumn: input.leftColumn ?? '',
      rightColumn: input.rightColumn ?? '',
      operator: input.operator,
    })
  }

  const sourcePath = path.resolve(input.filePath)
  const outputPath = buildOfficeOutputPath(sourcePath, input.outputPath)
  const extension = path.extname(sourcePath).toLowerCase()

  if (samePath(sourcePath, outputPath)) {
    throw new Error('输出路径不能和原文件相同。Gugu 默认生成新文件，避免覆盖原始文件。')
  }

  if (extension === '.csv' || extension === '.tsv') {
    await assertOutputCanBeCreated(outputPath)
    return processCsvTable({ ...input, filePath: sourcePath, outputPath })
  }

  if (extension === '.xlsx') {
    await assertOutputCanBeCreated(outputPath)
    return processXlsxTable({ ...input, filePath: sourcePath, outputPath })
  }

  throw new Error('当前 OfficeFile 工具只支持 CSV、TSV 和 XLSX。DOCX/PPTX 处理会在后续阶段接入。')
}

async function calculateCsvColumn(
  input: RequiredOutputPath<SpreadsheetCalculationInput>,
): Promise<SpreadsheetCalculationResult> {
  const content = await fs.readFile(input.filePath, 'utf8')
  const parsed = parseCsv(content, path.extname(input.filePath).toLowerCase())
  const result = applyCalculationToRows(parsed.rows, input)
  const output = serializeCsv(result.rows, parsed.delimiter)

  await ensureParentDirectory(input.outputPath)
  await fs.writeFile(input.outputPath, `${parsed.hadBom ? '\uFEFF' : ''}${output}`, 'utf8')

  return {
    type: 'spreadsheet',
    operation: 'calculate_column',
    sourcePath: input.filePath,
    outputPath: input.outputPath,
    fileType: 'csv',
    targetColumn: input.targetColumn,
    leftColumn: input.leftColumn,
    rightColumn: input.rightColumn,
    updatedRows: result.updatedRows,
    skippedRows: result.skippedRows,
    originalModified: false,
    summary: `已生成新 CSV 文件，填充 ${result.updatedRows} 行「${input.targetColumn}」。原文件未修改。`,
    warnings: result.warnings,
  }
}

async function calculateXlsxColumn(
  input: RequiredOutputPath<SpreadsheetCalculationInput>,
): Promise<SpreadsheetCalculationResult> {
  const archive = await fs.readFile(input.filePath)
  const entries = readZipEntries(archive)
  const sheet = findWorksheet(entries, input.sheetName)
  const sharedStrings = parseSharedStrings(getZipText(entries, 'xl/sharedStrings.xml'))
  const worksheet = parseWorksheet(sheet.entry.data.toString('utf8'), sharedStrings)
  const tableRows = worksheet.rows.map(row => rowToArray(row, worksheet.maxColumn))
  const result = applyCalculationToRows(tableRows, input)
  const updatedWorksheetXml = updateWorksheetXml(
    sheet.entry.data.toString('utf8'),
    worksheet,
    result.updates,
  )

  sheet.entry.data = Buffer.from(updatedWorksheetXml, 'utf8')

  await ensureParentDirectory(input.outputPath)
  await fs.writeFile(input.outputPath, writeZipEntries(entries))

  return {
    type: 'spreadsheet',
    operation: 'calculate_column',
    sourcePath: input.filePath,
    outputPath: input.outputPath,
    fileType: 'xlsx',
    sheetName: sheet.name,
    targetColumn: input.targetColumn,
    leftColumn: input.leftColumn,
    rightColumn: input.rightColumn,
    updatedRows: result.updatedRows,
    skippedRows: result.skippedRows,
    originalModified: false,
    summary: `已生成新 XLSX 文件，在「${sheet.name}」填充 ${result.updatedRows} 行「${input.targetColumn}」。原文件未修改。`,
    warnings: result.warnings,
  }
}

async function processCsvTable(
  input: RequiredOutputPath<SpreadsheetProcessingInput>,
): Promise<SpreadsheetProcessingResult> {
  const content = await fs.readFile(input.filePath, 'utf8')
  const parsed = parseCsv(content, path.extname(input.filePath).toLowerCase())
  const result = applyTableOperation(parsed.rows, input)
  const output = serializeCsv(result.rows, parsed.delimiter)

  await ensureParentDirectory(input.outputPath)
  await fs.writeFile(input.outputPath, `${parsed.hadBom ? '\uFEFF' : ''}${output}`, 'utf8')

  return {
    type: 'spreadsheet',
    operation: input.operation,
    sourcePath: input.filePath,
    outputPath: input.outputPath,
    fileType: 'csv',
    rowCount: result.inputRowCount,
    outputRowCount: result.outputRowCount,
    affectedRows: result.affectedRows,
    skippedRows: result.skippedRows,
    originalModified: false,
    summary: result.summary,
    warnings: result.warnings,
  }
}

async function processXlsxTable(
  input: RequiredOutputPath<SpreadsheetProcessingInput>,
): Promise<SpreadsheetProcessingResult> {
  const archive = await fs.readFile(input.filePath)
  const entries = readZipEntries(archive)
  const sheet = findWorksheet(entries, input.sheetName)
  const sharedStrings = parseSharedStrings(getZipText(entries, 'xl/sharedStrings.xml'))
  const worksheet = parseWorksheet(sheet.entry.data.toString('utf8'), sharedStrings)
  const tableRows = worksheet.rows.map(row => rowToArray(row, worksheet.maxColumn))
  const result = applyTableOperation(tableRows, input)
  sheet.entry.data = Buffer.from(
    replaceWorksheetRowsXml(sheet.entry.data.toString('utf8'), result.rows),
    'utf8',
  )

  await ensureParentDirectory(input.outputPath)
  await fs.writeFile(input.outputPath, writeZipEntries(entries))

  return {
    type: 'spreadsheet',
    operation: input.operation,
    sourcePath: input.filePath,
    outputPath: input.outputPath,
    fileType: 'xlsx',
    sheetName: sheet.name,
    rowCount: result.inputRowCount,
    outputRowCount: result.outputRowCount,
    affectedRows: result.affectedRows,
    skippedRows: result.skippedRows,
    originalModified: false,
    summary: `${result.summary}${sheet.name ? `（工作表：${sheet.name}）` : ''}`,
    warnings: [
      ...result.warnings,
      'XLSX 清洗会重写目标工作表的基础数据区域；复杂样式、公式、图表和宏可能无法完整保留。',
    ],
  }
}

type RequiredOutputPath<T extends { outputPath?: string }> = T & { outputPath: string }

type CalculationApplyResult = {
  rows: string[][]
  updates: Map<number, Map<number, CellWriteValue>>
  updatedRows: number
  skippedRows: number
  warnings: string[]
}

type CellWriteValue = {
  value: string
  numeric: boolean
}

type TableOperationApplyResult = {
  rows: string[][]
  inputRowCount: number
  outputRowCount: number
  affectedRows: number
  skippedRows: number
  summary: string
  warnings: string[]
}

function applyCalculationToRows(
  rows: string[][],
  input: SpreadsheetCalculationInput,
): CalculationApplyResult {
  if (rows.length === 0) {
    throw new Error('表格为空，无法识别表头。')
  }

  const header = rows[0] ?? []
  const leftIndex = findHeaderIndex(header, input.leftColumn)
  const rightIndex = findHeaderIndex(header, input.rightColumn)

  if (leftIndex === -1 || rightIndex === -1) {
    throw new Error(
      `找不到用于计算的列：${leftIndex === -1 ? input.leftColumn : ''}${leftIndex === -1 && rightIndex === -1 ? '、' : ''}${rightIndex === -1 ? input.rightColumn : ''}。请确认表头名称。`,
    )
  }

  let targetIndex = findHeaderIndex(header, input.targetColumn)
  if (targetIndex === -1) {
    targetIndex = header.length
    header[targetIndex] = input.targetColumn
  }

  const updates = new Map<number, Map<number, CellWriteValue>>()
  updates.set(1, new Map([[targetIndex + 1, { value: input.targetColumn, numeric: false }]]))

  let updatedRows = 0
  let skippedRows = 0

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    const leftValue = parseSpreadsheetNumber(row[leftIndex])
    const rightValue = parseSpreadsheetNumber(row[rightIndex])

    if (leftValue === null || rightValue === null) {
      row[targetIndex] = row[targetIndex] ?? ''
      if (row.some(cell => cell.trim() !== '')) {
        skippedRows++
      }
      continue
    }

    const calculated = formatSpreadsheetNumber(leftValue * rightValue)
    row[targetIndex] = calculated
    updates.set(rowIndex + 1, new Map([[targetIndex + 1, { value: calculated, numeric: true }]]))
    updatedRows++
  }

  const warnings = skippedRows > 0
    ? [`有 ${skippedRows} 行因为「${input.leftColumn}」或「${input.rightColumn}」不是数字而跳过。`]
    : []

  return {
    rows,
    updates,
    updatedRows,
    skippedRows,
    warnings,
  }
}

function applyTableOperation(
  rows: string[][],
  input: SpreadsheetProcessingInput,
): TableOperationApplyResult {
  if (rows.length === 0) {
    throw new Error('表格为空，无法识别表头。')
  }

  const header = [...(rows[0] ?? [])]
  const bodyRows = rows.slice(1).map(row => [...row])
  const inputRowCount = bodyRows.filter(row => row.some(cell => cell.trim() !== '')).length

  switch (input.operation) {
    case 'sort_rows':
      return applySortRows(header, bodyRows, input, inputRowCount)
    case 'dedupe_rows':
      return applyDedupeRows(header, bodyRows, input, inputRowCount)
    case 'filter_rows':
      return applyFilterRows(header, bodyRows, input, inputRowCount)
    case 'basic_stats':
      return applyBasicStats(header, bodyRows, input, inputRowCount)
    default:
      throw new Error(`暂不支持的 OfficeFile 操作：${input.operation}`)
  }
}

function applySortRows(
  header: string[],
  bodyRows: string[][],
  input: SpreadsheetProcessingInput,
  inputRowCount: number,
): TableOperationApplyResult {
  const columnIndex = requireHeaderIndex(header, input.sortColumn, '排序列')
  const direction = input.sortDirection === 'desc' ? -1 : 1
  const sortedRows = [...bodyRows].sort((left, right) =>
    compareSpreadsheetCells(left[columnIndex] ?? '', right[columnIndex] ?? '') * direction
  )

  return {
    rows: [header, ...sortedRows],
    inputRowCount,
    outputRowCount: sortedRows.length,
    affectedRows: sortedRows.length,
    skippedRows: 0,
    summary: `已按「${input.sortColumn}」${input.sortDirection === 'desc' ? '降序' : '升序'}排序，并生成新文件。原文件未修改。`,
    warnings: [],
  }
}

function applyDedupeRows(
  header: string[],
  bodyRows: string[][],
  input: SpreadsheetProcessingInput,
  inputRowCount: number,
): TableOperationApplyResult {
  const keyIndexes = input.keyColumns?.length
    ? input.keyColumns.map(column => requireHeaderIndex(header, column, '去重列'))
    : header.map((_, index) => index)
  const seen = new Set<string>()
  const outputRows: string[][] = []
  let removedRows = 0

  for (const row of bodyRows) {
    const key = keyIndexes.map(index => normalizeCellKey(row[index] ?? '')).join('\u0000')
    if (seen.has(key)) {
      removedRows++
      continue
    }
    seen.add(key)
    outputRows.push(row)
  }

  return {
    rows: [header, ...outputRows],
    inputRowCount,
    outputRowCount: outputRows.length,
    affectedRows: removedRows,
    skippedRows: 0,
    summary: `已去除 ${removedRows} 行重复数据，并生成新文件。原文件未修改。`,
    warnings: input.keyColumns?.length
      ? []
      : ['未指定去重列，已按整行内容去重。'],
  }
}

function applyFilterRows(
  header: string[],
  bodyRows: string[][],
  input: SpreadsheetProcessingInput,
  inputRowCount: number,
): TableOperationApplyResult {
  const columnIndex = requireHeaderIndex(header, input.filterColumn, '筛选列')
  const operator = input.filterOperator ?? 'equals'
  const outputRows = bodyRows.filter(row =>
    matchesFilter(row[columnIndex] ?? '', operator, input.filterValue ?? '')
  )
  const removedRows = bodyRows.length - outputRows.length

  return {
    rows: [header, ...outputRows],
    inputRowCount,
    outputRowCount: outputRows.length,
    affectedRows: outputRows.length,
    skippedRows: removedRows,
    summary: `已按「${input.filterColumn}」筛选出 ${outputRows.length} 行，并生成新文件。原文件未修改。`,
    warnings: [],
  }
}

function applyBasicStats(
  header: string[],
  bodyRows: string[][],
  input: SpreadsheetProcessingInput,
  inputRowCount: number,
): TableOperationApplyResult {
  const selectedIndexes = input.statColumns?.length
    ? input.statColumns.map(column => requireHeaderIndex(header, column, '统计列'))
    : header.map((_, index) => index)
  const statsRows = [
    ['字段', '总行数', '空值', '数字数', '最小值', '最大值', '合计', '平均值'],
  ]
  const warnings: string[] = []

  for (const index of selectedIndexes) {
    const values = bodyRows.map(row => row[index] ?? '')
    const emptyCount = values.filter(value => value.trim() === '').length
    const numericValues = values
      .map(value => parseSpreadsheetNumber(value))
      .filter((value): value is number => value !== null)

    if (numericValues.length === 0) {
      warnings.push(`「${header[index] ?? index + 1}」没有可统计的数字。`)
    }

    const sum = numericValues.reduce((total, value) => total + value, 0)
    const min = numericValues.length > 0 ? Math.min(...numericValues) : null
    const max = numericValues.length > 0 ? Math.max(...numericValues) : null
    const average = numericValues.length > 0 ? sum / numericValues.length : null

    statsRows.push([
      header[index] ?? `Column ${index + 1}`,
      String(inputRowCount),
      String(emptyCount),
      String(numericValues.length),
      min === null ? '' : formatSpreadsheetNumber(min),
      max === null ? '' : formatSpreadsheetNumber(max),
      numericValues.length === 0 ? '' : formatSpreadsheetNumber(sum),
      average === null ? '' : formatSpreadsheetNumber(average),
    ])
  }

  return {
    rows: statsRows,
    inputRowCount,
    outputRowCount: statsRows.length - 1,
    affectedRows: statsRows.length - 1,
    skippedRows: warnings.length,
    summary: `已生成 ${statsRows.length - 1} 个字段的基础统计，并保存为新文件。原文件未修改。`,
    warnings,
  }
}

function parseCsv(content: string, extension: string): ParsedCsv {
  const hadBom = content.startsWith('\uFEFF')
  const text = hadBom ? content.slice(1) : content
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = extension === '.tsv' || countChar(firstLine, '\t') > countChar(firstLine, ',')
    ? '\t'
    : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(field)
      field = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return { delimiter, hadBom, rows }
}

function serializeCsv(rows: string[][], delimiter: string): string {
  return rows
    .map(row => row.map(cell => serializeCsvCell(cell, delimiter)).join(delimiter))
    .join('\n')
}

function serializeCsvCell(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes('\n') || value.includes('\r') || value.includes(delimiter)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function findWorksheet(
  entries: ZipEntry[],
  requestedSheetName: string | undefined,
): { entry: ZipEntry; name: string } {
  const workbookXml = getZipText(entries, 'xl/workbook.xml')
  const workbookRelsXml = getZipText(entries, 'xl/_rels/workbook.xml.rels')
  const sheetInfos = workbookXml
    ? parseWorkbookSheets(workbookXml, workbookRelsXml)
    : []

  const sheetInfo = requestedSheetName
    ? sheetInfos.find(sheet => sheet.name === requestedSheetName)
    : sheetInfos[0]

  const sheetPath = sheetInfo?.path ?? 'xl/worksheets/sheet1.xml'
  const entry = entries.find(candidate => candidate.name === sheetPath)

  if (!entry) {
    throw new Error(`找不到工作表：${requestedSheetName ?? sheetPath}`)
  }

  return {
    entry,
    name: sheetInfo?.name ?? requestedSheetName ?? 'Sheet1',
  }
}

function parseWorkbookSheets(
  workbookXml: string,
  workbookRelsXml: string | undefined,
): Array<{ name: string; path: string }> {
  const rels = new Map<string, string>()
  const relationshipRegex = /<Relationship\b([^>]*)\/?>/g
  let relMatch: RegExpExecArray | null

  while ((relMatch = relationshipRegex.exec(workbookRelsXml ?? '')) !== null) {
    const attrs = relMatch[1] ?? ''
    const id = getXmlAttribute(attrs, 'Id')
    const target = getXmlAttribute(attrs, 'Target')
    if (id && target) {
      rels.set(id, resolveWorkbookRelationshipTarget(target))
    }
  }

  const sheets: Array<{ name: string; path: string }> = []
  const sheetRegex = /<sheet\b([^>]*)\/?>/g
  let sheetMatch: RegExpExecArray | null

  while ((sheetMatch = sheetRegex.exec(workbookXml)) !== null) {
    const attrs = sheetMatch[1] ?? ''
    const name = getXmlAttribute(attrs, 'name')
    const relId = getXmlAttribute(attrs, 'r:id')
    const target = relId ? rels.get(relId) : undefined

    if (name && target) {
      sheets.push({ name: decodeXmlText(name), path: target })
    }
  }

  return sheets
}

function resolveWorkbookRelationshipTarget(target: string): string {
  const trimmed = target.replace(/^\/+/, '')
  if (trimmed.startsWith('xl/')) return path.posix.normalize(trimmed)
  return path.posix.normalize(`xl/${trimmed}`)
}

function parseWorksheet(xml: string, sharedStrings: string[]): WorksheetParseResult {
  const rows: WorksheetRow[] = []
  let maxRow = 0
  let maxColumn = 0
  const rowRegex = /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowNumber = Number(rowMatch[1])
    const rowXml = rowMatch[0]
    const cells = new Map<number, string>()
    const cellRegex = /<c\b([^>]*\br="[A-Z]+\d+"[^>]*)(?:\/>|>[\s\S]*?<\/c>)/g
    let cellMatch: RegExpExecArray | null

    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const cellXml = cellMatch[0]
      const attrs = cellMatch[1] ?? ''
      const ref = getXmlAttribute(attrs, 'r')
      const refMatch = ref?.match(/^([A-Z]+)(\d+)$/)
      if (!refMatch) continue
      const columnIndex = columnNameToIndex(refMatch[1]!)
      cells.set(columnIndex, readCellValue(cellXml, attrs, sharedStrings))
      maxColumn = Math.max(maxColumn, columnIndex)
    }

    rows.push({ rowNumber, cells })
    maxRow = Math.max(maxRow, rowNumber)
  }

  return { rows, maxRow, maxColumn }
}

function updateWorksheetXml(
  xml: string,
  worksheet: WorksheetParseResult,
  updates: Map<number, Map<number, CellWriteValue>>,
): string {
  let maxColumn = worksheet.maxColumn
  let maxRow = worksheet.maxRow
  const rowRegex = /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g
  const updatedXml = xml.replace(rowRegex, (rowXml: string, rowNumberText: string) => {
    const rowNumber = Number(rowNumberText)
    const rowUpdates = updates.get(rowNumber)
    if (!rowUpdates) return rowXml

    let nextRowXml = rowXml
    for (const [columnIndex, value] of rowUpdates) {
      nextRowXml = upsertCellXml(nextRowXml, rowNumber, columnIndex, value)
      maxColumn = Math.max(maxColumn, columnIndex)
      maxRow = Math.max(maxRow, rowNumber)
    }
    return nextRowXml
  })

  return updateWorksheetDimension(updatedXml, maxRow, maxColumn)
}

function replaceWorksheetRowsXml(xml: string, rows: string[][]): string {
  const maxColumn = Math.max(1, ...rows.map(row => row.length))
  const maxRow = Math.max(1, rows.length)
  const sheetData = `<sheetData>${rows
    .map((row, index) => serializeWorksheetRow(row, index + 1, maxColumn))
    .join('')}</sheetData>`
  const nextXml = /<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/.test(xml)
    ? xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, sheetData)
    : xml.replace(/<worksheet\b[^>]*>/, match => `${match}${sheetData}`)

  return updateWorksheetDimension(nextXml, maxRow, maxColumn)
}

function serializeWorksheetRow(row: string[], rowNumber: number, maxColumn: number): string {
  const cells: string[] = []
  for (let columnIndex = 1; columnIndex <= maxColumn; columnIndex++) {
    const value = row[columnIndex - 1] ?? ''
    cells.push(
      `<c r="${columnIndexToName(columnIndex)}${rowNumber}" t="inlineStr"><is><t>${encodeXmlText(value)}</t></is></c>`,
    )
  }
  return `<row r="${rowNumber}">${cells.join('')}</row>`
}

function upsertCellXml(
  rowXml: string,
  rowNumber: number,
  columnIndex: number,
  cellValue: CellWriteValue,
): string {
  const reference = `${columnIndexToName(columnIndex)}${rowNumber}`
  const newCell = cellValue.numeric
    ? `<c r="${reference}"><v>${cellValue.value}</v></c>`
    : `<c r="${reference}" t="inlineStr"><is><t>${encodeXmlText(cellValue.value)}</t></is></c>`
  const cellRegex = /<c\b([^>]*\br="[A-Z]+\d+"[^>]*)(?:\/>|>[\s\S]*?<\/c>)/g
  let insertAt = rowXml.lastIndexOf('</row>')
  let match: RegExpExecArray | null

  while ((match = cellRegex.exec(rowXml)) !== null) {
    const ref = getXmlAttribute(match[1] ?? '', 'r')
    const refMatch = ref?.match(/^([A-Z]+)(\d+)$/)
    if (!refMatch) continue
    const currentColumnIndex = columnNameToIndex(refMatch[1]!)
    if (currentColumnIndex === columnIndex) {
      return `${rowXml.slice(0, match.index)}${newCell}${rowXml.slice(match.index + match[0].length)}`
    }
    if (currentColumnIndex > columnIndex) {
      insertAt = match.index
      break
    }
  }

  return `${rowXml.slice(0, insertAt)}${newCell}${rowXml.slice(insertAt)}`
}

function updateWorksheetDimension(xml: string, maxRow: number, maxColumn: number): string {
  if (maxRow < 1 || maxColumn < 1) return xml
  const dimension = `A1:${columnIndexToName(maxColumn)}${maxRow}`

  if (/<dimension\b[^>]*\bref="/.test(xml)) {
    return xml.replace(/<dimension\b[^>]*\/?>/, `<dimension ref="${dimension}"/>`)
  }

  return xml.replace(/<worksheet\b[^>]*>/, match => `${match}<dimension ref="${dimension}"/>`)
}

function rowToArray(row: WorksheetRow, maxColumn: number): string[] {
  const values: string[] = []
  for (let column = 1; column <= maxColumn; column++) {
    values[column - 1] = row.cells.get(column) ?? ''
  }
  return values
}

function readCellValue(cellXml: string, attrs: string, sharedStrings: string[]): string {
  const type = getXmlAttribute(attrs, 't')

  if (type === 's') {
    const index = Number(readFirstXmlValue(cellXml, 'v'))
    return Number.isFinite(index) ? sharedStrings[index] ?? '' : ''
  }

  if (type === 'inlineStr') {
    return [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(match => decodeXmlText(match[1] ?? ''))
      .join('')
  }

  return decodeXmlText(readFirstXmlValue(cellXml, 'v') ?? '')
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []

  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => {
    const sharedStringXml = match[1] ?? ''
    return [...sharedStringXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(textMatch => decodeXmlText(textMatch[1] ?? ''))
      .join('')
  })
}

function getZipText(entries: ZipEntry[], name: string): string | undefined {
  const entry = entries.find(candidate => candidate.name === name)
  return entry?.data.toString('utf8')
}

function findHeaderIndex(header: string[], name: string): number {
  const normalizedName = normalizeHeader(name)
  return header.findIndex(cell => normalizeHeader(cell) === normalizedName)
}

function requireHeaderIndex(
  header: string[],
  name: string | undefined,
  label: string,
): number {
  if (!name?.trim()) {
    throw new Error(`请提供${label}。`)
  }
  const index = findHeaderIndex(header, name)
  if (index === -1) {
    throw new Error(`找不到${label}「${name}」。请确认表头名称。`)
  }
  return index
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function normalizeCellKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function compareSpreadsheetCells(left: string, right: string): number {
  const leftNumber = parseSpreadsheetNumber(left)
  const rightNumber = parseSpreadsheetNumber(right)

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber
  }

  return left.localeCompare(right, 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  })
}

function matchesFilter(
  value: string,
  operator: SpreadsheetFilterOperator,
  expected: string,
): boolean {
  const normalizedValue = value.trim()
  const normalizedExpected = expected.trim()

  switch (operator) {
    case 'equals':
      return normalizeCellKey(normalizedValue) === normalizeCellKey(normalizedExpected)
    case 'not_equals':
      return normalizeCellKey(normalizedValue) !== normalizeCellKey(normalizedExpected)
    case 'contains':
      return normalizedValue.toLowerCase().includes(normalizedExpected.toLowerCase())
    case 'greater_than': {
      const left = parseSpreadsheetNumber(normalizedValue)
      const right = parseSpreadsheetNumber(normalizedExpected)
      return left !== null && right !== null && left > right
    }
    case 'less_than': {
      const left = parseSpreadsheetNumber(normalizedValue)
      const right = parseSpreadsheetNumber(normalizedExpected)
      return left !== null && right !== null && left < right
    }
    case 'is_empty':
      return normalizedValue === ''
    case 'is_not_empty':
      return normalizedValue !== ''
    default:
      return false
  }
}

function parseSpreadsheetNumber(value: string | undefined): number | null {
  if (!value) return null

  const cleaned = value
    .trim()
    .replace(/[,\s￥¥元]/g, '')

  if (!cleaned) return null

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function formatSpreadsheetNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

function columnNameToIndex(columnName: string): number {
  let index = 0
  for (const char of columnName.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64
  }
  return index
}

function columnIndexToName(columnIndex: number): string {
  let name = ''
  let value = columnIndex

  while (value > 0) {
    value--
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26)
  }

  return name
}

function getXmlAttribute(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = attrs.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, 'u'))
  return match ? match[1] : undefined
}

function readFirstXmlValue(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'u'))
  return match ? match[1] : undefined
}

function encodeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function countChar(value: string, char: string): number {
  let count = 0
  for (const candidate of value) {
    if (candidate === char) count++
  }
  return count
}

async function ensureParentDirectory(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function assertOutputCanBeCreated(outputPath: string) {
  try {
    await fs.stat(outputPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  throw new Error(`输出文件已存在：${outputPath}。请换一个输出路径，避免覆盖已有文件。`)
}

function samePath(left: string, right: string): boolean {
  if (process.platform === 'win32') {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  }
  return path.resolve(left) === path.resolve(right)
}
