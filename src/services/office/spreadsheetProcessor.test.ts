import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  calculateSpreadsheetColumn,
  processSpreadsheet,
} from './spreadsheetProcessor.js'
import { readZipEntries, writeZipEntries } from './zip.js'

describe('calculateSpreadsheetColumn', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-office-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('creates a new CSV with a calculated column and keeps source intact', async () => {
    const sourcePath = path.join(tmpDir, 'orders.csv')
    const outputPath = path.join(tmpDir, 'orders-output.csv')
    await fs.writeFile(sourcePath, '商品,单价,数量\n苹果,3,2\n香蕉,4.5,2\n坏数据,,7\n', 'utf8')

    const result = await calculateSpreadsheetColumn({
      filePath: sourcePath,
      outputPath,
      targetColumn: '金额',
      leftColumn: '单价',
      rightColumn: '数量',
    })

    expect(result.updatedRows).toBe(2)
    expect(result.skippedRows).toBe(1)
    expect(result.originalModified).toBe(false)
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe(
      '商品,单价,数量\n苹果,3,2\n香蕉,4.5,2\n坏数据,,7\n',
    )
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe(
      '商品,单价,数量,金额\n苹果,3,2,6\n香蕉,4.5,2,9\n坏数据,,7,',
    )
  })

  test('creates a new XLSX with a calculated column', async () => {
    const sourcePath = path.join(tmpDir, 'orders.xlsx')
    const outputPath = path.join(tmpDir, 'orders-output.xlsx')
    await fs.writeFile(sourcePath, createWorkbookFixture())

    const result = await calculateSpreadsheetColumn({
      filePath: sourcePath,
      outputPath,
      targetColumn: '金额',
      leftColumn: '单价',
      rightColumn: '数量',
    })

    expect(result.updatedRows).toBe(2)
    expect(result.fileType).toBe('xlsx')
    expect(result.sheetName).toBe('订单')

    const entries = readZipEntries(await fs.readFile(outputPath))
    const worksheet = entries
      .find(entry => entry.name === 'xl/worksheets/sheet1.xml')!
      .data.toString('utf8')

    expect(worksheet).toContain('<c r="D1" t="inlineStr"><is><t>金额</t></is></c>')
    expect(worksheet).toContain('<c r="D2"><v>6</v></c>')
    expect(worksheet).toContain('<c r="D3"><v>9</v></c>')
    expect(worksheet).toContain('<dimension ref="A1:D3"/>')
  })
})

describe('processSpreadsheet', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-office-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('sorts CSV rows into a new file', async () => {
    const sourcePath = path.join(tmpDir, 'orders.csv')
    const outputPath = path.join(tmpDir, 'orders-sorted.csv')
    await fs.writeFile(sourcePath, 'item,price,quantity\napple,3,2\nbanana,4.5,1\npear,2,5\n', 'utf8')

    const result = await processSpreadsheet({
      operation: 'sort_rows',
      filePath: sourcePath,
      outputPath,
      sortColumn: 'price',
      sortDirection: 'desc',
    })

    expect(result.affectedRows).toBe(3)
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe(
      'item,price,quantity\nbanana,4.5,1\napple,3,2\npear,2,5',
    )
  })

  test('dedupes CSV rows by selected columns', async () => {
    const sourcePath = path.join(tmpDir, 'orders.csv')
    const outputPath = path.join(tmpDir, 'orders-dedupe.csv')
    await fs.writeFile(sourcePath, 'item,price\napple,3\napple,4\nbanana,5\n', 'utf8')

    const result = await processSpreadsheet({
      operation: 'dedupe_rows',
      filePath: sourcePath,
      outputPath,
      keyColumns: ['item'],
    })

    expect(result.affectedRows).toBe(1)
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe(
      'item,price\napple,3\nbanana,5',
    )
  })

  test('generates basic CSV statistics', async () => {
    const sourcePath = path.join(tmpDir, 'orders.csv')
    const outputPath = path.join(tmpDir, 'orders-stats.csv')
    await fs.writeFile(sourcePath, 'item,price\napple,3\nbanana,5\npear,\n', 'utf8')

    const result = await processSpreadsheet({
      operation: 'basic_stats',
      filePath: sourcePath,
      outputPath,
      statColumns: ['price'],
    })

    expect(result.outputRowCount).toBe(1)
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe(
      '字段,总行数,空值,数字数,最小值,最大值,合计,平均值\nprice,3,1,2,3,5,8,4',
    )
  })

  test('filters XLSX rows into a new workbook', async () => {
    const sourcePath = path.join(tmpDir, 'orders.xlsx')
    const outputPath = path.join(tmpDir, 'orders-filtered.xlsx')
    await fs.writeFile(sourcePath, createEnglishWorkbookFixture())

    const result = await processSpreadsheet({
      operation: 'filter_rows',
      filePath: sourcePath,
      outputPath,
      filterColumn: 'price',
      filterOperator: 'greater_than',
      filterValue: '3',
    })

    expect(result.outputRowCount).toBe(1)
    const entries = readZipEntries(await fs.readFile(outputPath))
    const worksheet = entries
      .find(entry => entry.name === 'xl/worksheets/sheet1.xml')!
      .data.toString('utf8')

    expect(worksheet).toContain('<dimension ref="A1:B2"/>')
    expect(worksheet).toContain('<t>banana</t>')
    expect(worksheet).not.toContain('<t>apple</t>')
  })
})

function createWorkbookFixture(): Buffer {
  return writeZipEntries([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="订单" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<dimension ref="A1:C3"/>' +
          '<sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>商品</t></is></c><c r="B1" t="inlineStr"><is><t>单价</t></is></c><c r="C1" t="inlineStr"><is><t>数量</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>苹果</t></is></c><c r="B2"><v>3</v></c><c r="C2"><v>2</v></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>香蕉</t></is></c><c r="B3"><v>4.5</v></c><c r="C3"><v>2</v></c></row>' +
          '</sheetData>' +
          '</worksheet>',
      ),
    },
  ])
}

function createEnglishWorkbookFixture(): Buffer {
  return writeZipEntries([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<dimension ref="A1:B3"/>' +
          '<sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>item</t></is></c><c r="B1" t="inlineStr"><is><t>price</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>apple</t></is></c><c r="B2"><v>3</v></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>banana</t></is></c><c r="B3"><v>5</v></c></row>' +
          '</sheetData>' +
          '</worksheet>',
      ),
    },
  ])
}
