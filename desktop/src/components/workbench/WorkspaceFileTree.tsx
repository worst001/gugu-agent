import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { filesystemApi, type WorkspaceDirEntry, type WorkspaceTextFileResult } from '../../api/filesystem'
import { CodeViewer } from '../chat/CodeViewer'
import { CopyButton } from '../shared/CopyButton'

type Props = {
  root: string | null | undefined
  initialPath?: string | null
  fallback: ReactNode
}

const ROOT_KEY = '__root__'

export function WorkspaceFileTree({ root, fallback, initialPath }: Props) {
  const currentRootRef = useRef(root)
  const previewRequestRef = useRef(0)
  currentRootRef.current = root
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
    previewRequestRef.current += 1
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
    const requestRoot = root
    setLoadingPath(path)
    setError(null)
    try {
      const result = await filesystemApi.listWorkspaceDir(requestRoot, path === ROOT_KEY ? undefined : path)
      if (currentRootRef.current !== requestRoot) return
      setEntriesByPath((current) => ({ ...current, [path]: result.entries }))
      setTruncatedByPath((current) => ({ ...current, [path]: result.truncated }))
    } catch (err) {
      if (currentRootRef.current !== requestRoot) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentRootRef.current === requestRoot) setLoadingPath(null)
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
    const requestRoot = root
    const requestId = ++previewRequestRef.current
    setPreviewError(null)
    setPreviewErrorPath(null)
    setPreviewLoadingPath(path)
    try {
      const result = await filesystemApi.readWorkspaceTextFile(requestRoot, path)
      if (
        currentRootRef.current !== requestRoot ||
        previewRequestRef.current !== requestId
      ) return
      setSelectedFile(result)
    } catch (err) {
      if (
        currentRootRef.current !== requestRoot ||
        previewRequestRef.current !== requestId
      ) return
      setSelectedFile(null)
      setPreviewError(err instanceof Error ? err.message : String(err))
      setPreviewErrorPath(path)
    } finally {
      if (
        currentRootRef.current === requestRoot &&
        previewRequestRef.current === requestId
      ) setPreviewLoadingPath(null)
    }
  }

  useEffect(() => {
    if (!root || !initialPath) return
    void previewFile(initialPath)
  // previewFile intentionally follows the currently selected path only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath, root])

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
  const icon = entry.isDirectory ? null : getFileIcon(entry.name)
  const visibleChildren = query
    ? children.filter((child) => child.name.toLowerCase().includes(query))
    : children

  return (
    <div>
      <button
        type="button"
        onClick={() => entry.isDirectory ? void onToggleDir(entry.path) : void onPreviewFile(entry.path)}
        className={[
          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
          isSelected ? 'bg-[var(--color-surface-hover)] ring-1 ring-inset ring-[var(--color-primary)]' : '',
        ].join(' ')}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          aria-hidden="true"
          className={`material-symbols-outlined h-4 w-4 shrink-0 text-center ${
            icon?.color ?? 'text-[var(--color-text-tertiary)]'
          }`}
          style={{ fontSize: 14, lineHeight: '16px' }}
        >
          {entry.isDirectory ? (isExpanded ? 'expand_more' : 'chevron_right') : icon?.glyph}
        </span>
        {entry.isDirectory && (
          <span
            aria-hidden="true"
            className="material-symbols-outlined h-4 w-4 shrink-0 text-center text-[var(--color-text-tertiary)]"
            style={{ fontSize: 14, lineHeight: '16px' }}
          >
            {isExpanded ? 'folder_open' : 'folder'}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate ${
            entry.isDirectory
              ? 'font-medium text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {entry.name}
        </span>
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

type FileIcon = {
  glyph: string
  color: string
}

const FILE_NAME_ICONS: Record<string, FileIcon> = {
  dockerfile: { glyph: 'deployed_code', color: 'text-[#2496ED]' },
  'docker-compose.yml': { glyph: 'deployed_code', color: 'text-[#2496ED]' },
  'docker-compose.yaml': { glyph: 'deployed_code', color: 'text-[#2496ED]' },
  makefile: { glyph: 'build', color: 'text-[#9CA3AF]' },
  'cmakelists.txt': { glyph: 'build', color: 'text-[#9CA3AF]' },
  license: { glyph: 'license', color: 'text-[#D4A72C]' },
  '.gitignore': { glyph: 'account_tree', color: 'text-[#F05032]' },
  '.gitattributes': { glyph: 'account_tree', color: 'text-[#F05032]' },
}

const FILE_EXTENSION_ICONS: Record<string, FileIcon> = {
  ts: { glyph: 'code_blocks', color: 'text-[#3178C6]' },
  tsx: { glyph: 'code_blocks', color: 'text-[#61DAFB]' },
  jsx: { glyph: 'code_blocks', color: 'text-[#61DAFB]' },
  js: { glyph: 'javascript', color: 'text-[#F7DF1E]' },
  mjs: { glyph: 'javascript', color: 'text-[#F7DF1E]' },
  cjs: { glyph: 'javascript', color: 'text-[#F7DF1E]' },
  py: { glyph: 'terminal', color: 'text-[#FFD43B]' },
  rs: { glyph: 'code', color: 'text-[#DEA584]' },
  go: { glyph: 'code', color: 'text-[#00ADD8]' },
  java: { glyph: 'code', color: 'text-[#E76F00]' },
  kt: { glyph: 'code', color: 'text-[#E76F00]' },
  c: { glyph: 'code', color: 'text-[#A179DC]' },
  h: { glyph: 'code', color: 'text-[#A179DC]' },
  cpp: { glyph: 'code', color: 'text-[#A179DC]' },
  hpp: { glyph: 'code', color: 'text-[#A179DC]' },
  cs: { glyph: 'code', color: 'text-[#A179DC]' },
  html: { glyph: 'html', color: 'text-[#E34F26]' },
  htm: { glyph: 'html', color: 'text-[#E34F26]' },
  css: { glyph: 'css', color: 'text-[#1572B6]' },
  scss: { glyph: 'css', color: 'text-[#1572B6]' },
  sass: { glyph: 'css', color: 'text-[#1572B6]' },
  less: { glyph: 'css', color: 'text-[#1572B6]' },
  md: { glyph: 'markdown', color: 'text-[#519ABA]' },
  mdx: { glyph: 'markdown', color: 'text-[#519ABA]' },
  txt: { glyph: 'article', color: 'text-[#9CA3AF]' },
  rtf: { glyph: 'article', color: 'text-[#9CA3AF]' },
  json: { glyph: 'data_object', color: 'text-[#D4A72C]' },
  jsonc: { glyph: 'data_object', color: 'text-[#D4A72C]' },
  yaml: { glyph: 'data_object', color: 'text-[#D4A72C]' },
  yml: { glyph: 'data_object', color: 'text-[#D4A72C]' },
  toml: { glyph: 'data_object', color: 'text-[#D4A72C]' },
  xml: { glyph: 'data_object', color: 'text-[#D4A72C]' },
  env: { glyph: 'settings', color: 'text-[#78909C]' },
  ini: { glyph: 'settings', color: 'text-[#78909C]' },
  conf: { glyph: 'settings', color: 'text-[#78909C]' },
  config: { glyph: 'settings', color: 'text-[#78909C]' },
  properties: { glyph: 'settings', color: 'text-[#78909C]' },
  sh: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  bash: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  zsh: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  fish: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  ps1: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  bat: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  cmd: { glyph: 'terminal', color: 'text-[#4CAF50]' },
  png: { glyph: 'image', color: 'text-[#A074C4]' },
  jpg: { glyph: 'image', color: 'text-[#A074C4]' },
  jpeg: { glyph: 'image', color: 'text-[#A074C4]' },
  gif: { glyph: 'image', color: 'text-[#A074C4]' },
  webp: { glyph: 'image', color: 'text-[#A074C4]' },
  ico: { glyph: 'image', color: 'text-[#A074C4]' },
  svg: { glyph: 'draw', color: 'text-[#FFB13B]' },
  pdf: { glyph: 'picture_as_pdf', color: 'text-[#E53935]' },
  doc: { glyph: 'description', color: 'text-[#2B579A]' },
  docx: { glyph: 'description', color: 'text-[#2B579A]' },
  xls: { glyph: 'table_view', color: 'text-[#21A366]' },
  xlsx: { glyph: 'table_view', color: 'text-[#21A366]' },
  csv: { glyph: 'table_view', color: 'text-[#21A366]' },
  ods: { glyph: 'table_view', color: 'text-[#21A366]' },
  ppt: { glyph: 'co_present', color: 'text-[#D24726]' },
  pptx: { glyph: 'co_present', color: 'text-[#D24726]' },
  zip: { glyph: 'folder_zip', color: 'text-[#D4A72C]' },
  rar: { glyph: 'folder_zip', color: 'text-[#D4A72C]' },
  '7z': { glyph: 'folder_zip', color: 'text-[#D4A72C]' },
  tar: { glyph: 'folder_zip', color: 'text-[#D4A72C]' },
  gz: { glyph: 'folder_zip', color: 'text-[#D4A72C]' },
  sql: { glyph: 'database', color: 'text-[#26A69A]' },
  db: { glyph: 'database', color: 'text-[#26A69A]' },
  sqlite: { glyph: 'database', color: 'text-[#26A69A]' },
  lock: { glyph: 'lock', color: 'text-[#9CA3AF]' },
}

const FALLBACK_FILE_ICON: FileIcon = {
  glyph: 'draft',
  color: 'text-[var(--color-text-tertiary)]',
}

export function getFileIcon(name: string): FileIcon {
  const normalizedName = name.toLowerCase()
  const namedIcon = FILE_NAME_ICONS[normalizedName]
  if (namedIcon) return namedIcon

  const ext = normalizedName.includes('.') ? normalizedName.split('.').pop() : ''
  return (ext && FILE_EXTENSION_ICONS[ext]) || FALLBACK_FILE_ICON
}

function getPathName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
