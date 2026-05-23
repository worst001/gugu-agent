import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { settingsApi } from '../api/settings'
import { skillsApi } from '../api/skills'
import { filesystemApi } from '../api/filesystem'
import { useTranslation } from '../i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useUIStore } from '../stores/uiStore'
import { SETTINGS_TAB_ID, useTabStore } from '../stores/tabStore'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { AgentRunModeControl } from '../components/controls/AgentRunModeControl'
import { PermissionModeSelector } from '../components/controls/PermissionModeSelector'
import { CE_WORKFLOW_DEFAULT_ROLE_ID } from '../constants/ceWorkflowRoles'
import { AGENT_RUN_MODE_DEFAULT, buildAgentRunModeMessage } from '../constants/agentRunModes'
import { DRAFT_AGENT_RUN_MODE_KEY, useAgentRunModeStore } from '../stores/agentRunModeStore'
import { DRAFT_CE_WORKFLOW_KEY, useCeWorkflowRoleStore } from '../stores/ceWorkflowRoleStore'
import { AttachmentGallery } from '../components/chat/AttachmentGallery'
import { FileSearchMenu, type FileSearchMenuHandle } from '../components/chat/FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from '../components/chat/LocalSlashCommandPanel'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashToken,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceSlashCommand,
  resolveSlashUiAction,
} from '../components/chat/composerUtils'
import type { SlashCommandOption } from '../components/chat/composerUtils'
import {
  validateAttachmentFile,
  type AttachmentLimitIssue,
} from '../utils/attachmentLimits'
import { listenForTauriFileDrop } from '../utils/tauriFileDrop'

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
  path?: string
  size?: number
}

