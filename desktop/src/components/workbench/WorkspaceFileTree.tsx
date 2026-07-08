import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { filesystemApi, type WorkspaceDirEntry, type WorkspaceTextFileResult } from '../../api/filesystem'
import { CodeViewer } from '../chat/CodeViewer'
import { CopyButton } from '../shared/CopyButton'

type Props = {
  root: string | null | undefined
  fallback: ReactNode
}

const ROOT_KEY = '__root__'

export function WorkspaceFileTree({ root, fallback }: Props) {
  const [query, setQuery] = useState('')
  const [entriesByPath, setEntriesByPath] = useState<Record<string, WorkspaceDirEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [truncatedByPath, setTruncatedByPath] = useState<Record<string, boolean>>({})
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<WorkspaceTextFileResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewErrorPath, setPreviewErrorPath] = useState<string | null>(null)
  const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(null)

  useEffect(() => {
    setEntriesByPath({})
    setExpanded(new Set([ROOT_KEY]))
    setTruncatedByPath({})
    setSelectedFile(null)
    setPreviewError(null)
    setPreviewErrorPath(null)
    setPreviewLoadingPath(null)
    if (!root) return
    void loadDir(ROOT_KEY)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const loadDir = async (path: string) => {
    if (!root) return
    setLoadingPath(path)
    setError(null)
    try {
      const result = await filesystemApi.listWorkspaceDir(root, path === ROOT_KEY ? undefined : path)
      setEntriesByPath((current) => ({ ...current, [path]: result.entries }))
      setTruncatedByPath((current) => ({ ...current, [path]: result.truncated }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingPath(null)
    }
  }

  const openDir = async (path: string) => {
    setExpanded((current) => new Set(current).add(path))
    if (!entriesByPath[path]) await loadDir(path)
  }

  const toggleDir = async (path: string) => {
    if (expanded.has(path)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
      return
    }
    await openDir(path)
  }

  const previewFile = async (path: string) => {
    if (!root) return
    setPreviewError(null)
    setPreviewErrorPath(null)
    setPreviewLoadingPath(path)
    try {
      setSelectedFile(await filesystemApi.readWorkspaceTextFile(root, path))
    } catch (err) {
      setSelectedFile(null)
      setPreviewError(err instanceof Error ? err.message : String(err))
      setPreviewErrorPath(path)
    } finally {
      setPreviewLoadingPath(null)
    }
  }

  const rootEntries = entriesByPath[ROOT_KEY] ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) return rootEntries
    return rootEntries.filter((entry) => entry.name.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, rootEntries])

  if (!root) return <>{fallback}</>
  const rootName = getPathName(root)

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
        <div className="flex items-start gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <span className="material-symbols-outlined mt-0.5 text-[16px] text-[var(--color-text-tertiary)]">folder_open</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
              {rootName}
            </div>
            <div className="mt-0.5 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
              {root}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void filesystemApi.reveal(root)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            aria-label="在目录中打开"
            title="在目录中打开"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>

        <div className="border-b border-[var(--color-border)] p-2">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            <span className="material-symbols-outlined text-[14px]">search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选文件..."
              className="min-w-0 flex-1 bg-transparent text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          </label>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          {loadingPath === ROOT_KEY && visibleEntries.length === 0 ? (
            <TreeHint text="正在读取目录..." />
          ) : error ? (
            <TreeHint text={`读取目录失败: ${error}`} />
          ) : visibleEntries.length === 0 ? (
            <TreeHint text="没有可显示的文件" />
          ) : (
            visibleEntries.map((entry) => (
              <TreeEntry
                key={entry.path}
                entry={entry}
                depth={0}
                entriesByPath={entriesByPath}
                expanded={expanded}
                truncatedByPath={truncatedByPath}
                loadingPath={loadingPath}
                query={normalizedQuery}
                selectedPath={selectedFile?.path ?? previewErrorPath}
                onToggleDir={toggleDir}
                onPreviewFile={previewFile}
              />
            ))
          )}
          {truncatedByPath[ROOT_KEY] && (
            <TreeHint text="目录内容较多，只显示前 500 项。请用筛选缩小范围。" compact />
          )}
        </div>
      </div>

      {previewLoadingPath ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-6 text-center text-xs text-[var(--color-text-tertiary)]">
          正在预览文件...
        </div>
      ) : selectedFile ? (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
          <div className="flex items-start gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                {selectedFile.name}
              </div>
              <div className="mt-0.5 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
                {selectedFile.path}
              </div>
            </div>
            <CopyButton
              text={selectedFile.path}
              label="复制路径"
              copiedLabel="已复制"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            />
            <button
              type="button"
              onClick={() => void filesystemApi.reveal(selectedFile.path)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              定位
            </button>
            <button
              type="button"
              onClick={() => void filesystemApi.open(selectedFile.path)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              打开
            </button>
          </div>
          <CodeViewer
            code={selectedFile.truncated ? `${selectedFile.content}\n\n...` : selectedFile.content}
            language={selectedFile.language}
            maxLines={80}
          />
        </div>
      ) : previewError ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-3 text-xs text-[var(--color-text-secondary)]">
          <div className="font-semibold text-[var(--color-text-primary)]">不能预览此文件</div>
          <div className="mt-1">{previewError}</div>
          {previewErrorPath && (
            <>
              <div className="mt-2 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
                {previewErrorPath}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton
                  text={previewErrorPath}
                  label="复制路径"
                  copiedLabel="已复制"
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                />
                <button
                  type="button"
                  onClick={() => void filesystemApi.reveal(previewErrorPath)}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                >
                  在目录中定位
                </button>
                <button
                  type="button"
                  onClick={() => void filesystemApi.open(previewErrorPath)}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                >
                  打开文件
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        fallback
      )}
    </div>
  )
}

