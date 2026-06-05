---
name: excel-master
description: Analyze and transform Excel, XLSX, CSV, and spreadsheet-like data with field profiling, data-quality checks, formulas, tables, and safe output-file handling.
---

# Excel Master

Use this skill for Excel/XLSX/CSV analysis, spreadsheet cleanup, metric interpretation, formula planning, table generation, and workbook-safe recommendations.

## First Pass

1. Identify sheets, fields, units, date ranges, and likely business meaning.
2. Estimate visible row and column scale when possible.
3. Check missing values, duplicates, outliers, inconsistent formats, suspicious totals, and mixed data types.
4. Separate observed data from inferred patterns.

## Output Shape

Prefer this shape unless the user asks otherwise:

- Data overview
- Sheet or table structure
- Field summary
- Data quality issues
- Key insights
- Suggested calculations, formulas, or pivots
- Recommended next actions

## Rules

- Do not fabricate unseen rows, totals, formulas, charts, or sheet names.
- Explain formula assumptions and provide spreadsheet-friendly expressions.
- Do not run workbook macros or active content.
- Do not require Python, qmd, sh, Excel, LibreOffice, or other host commands for the default path.
- For generated files, create new files only and never overwrite originals without explicit path confirmation.