export function EmptySession() {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workDir, setWorkDir] = useState('')
  const [savedDefaultWorkDir, setSavedDefaultWorkDir] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [slashCommands, setSlashCommands] = useState<SlashCommandOption[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const createSession = useSessionStore((state) => state.createSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const connectToSession = useChatStore((state) => state.connectToSession)
  const setActiveView = useUIStore((state) => state.setActiveView)
  const addToast = useUIStore((state) => state.addToast)
  const canAcceptAttachments = !isSubmitting

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const user = await settingsApi.getUser()
        if (cancelled) return
        const raw =
          typeof user.defaultSessionWorkDir === 'string'
            ? user.defaultSessionWorkDir.trim()
            : ''
        setSavedDefaultWorkDir(raw || null)
        const env =
          typeof import.meta.env.VITE_DEFAULT_SESSION_WORKDIR === 'string'
            ? import.meta.env.VITE_DEFAULT_SESSION_WORKDIR.trim()
            : ''
        const initial = raw || env
        if (initial) setWorkDir(initial)
      } catch {
        if (!cancelled) {
          setSavedDefaultWorkDir(null)
          const env =
            typeof import.meta.env.VITE_DEFAULT_SESSION_WORKDIR === 'string'
              ? import.meta.env.VITE_DEFAULT_SESSION_WORKDIR.trim()
              : ''
          if (env) setWorkDir(env)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!plusMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [plusMenuOpen])

  useEffect(() => {
    if (!slashMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setSlashMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!localSlashPanel) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setLocalSlashPanel(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [localSlashPanel])

  useEffect(() => {
    if (!fileSearchOpen) return
    const handleClick = (event: MouseEvent) => {
      const menu = document.getElementById('file-search-menu')
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setFileSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [fileSearchOpen])

  useEffect(() => {
    let cancelled = false

    skillsApi.list(workDir || undefined)
      .then(({ skills }) => {
        if (cancelled) return
        setSlashCommands(
          skills
            .filter((skill) => skill.userInvocable)
            .map((skill) => ({
              name: skill.name,
              description: skill.description,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setSlashCommands([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [workDir])

  const allSlashCommands = useMemo(
    () => mergeSlashCommands(slashCommands, FALLBACK_SLASH_COMMANDS),
    [slashCommands],
  )

  const filteredCommands = useMemo(() => {
    const source = allSlashCommands
    if (!slashFilter) return source
    const lower = slashFilter.toLowerCase()
    return source.filter((command) => (
      command.name.toLowerCase().includes(lower) ||
      command.description.toLowerCase().includes(lower)
    ))
  }, [allSlashCommands, slashFilter])

  const exactSlashCommand = useMemo(() => {
    const normalized = slashFilter.trim().toLowerCase()
    if (!normalized) return null
    return filteredCommands.find((command) => command.name.toLowerCase() === normalized) ?? null
  }, [filteredCommands, slashFilter])

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const activeItem = slashMenuOpen ? slashItemRefs.current[slashSelectedIndex] : null
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const handleSaveDefaultWorkDir = async () => {
    const dir = workDir.trim()
    if (!dir) return
    try {
      await settingsApi.updateUser({ defaultSessionWorkDir: dir })
      setSavedDefaultWorkDir(dir)
      addToast({ type: 'success', message: t('empty.defaultWorkDirSavedToast') })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.defaultWorkDirSaveFailed'),
      })
    }
  }

  const handleClearDefaultWorkDir = async () => {
    try {
      await settingsApi.updateUser({ defaultSessionWorkDir: '' })
      setSavedDefaultWorkDir(null)
      addToast({ type: 'success', message: t('empty.defaultWorkDirClearedToast') })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.defaultWorkDirSaveFailed'),
      })
    }
  }

  const handleSubmit = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || isSubmitting) return

    const slashUiAction = text.startsWith('/') ? resolveSlashUiAction(text.slice(1)) : null
    if (slashUiAction?.type === 'panel') {
      setLocalSlashPanel(slashUiAction.command as LocalSlashCommandName)
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'settings') {
      useUIStore.getState().setPendingSettingsTab(slashUiAction.tab)
      useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    setIsSubmitting(true)
    try {
      const sessionId = await createSession(workDir || undefined)
      const draftRole =
        useCeWorkflowRoleStore.getState().selections[DRAFT_CE_WORKFLOW_KEY] ?? CE_WORKFLOW_DEFAULT_ROLE_ID
      const draftMode =
        useAgentRunModeStore.getState().selections[DRAFT_AGENT_RUN_MODE_KEY] ?? AGENT_RUN_MODE_DEFAULT
      useAgentRunModeStore.getState().setMode(sessionId, draftMode)
      useCeWorkflowRoleStore.getState().setRole(sessionId, draftRole)

      setActiveView('code')
      useTabStore.getState().openTab(sessionId, 'New Session')
      connectToSession(sessionId)
      const attachmentPayload = attachments.map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        path: attachment.path,
        data: attachment.data,
        mimeType: attachment.mimeType,
      }))
      const availableSkillNames = slashCommands.length > 0
        ? slashCommands.map((command) => command.name)
        : undefined
      const { wire, display, modelPreference } = buildAgentRunModeMessage(
        draftMode,
        draftRole,
        text,
        availableSkillNames,
      )
      sendMessage(sessionId, wire, attachmentPayload, {
        displayContent: display,
        displayAttachments: attachmentPayload,
        ...(modelPreference ? { ceModelPreference: modelPreference } : {}),
      })
      setInput('')
      setAttachments([])
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (value: string, cursorPos: number) => {
    setInput(value)
    const token = findSlashToken(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
    } else {
      setSlashFilter(token.filter)
      setSlashMenuOpen(true)
    }

    // Detect @ trigger for file search
    const textBeforeCursor = value.slice(0, cursorPos)
    let pos = -1
    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
      const ch = textBeforeCursor[i]!
      if (ch === '@') {
        if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
          pos = i
          break
        }
        break
      }
      if (/\s/.test(ch)) {
        break
      }
    }
    if (pos < 0) {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
    } else {
      setAtFilter(textBeforeCursor.slice(pos + 1))
      setAtCursorPos(cursorPos)
      setSlashMenuOpen(false)
      setFileSearchOpen(true)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (event.nativeEvent.isComposing) return

    // Route file search navigation keys to FileSearchMenu
    if (fileSearchOpen) {
      const key = event.key
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Tab' || key === 'Escape') {
        event.preventDefault()
        if (key === 'Escape') {
          setFileSearchOpen(false)
          setAtFilter('')
          setAtCursorPos(-1)
          return
        }
        fileSearchRef.current?.handleKeyDown(event.nativeEvent)
        return
      }
      return
    }

    if (slashMenuOpen && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (
          event.key === 'Enter' &&
          exactSlashCommand &&
          slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()
        ) {
          event.preventDefault()
          void handleSubmit()
          return
        }
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuOpen(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const showAttachmentLimitIssue = useCallback((issue: AttachmentLimitIssue) => {
    addToast({
      type: 'warning',
      message: t(issue.key, issue.params),
      duration: 6500,
    })
  }, [addToast, t])

  const addBrowserFiles = useCallback((files: FileList | File[]) => {
    if (!canAcceptAttachments) return

    let acceptedBytes = 0
    Array.from(files).forEach((file) => {
      const issue = validateAttachmentFile(file, attachments, acceptedBytes)
      if (issue) {
        showAttachmentLimitIssue(issue)
        return
      }
      acceptedBytes += file.size

      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const isImage = file.type.startsWith('image/')
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            type: isImage ? 'image' : 'file',
            mimeType: file.type || undefined,
            previewUrl: isImage ? (reader.result as string) : undefined,
            data: reader.result as string,
            size: file.size,
          },
        ])
      }
      reader.readAsDataURL(file)
    })
  }, [attachments, canAcceptAttachments, showAttachmentLimitIssue])

  const addPathFiles = useCallback(async (paths: string[]) => {
    if (!canAcceptAttachments || paths.length === 0) return

    try {
      const { files } = await filesystemApi.metadata(paths)
      if (files.length === 0) {
        addToast({ type: 'warning', message: t('chat.fileDropFailed') })
        return
      }

      let acceptedBytes = 0
      const nextAttachments: Attachment[] = []
      for (const file of files) {
        if (file.isDirectory) {
          addToast({
            type: 'warning',
            message: t('chat.attachmentRejectedDirectory', { name: file.name }),
            duration: 6500,
          })
          continue
        }

        const issue = validateAttachmentFile({
          name: file.name,
          size: file.size,
          type: file.mimeType,
        }, [...attachments, ...nextAttachments], acceptedBytes, { allowLargeLocalArchive: true })
        if (issue) {
          showAttachmentLimitIssue(issue)
          continue
        }
        acceptedBytes += file.size

        nextAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          type: (file.mimeType ?? '').startsWith('image/') ? 'image' : 'file',
          mimeType: file.mimeType,
          path: file.path,
          size: file.size,
        })
      }

      if (nextAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...nextAttachments])
      }
    } catch {
      addToast({ type: 'warning', message: t('chat.fileDropFailed') })
    }
  }, [addToast, attachments, canAcceptAttachments, showAttachmentLimitIssue, t])

  const handlePaste = (event: React.ClipboardEvent) => {
    if (!canAcceptAttachments) return
    const items = event.clipboardData?.items
    if (!items) return

    let hasImage = false
    let acceptedBytes = 0
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || !item.type.startsWith('image/')) continue

      hasImage = true
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const name = `pasted-image-${Date.now()}.png`
      const issue = validateAttachmentFile({ name, size: file.size, type: file.type }, attachments, acceptedBytes)
      if (issue) {
        showAttachmentLimitIssue(issue)
        continue
      }
      acceptedBytes += file.size
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name,
            type: 'image',
            mimeType: file.type || undefined,
            previewUrl: reader.result as string,
            data: reader.result as string,
            size: file.size,
          },
        ])
      }
      reader.readAsDataURL(file)
    }

    if (!hasImage) return
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files) addBrowserFiles(files)
    event.target.value = ''
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)
    if (!canAcceptAttachments) return
    const files = event.dataTransfer.files
    if (files.length > 0) addBrowserFiles(files)
  }

  const handleDragEnter = (event: React.DragEvent) => {
    if (!canAcceptAttachments || !hasDraggedFiles(event)) return
    event.preventDefault()
    setIsDragActive(true)
  }

  const handleDragOver = (event: React.DragEvent) => {
    if (!canAcceptAttachments || !hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDragActive(false)
  }

  useEffect(() => {
    if (!canAcceptAttachments) {
      setIsDragActive(false)
      return
    }

    let cancelled = false
    let unlisten: (() => void) | null = null
    void listenForTauriFileDrop({
      onHover: () => setIsDragActive(true),
      onLeave: () => setIsDragActive(false),
      onDrop: (paths) => void addPathFiles(paths),
    }).then((cleanup) => {
      if (cancelled) {
        cleanup?.()
        return
      }
      unlisten = cleanup
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [addPathFiles, canAcceptAttachments])

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const selectSlashCommand = (command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashCommand(input, cursorPos, command)
    if (!replacement) return
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const insertSlashCommand = () => {
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = insertSlashTrigger(input, cursorPos)
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex flex-1 flex-col items-center justify-center p-8 pb-32">
        <div className="flex max-w-md flex-col items-center text-center">
          <img src="/app-icon.svg" alt="Gugu Agent" className="mb-6 h-24 w-24" />
          <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
            {t('empty.title')}
          </h1>
          <p className="mx-auto max-w-xs text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
            {t('empty.subtitle')}
          </p>
        </div>
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex justify-center px-8">
        <div className="flex w-full max-w-3xl flex-col gap-2">
          <div
            className="glass-panel relative flex flex-col gap-3 rounded-xl p-4"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragActive && (
              <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--color-border-focus)] bg-[var(--color-surface-container-high)]/85 text-center shadow-[var(--shadow-focus-ring)]">
                <div className="rounded-xl bg-[var(--color-surface)]/90 px-4 py-3">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('chat.dropFilesTitle')}</div>
                  <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('chat.dropFilesSubtitle')}</div>
                </div>
              </div>
            )}

            {fileSearchOpen && (
              <FileSearchMenu
                ref={fileSearchRef}
                cwd={workDir || ''}
                filter={atFilter}
                onSelect={(_path, name) => {
                  if (atCursorPos >= 0) {
                    const newValue = `${input.slice(0, atCursorPos)}${name}${input.slice(atCursorPos)}`
                    const newCursorPos = atCursorPos + name.length
                    setInput(newValue)
                    setFileSearchOpen(false)
                    setAtFilter('')
                    setAtCursorPos(-1)
                    void textareaRef.current?.focus()
                    requestAnimationFrame(() => {
                      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
                    })
                  }
                }}
              />
            )}

            {localSlashPanel && (
              <div ref={slashMenuRef}>
                <LocalSlashCommandPanel
                  command={localSlashPanel}
                  cwd={workDir || undefined}
                  commands={allSlashCommands}
                  onClose={() => setLocalSlashPanel(null)}
                />
              </div>
            )}

            {slashMenuOpen && filteredCommands.length > 0 && (
              <div
                ref={slashMenuRef}
                className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
              >
                <div className="max-h-[260px] overflow-y-auto py-1">
                  {filteredCommands.map((command, index) => (
                    <button
                      key={command.name}
                      ref={(el) => { slashItemRefs.current[index] = el }}
                      onClick={() => selectSlashCommand(command.name)}
                      onMouseEnter={() => setSlashSelectedIndex(index)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        index === slashSelectedIndex ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">/{command.name}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-tertiary)]">{command.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {attachments.length > 0 && (
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            )}

            <div className="flex items-start gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => handleInputChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="flex-1 resize-none border-none bg-transparent py-2 leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
                style={{ fontFamily: 'var(--font-body)' }}
                placeholder={t('empty.placeholder')}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between border-t border-[var(--color-border-separator)] pt-3">
              <div className="flex items-center gap-2">
                <div ref={plusMenuRef} className="relative">
                  <button
                    onClick={() => setPlusMenuOpen((prev) => !prev)}
                    aria-label="Open composer tools"
                    className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                  </button>

                  {plusMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-[240px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
                      <button
                        onClick={() => {
                          fileInputRef.current?.click()
                          setPlusMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">attach_file</span>
                        {t('empty.addFiles')}
                      </button>
                      <button
                        onClick={insertSlashCommand}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="w-5 text-center text-[18px] font-bold text-[var(--color-text-secondary)]">/</span>
                        {t('empty.slashCommands')}
                      </button>
                    </div>
                  )}
                </div>

                <PermissionModeSelector workDir={workDir} />
              </div>

              <div className="flex items-center gap-3">
                <AgentRunModeControl sessionKey={DRAFT_AGENT_RUN_MODE_KEY} disabled={isSubmitting} />
                <button
                  onClick={handleSubmit}
                  disabled={(!input.trim() && attachments.length === 0) || isSubmitting}
                  className="flex w-[112px] items-center justify-center gap-1 rounded-lg bg-[image:var(--gradient-btn-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-all hover:brightness-105 disabled:opacity-30"
                >
                  {t('common.run')}
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <DirectoryPicker value={workDir} onChange={setWorkDir} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
              {workDir.trim() ? (
                <button
                  type="button"
                  onClick={() => void handleSaveDefaultWorkDir()}
                  className="rounded-md px-2 py-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  {t('empty.saveDefaultWorkDir')}
                </button>
              ) : null}
              {savedDefaultWorkDir ? (
                <>
                  <span className="max-w-[min(100%,48rem)] truncate" title={savedDefaultWorkDir}>
                    {t('empty.defaultWorkDirActive', { path: savedDefaultWorkDir })}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleClearDefaultWorkDir()}
                    className="rounded-md px-2 py-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                  >
                    {t('empty.clearDefaultWorkDir')}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}

function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}