function TreeEntry({
  entry,
  depth,
  entriesByPath,
  expanded,
  truncatedByPath,
  loadingPath,
  query,
  selectedPath,
  onToggleDir,
  onPreviewFile,
}: {
  entry: WorkspaceDirEntry
  depth: number
  entriesByPath: Record<string, WorkspaceDirEntry[]>
  expanded: Set<string>
  truncatedByPath: Record<string, boolean>
  loadingPath: string | null
  query: string
  selectedPath: string | null
  onToggleDir: (path: string) => Promise<void>
  onPreviewFile: (path: string) => Promise<void>
}) {
  const isExpanded = expanded.has(entry.path)
  const isSelected = selectedPath === entry.path
  const children = entriesByPath[entry.path] ?? []
  const visibleChildren = query
    ? children.filter((child) => child.name.toLowerCase().includes(query))
    : children

  return (
    <div>
      <button
        type="button"
        onClick={() => entry.isDirectory ? void onToggleDir(entry.path) : void onPreviewFile(entry.path)}
        className={[
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
          isSelected ? 'bg-[var(--color-surface-hover)] ring-1 ring-inset ring-[var(--color-primary)]' : '',
        ].join(' ')}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="material-symbols-outlined w-4 shrink-0 text-[15px] text-[var(--color-text-tertiary)]">
          {entry.isDirectory ? (isExpanded ? 'expand_more' : 'chevron_right') : fileIcon(entry.name)}
        </span>
        {entry.isDirectory && (
          <span className="material-symbols-outlined shrink-0 text-[15px] text-[var(--color-text-tertiary)]">
            {isExpanded ? 'folder_open' : 'folder'}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {loadingPath === entry.path && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">...</span>
        )}
      </button>
      {entry.isDirectory && isExpanded && visibleChildren.map((child) => (
        <TreeEntry
          key={child.path}
          entry={child}
          depth={depth + 1}
          entriesByPath={entriesByPath}
          expanded={expanded}
          truncatedByPath={truncatedByPath}
          loadingPath={loadingPath}
          query={query}
          selectedPath={selectedPath}
          onToggleDir={onToggleDir}
          onPreviewFile={onPreviewFile}
        />
      ))}
      {entry.isDirectory && isExpanded && truncatedByPath[entry.path] && (
        <TreeHint text="此目录内容较多，只显示前 500 项。" compact />
      )}
    </div>
  )
}

function TreeHint({ text, compact = false }: { text: string, compact?: boolean }) {
  return (
    <div className={compact
      ? 'px-3 py-2 text-center text-[11px] text-[var(--color-text-tertiary)]'
      : 'px-3 py-6 text-center text-xs text-[var(--color-text-tertiary)]'}
    >
      {text}
    </div>
  )
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'txt') return 'article'
  if (ext === 'json' || ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return 'code'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return 'image'
  return 'description'
}

function getPathName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
