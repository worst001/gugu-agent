import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileDiff, Folder, FolderOpen, Search } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type { WorkbenchFileChange } from './workbenchModel'
import { EmptyState } from './ToolActivityList'

type Props = {
  sessionId: string
  fileChanges: WorkbenchFileChange[]
  selectedFilePath: string | null
  totalFileCount: number
  filesTruncated: boolean
}

type TreeNode = {
  name: string
  path: string
  children: TreeNode[]
  fileCount: number
  change?: WorkbenchFileChange
}

export function FileChangeList({
  sessionId,
  fileChanges,
  selectedFilePath,
  totalFileCount,
  filesTruncated,
}: Props) {
  const t = useTranslation()
  const selectFile = useWorkbenchStore((state) => state.selectFile)
  const selectTool = useWorkbenchStore((state) => state.selectTool)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleChanges = useMemo(
    () => normalizedQuery
      ? fileChanges.filter((change) => change.filePath.toLocaleLowerCase().includes(normalizedQuery))
      : fileChanges,
    [fileChanges, normalizedQuery],
  )
  const tree = useMemo(() => buildFileTree(visibleChanges), [visibleChanges])

  useEffect(() => {
    if (!selectedFilePath) return
    setExpanded((current) => {
      const next = new Set(current)
      const parts = selectedFilePath.split('/').filter(Boolean)
      for (let index = 1; index < parts.length; index += 1) {
        next.add(parts.slice(0, index).join('/'))
      }
      return next
    })
  }, [selectedFilePath])

  if (fileChanges.length === 0) {
    return <EmptyState icon="difference" title={t('workbench.diff.empty')} />
  }

  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const chooseFile = (change: WorkbenchFileChange) => {
    selectFile(sessionId, change.filePath, 'diff')
    selectTool(sessionId, change.toolUseId)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <Search size={14} strokeWidth={1.25} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="sr-only">{t('workbench.diff.search')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('workbench.diff.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </label>
        <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {t('workbench.diff.fileCount', { count: totalFileCount })}
        </span>
      </div>

      {filesTruncated && (
        <div className="border-b border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-warning)]">
          {t('workbench.diff.filesTruncated', {
            shown: fileChanges.length,
            total: totalFileCount,
          })}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto p-1.5">
        {tree.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('workbench.diff.noMatches')}
          </div>
        ) : tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            expandAll={Boolean(normalizedQuery)}
            selectedFilePath={selectedFilePath}
            onToggleDirectory={toggleDirectory}
            onSelectFile={chooseFile}
          />
        ))}
      </div>
    </div>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  expandAll,
  selectedFilePath,
  onToggleDirectory,
  onSelectFile,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  expandAll: boolean
  selectedFilePath: string | null
  onToggleDirectory: (path: string) => void
  onSelectFile: (change: WorkbenchFileChange) => void
}) {
  if (!node.change) {
    const isExpanded = expandAll || expanded.has(node.path)
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggleDirectory(node.path)}
          className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          style={{ paddingLeft: 6 + depth * 14 }}
          aria-expanded={isExpanded}
        >
          {isExpanded
            ? <ChevronDown size={14} strokeWidth={1.25} />
            : <ChevronRight size={14} strokeWidth={1.25} />}
          {isExpanded
            ? <FolderOpen size={14} strokeWidth={1.25} />
            : <Folder size={14} strokeWidth={1.25} />}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
            {node.fileCount}
          </span>
        </button>
        {isExpanded && node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            expandAll={expandAll}
            selectedFilePath={selectedFilePath}
            onToggleDirectory={onToggleDirectory}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    )
  }

  const selected = node.path === selectedFilePath
  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.change!)}
      className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[11px] transition-colors ${
        selected
          ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-border-focus)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
      style={{ paddingLeft: 34 + depth * 14 }}
      title={node.path}
    >
      <FileDiff size={14} strokeWidth={1.25} className={statusColor(node.change.kind)} />
      <span className="min-w-0 flex-1 truncate font-[var(--font-mono)]">{node.name}</span>
      <span className={`text-[10px] font-semibold ${statusColor(node.change.kind)}`}>
        {statusLabel(node.change.kind)}
      </span>
    </button>
  )
}

function buildFileTree(fileChanges: WorkbenchFileChange[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [], fileCount: 0 }

  for (const change of fileChanges) {
    const parts = change.filePath.split('/').filter(Boolean)
    let parent = root
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]
      if (!name) continue
      const path = parts.slice(0, index + 1).join('/')
      if (index === parts.length - 1) {
        parent.children.push({ name, path, children: [], fileCount: 1, change })
        continue
      }
      let directory = parent.children.find((child) => !child.change && child.name === name)
      if (!directory) {
        directory = { name, path, children: [], fileCount: 0 }
        parent.children.push(directory)
      }
      directory.fileCount += 1
      parent = directory
    }
  }

  sortTree(root.children)
  return root.children
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((left, right) => {
    if (Boolean(left.change) !== Boolean(right.change)) return left.change ? 1 : -1
    return left.name.localeCompare(right.name)
  })
  for (const node of nodes) sortTree(node.children)
}

function statusLabel(kind: WorkbenchFileChange['kind']): string {
  if (kind === 'created') return 'A'
  if (kind === 'deleted') return 'D'
  if (kind === 'renamed') return 'R'
  return 'M'
}

function statusColor(kind: WorkbenchFileChange['kind']): string {
  if (kind === 'created') return 'text-[var(--color-diff-added-text)]'
  if (kind === 'deleted') return 'text-[var(--color-diff-removed-text)]'
  if (kind === 'renamed') return 'text-[var(--color-primary)]'
  return 'text-[var(--color-warning)]'
}
