---
name: spreadsheet-master
description: Analyze spreadsheet-style data, CSV/Excel content, metrics, and pasted tables with field profiling, data quality checks, business insights, and safe formula/table recommendations.
---

# Spreadsheet Master

Use this skill for spreadsheet analysis, CSV/Excel review, metric interpretation, table cleanup, formula planning, and data-quality summaries.

## First Pass

1. Identify fields, units, date ranges, and likely business meaning.
2. Estimate visible row and column scale when possible.
3. Check missing values, duplicates, outliers, inconsistent formats, and suspicious totals.
4. Separate observed data from inferred patterns.

## Output Shape

Prefer this shape unless the user asks otherwise:

- Data overview
- Field summary
- Data quality issues
- Key insights
- Suggested calculations or formulas
- Recommended next actions

## Rules

- Do not fabricate unseen rows, totals, formulas, or charts.
- If data is incomplete, say what can and cannot be concluded.
- For formulas, explain assumptions and provide spreadsheet-friendly expressions.
- For generated files, create new files only; do not overwrite originals without explicit path confirmation.
