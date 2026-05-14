import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Mic, MicOff, WandSparkles } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { SETTINGS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useTeamStore } from '../../stores/teamStore'
import { sessionsApi } from '../../api/sessions'
import { promptOptimizeApi } from '../../api/promptOptimize'
import { CeWorkflowRoleSelector } from '../controls/CeWorkflowRoleSelector'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { buildCeWorkflowMessage } from '../../constants/ceWorkflowRoles'
import { useCeWorkflowRoleStore } from '../../stores/ceWorkflowRoleStore'
import { AttachmentGallery } from './AttachmentGallery'
import { ProjectContextChip } from '../shared/ProjectContextChip'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { FileSearchMenu, type FileSearchMenuHandle } from './FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from './LocalSlashCommandPanel'
import {
  appendVoiceTranscript,
  getSpeechRecognitionConstructor,
  isSpeechRecognitionAvailable,
  type BrowserSpeechRecognition,
  type BrowserSpeechRecognitionEvent,
} from './speechRecognition'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashTrigger,
  mergeSlashCommands,
  replaceSlashToken,
  resolveSlashUiAction,
} from './composerUtils'
import { clearComposerDraft, loadComposerDraft, saveComposerDraft } from './composerDrafts'

type GitInfo = { branch: string | null; repoName: string | null; workDir: string; changedFiles: number }

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
}

type PromptOptimizePreview = {
  originalText: string
  optimizedText: string
  summary: string
}

type ChatInputProps = {
  variant?: 'default' | 'hero'
}

const PROMPT_OPTIMIZE_ESTIMATED_MS = 60_000
const PROMPT_OPTIMIZE_INITIAL_PROGRESS = 6
const PROMPT_OPTIMIZE_PROGRESS_CAP = 95
const PROMPT_OPTIMIZE_PROGRESS_TICK_MS = 500
const PROMPT_OPTIMIZE_SLOW_NOTICE_MS = 60_000
const COMPOSER_DRAFT_SAVE_DELAY_MS = 250
const LONG_PASTE_TEXT_THRESHOLD = 12_000

export function ChatInput({ variant = 'default' }: ChatInputProps) {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [promptOptimizePreview, setPromptOptimizePreview] = useState<PromptOptimizePreview | null>(null)
  const [isPromptOptimizing, setIsPromptOptimizing] = useState(false)
  const [promptOptimizeStartedAt, setPromptOptimizeStartedAt] = useState<number | null>(null)
  const [promptOptimizeProgress, setPromptOptimizeProgress] = useState(0)
  const [showPromptOptimizeSlowNotice, setShowPromptOptimizeSlowNotice] = useState(false)
  const [isPromptOptimizeContinuing, setIsPromptOptimizeContinuing] = useState(false)
  const [promptOptimizeError, setPromptOptimizeError] = useState<string | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [isVoiceRecording, setIsVoiceRecording] = useState(false)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const promptOptimizeAbortRef = useRef<AbortController | null>(null)
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const voiceBaseInputRef = useRef('')
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const inputRef = useRef(input)
  const { sendMessage, stopGeneration } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const runtimeSelection = useSessionRuntimeStore((s) => activeTabId ? s.selections[activeTabId] : undefined)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const slashCommands = sessionState?.slashCommands ?? []
  const composerPrefill = sessionState?.composerPrefill ?? null
  const activeSession = useSessionStore((state) => activeTabId ? state.sessions.find((session) => session.id === activeTabId) ?? null : null)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const hasMessages = useChatStore((s) => activeTabId ? (s.sessions[activeTabId]?.messages?.length ?? 0) > 0 : false)

  const isMemberSession = !!memberInfo
  const isActive = chatState !== 'idle'
  const isWorkspaceMissing = activeSession?.workDirExists === false
  const canSubmit = !isWorkspaceMissing && (input.trim().length > 0 || (!isMemberSession && attachments.length > 0))
  const canOptimizePrompt = Boolean(
    activeTabId &&
    !isMemberSession &&
    !isWorkspaceMissing &&
    !isActive &&
    !isPromptOptimizing &&
    input.trim().length > 0,
  )
  const canStartVoiceInput = Boolean(
    activeTabId &&
    !isMemberSession &&
    !isWorkspaceMissing &&
    !isActive &&
    voiceSupported,
  )
  const isHeroComposer = variant === 'hero' && !isMemberSession
  const resolvedWorkDir = activeSession?.workDir || gitInfo?.workDir || undefined
  const promptOptimizeProgressPercent = isPromptOptimizing
    ? Math.max(PROMPT_OPTIMIZE_INITIAL_PROGRESS, promptOptimizeProgress)
    : 0

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
  }, [isActive])

  useEffect(() => {
    setVoiceSupported(isSpeechRecognitionAvailable())
  }, [])

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.abort()
      speechRecognitionRef.current = null
      setIsVoiceRecording(false)
    }
  }, [activeTabId])

  useEffect(() => {
    if (!isPromptOptimizing || promptOptimizeStartedAt === null) return

    const updateProgress = () => {
      const elapsed = Date.now() - promptOptimizeStartedAt
      const ratio = Math.min(elapsed / PROMPT_OPTIMIZE_ESTIMATED_MS, 1)
      const easedRatio = 1 - Math.pow(1 - ratio, 2)
      const nextProgress = Math.round(easedRatio * PROMPT_OPTIMIZE_PROGRESS_CAP)

      setPromptOptimizeProgress(Math.min(
        PROMPT_OPTIMIZE_PROGRESS_CAP,
        Math.max(PROMPT_OPTIMIZE_INITIAL_PROGRESS, nextProgress),
      ))
    }

    updateProgress()
    const intervalId = window.setInterval(updateProgress, PROMPT_OPTIMIZE_PROGRESS_TICK_MS)

    return () => window.clearInterval(intervalId)
  }, [isPromptOptimizing, promptOptimizeStartedAt])

  useEffect(() => {
    if (!isPromptOptimizing || promptOptimizeStartedAt === null || isPromptOptimizeContinuing) return

    const elapsed = Date.now() - promptOptimizeStartedAt
    const delay = Math.max(0, PROMPT_OPTIMIZE_SLOW_NOTICE_MS - elapsed)
    const timeoutId = window.setTimeout(() => {
      setShowPromptOptimizeSlowNotice(true)
    }, delay)

    return () => window.clearTimeout(timeoutId)
  }, [isPromptOptimizing, promptOptimizeStartedAt, isPromptOptimizeContinuing])

  useEffect(() => {
    if (!activeTabId || isMemberSession) {
      inputRef.current = ''
      setInput('')
      setAttachments([])
      return
    }

    const draft = loadComposerDraft(activeTabId)
    const draftText = draft?.text ?? ''
    inputRef.current = draftText
    setInput(draftText)
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
    setSlashFilter('')
    setAtFilter('')
    setAtCursorPos(-1)
    setPromptOptimizePreview(null)
    setPromptOptimizeError(null)
  }, [activeTabId, isMemberSession])

  useEffect(() => {
    if (!activeTabId || isMemberSession) return

    const timeoutId = window.setTimeout(() => {
      saveComposerDraft(activeTabId, input)
    }, COMPOSER_DRAFT_SAVE_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [activeTabId, input, isMemberSession])

  useEffect(() => {
    if (!activeTabId || isMemberSession) return
    const sessionId = activeTabId

    return () => {
      saveComposerDraft(sessionId, inputRef.current)
    }
  }, [activeTabId, isMemberSession])

  useEffect(() => {
    if (!composerPrefill) return

    setInput(composerPrefill.text)
    setAttachments(
      (composerPrefill.attachments ?? [])
        .filter((attachment) => attachment.type === 'image' || attachment.data)
        .map((attachment, index) => ({
          id: `rewind-prefill-${composerPrefill.nonce}-${index}`,
          name: attachment.name,
          type: attachment.type,
          mimeType: attachment.mimeType,
          previewUrl: attachment.type === 'image' ? attachment.data : undefined,
          data: attachment.data,
        })),
    )
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setSlashFilter('')
    setAtFilter('')
    setAtCursorPos(-1)
    setPromptOptimizePreview(null)
    setPromptOptimizeError(null)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      el?.focus()
      const cursor = composerPrefill.text.length
      el?.setSelectionRange(cursor, cursor)
    })
  }, [composerPrefill])

  useEffect(() => {
    if (!activeTabId) {
      setGitInfo(null)
      return
    }
    if (isMemberSession) {
      setGitInfo(null)
      return
    }
    sessionsApi.getGitInfo(activeTabId).then(setGitInfo).catch(() => setGitInfo(null))
  }, [activeTabId, isMemberSession])

  useEffect(() => {
    if (!isMemberSession) return
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
  }, [isMemberSession, activeTabId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

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

  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    const token = findSlashTrigger(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
      return
    }

    setFileSearchOpen(false)
    setSlashFilter(token.filter)
    setSlashMenuOpen(true)
  }, [])

  // Detect @ trigger (file search)
  const detectAtTrigger = useCallback((value: string, cursorPos: number) => {
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
      return
    }

    // Extract filter text after @
    const filter = textBeforeCursor.slice(pos + 1)
    setAtFilter(filter)
    setAtCursorPos(cursorPos)
    setSlashMenuOpen(false)
    setFileSearchOpen(true)
  }, [])

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setPromptOptimizePreview(null)
    setPromptOptimizeError(null)
    if (isMemberSession) {
      setInput(value)
      return
    }
    const cursorPos = event.target.selectionStart ?? value.length
    setInput(value)
    detectSlashTrigger(value, cursorPos)
    detectAtTrigger(value, cursorPos)
  }

  const selectSlashCommand = useCallback((command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, command)
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }, [input])

  const handleSubmit = (overrideText?: string) => {
    if (!activeTabId) return
    if (!isMemberSession && isActive) return
    const text = (overrideText ?? input).trim()
    if ((!text && (!attachments.length || isMemberSession)) || isWorkspaceMissing) return

    const slashUiAction = overrideText === undefined && !isMemberSession && text.startsWith('/')
      ? resolveSlashUiAction(text.slice(1))
      : null
    if (slashUiAction?.type === 'panel') {
      setLocalSlashPanel(slashUiAction.command as LocalSlashCommandName)
      if (activeTabId) clearComposerDraft(activeTabId)
      inputRef.current = ''
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'settings') {
      useUIStore.getState().setPendingSettingsTab(slashUiAction.tab)
      useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
      if (activeTabId) clearComposerDraft(activeTabId)
      inputRef.current = ''
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    const attachmentPayload = attachments.map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      data: attachment.data,
      mimeType: attachment.mimeType,
    }))

    if (!isMemberSession) {
      const roleId = useCeWorkflowRoleStore.getState().selections[activeTabId]
      const { wire, display, modelPreference } = buildCeWorkflowMessage(roleId, text)
      sendMessage(activeTabId, wire, attachmentPayload, {
        displayContent: display,
        displayAttachments: attachmentPayload,
        ceModelPreference: modelPreference,
      })
    } else {
      sendMessage(activeTabId, text)
    }
    if (activeTabId) clearComposerDraft(activeTabId)
    inputRef.current = ''
    setInput('')
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
    setPromptOptimizePreview(null)
    setPromptOptimizeError(null)
  }

  const handleOptimizePrompt = async () => {
    if (!activeTabId || !canOptimizePrompt) return
    const originalText = input.trim()
    setIsPromptOptimizing(true)
    setPromptOptimizeStartedAt(Date.now())
    setPromptOptimizeProgress(PROMPT_OPTIMIZE_INITIAL_PROGRESS)
    setShowPromptOptimizeSlowNotice(false)
    setIsPromptOptimizeContinuing(false)
    setPromptOptimizePreview(null)
    setPromptOptimizeError(null)
    const controller = new AbortController()
    promptOptimizeAbortRef.current = controller
    try {
      const result = await promptOptimizeApi.optimize({
        text: originalText,
        sessionId: activeTabId,
        ...(runtimeSelection
          ? {
              providerId: runtimeSelection.providerId,
            }
          : {}),
      }, {
        signal: controller.signal,
      })
      setPromptOptimizePreview({
        originalText,
        optimizedText: result.optimizedText,
        summary: result.summary,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setPromptOptimizeError(error instanceof Error ? error.message : t('chat.promptOptimize.failed'))
    } finally {
      if (promptOptimizeAbortRef.current === controller) {
        promptOptimizeAbortRef.current = null
      }
      setIsPromptOptimizing(false)
      setPromptOptimizeStartedAt(null)
      setPromptOptimizeProgress(0)
      setShowPromptOptimizeSlowNotice(false)
      setIsPromptOptimizeContinuing(false)
    }
  }

  const continuePromptOptimization = () => {
    setShowPromptOptimizeSlowNotice(false)
    setIsPromptOptimizeContinuing(true)
  }

  const cancelPromptOptimization = () => {
    promptOptimizeAbortRef.current?.abort()
    promptOptimizeAbortRef.current = null
    setIsPromptOptimizing(false)
    setPromptOptimizeStartedAt(null)
    setPromptOptimizeProgress(0)
    setShowPromptOptimizeSlowNotice(false)
    setIsPromptOptimizeContinuing(false)
    setPromptOptimizeError(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const replaceWithOptimizedPrompt = () => {
    if (!promptOptimizePreview) return
    setInput(promptOptimizePreview.optimizedText)
    setPromptOptimizePreview(null)
    setPromptOptimizeError(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const sendOptimizedPrompt = () => {
    if (!promptOptimizePreview) return
    handleSubmit(promptOptimizePreview.optimizedText)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return

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
      // Other keys (typing) should go to the textarea - let it propagate
      return
    }

    if (localSlashPanel) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setLocalSlashPanel(null)
        return
      }
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
      if (event.key === 'Enter') {
        if (exactSlashCommand && slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()) {
          event.preventDefault()
          handleSubmit()
          return
        }
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Tab') {
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

  const handlePaste = (event: React.ClipboardEvent) => {
    if (isMemberSession) return
    const items = event.clipboardData?.items

    let hasImage = false
    if (items) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (!item || !item.type.startsWith('image/')) continue

        hasImage = true
        event.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const reader = new FileReader()
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: `pasted-image-${Date.now()}.png`,
              type: 'image',
              mimeType: file.type || 'image/png',
              previewUrl: reader.result as string,
              data: reader.result as string,
            },
          ])
        }
        reader.readAsDataURL(file)
      }
    }

    if (hasImage) return

    const text = event.clipboardData.getData('text/plain')
    if (text.length < LONG_PASTE_TEXT_THRESHOLD) return

    event.preventDefault()
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const name = `pasted-text-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    const reader = new FileReader()
    reader.onload = () => {
      setAttachments((prev) => [
        ...prev,
        {
          id,
          name,
          type: 'file',
          mimeType: 'text/plain',
          data: reader.result as string,
        },
      ])
      useUIStore.getState().addToast({
        type: 'info',
        message: t('chat.longPasteConverted'),
      })
    }
    reader.readAsDataURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isMemberSession) return
    const files = event.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
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
          },
        ])
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (isMemberSession) return
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const fakeEvent = { target: { files } } as React.ChangeEvent<HTMLInputElement>
      handleFileSelect(fakeEvent)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const insertSlashCommand = () => {
    if (isMemberSession) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, '', { trailingSpace: false })
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const stopVoiceInput = () => {
    const recognition = speechRecognitionRef.current
    speechRecognitionRef.current = null
    recognition?.stop()
    setIsVoiceRecording(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleVoiceInput = () => {
    if (isVoiceRecording) {
      stopVoiceInput()
      return
    }

    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) {
      useUIStore.getState().addToast({
        type: 'info',
        message: t('chat.voice.unavailable'),
      })
      setVoiceSupported(false)
      return
    }

    if (!canStartVoiceInput) return

    try {
      const recognition = new SpeechRecognition()
      recognition.lang = window.navigator.language || 'zh-CN'
      recognition.continuous = false
      recognition.interimResults = true
      recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
        let transcript = ''
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index]?.[0]?.transcript ?? ''
        }
        setInput(appendVoiceTranscript(voiceBaseInputRef.current, transcript))
      }
      recognition.onerror = (event) => {
        const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? t('chat.voice.permissionDenied')
          : t('chat.voice.failed')
        useUIStore.getState().addToast({ type: 'error', message })
        speechRecognitionRef.current = null
        setIsVoiceRecording(false)
      }
      recognition.onend = () => {
        speechRecognitionRef.current = null
        setIsVoiceRecording(false)
        requestAnimationFrame(() => textareaRef.current?.focus())
      }

      voiceBaseInputRef.current = input
      speechRecognitionRef.current = recognition
      setIsVoiceRecording(true)
      recognition.start()
    } catch {
      speechRecognitionRef.current = null
      setIsVoiceRecording(false)
      useUIStore.getState().addToast({
        type: 'error',
        message: t('chat.voice.failed'),
      })
    }
  }

  const composerPlaceholder =
    isHeroComposer
      ? t('empty.placeholder')
      : isWorkspaceMissing
        ? t('chat.placeholderMissing')
        : isMemberSession
          ? t('teams.memberPlaceholder')
          : t('chat.placeholder')

  const addFilesLabel = isHeroComposer ? t('empty.addFiles') : t('chat.addFiles')
  const slashCommandsLabel = isHeroComposer ? t('empty.slashCommands') : t('chat.slashCommands')
  const voiceButtonTitle = !voiceSupported
    ? t('chat.voice.unavailable')
    : isVoiceRecording
      ? t('chat.voice.stop')
      : t('chat.voice.start')

  return (
    <div className={isHeroComposer ? 'bg-[var(--color-surface)] px-8 pb-4' : 'bg-[var(--color-surface)] px-4 py-4'}>
      <div className={isHeroComposer ? 'mx-auto flex w-full max-w-3xl flex-col gap-2' : 'mx-auto max-w-[860px]'}>
        <div
          className={isHeroComposer
            ? 'glass-panel relative flex flex-col gap-3 rounded-xl p-4 transition-colors'
            : 'glass-panel relative rounded-xl p-4 transition-colors'}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {!isMemberSession && fileSearchOpen && (
            <FileSearchMenu
              ref={fileSearchRef}
              cwd={resolvedWorkDir || ''}
              filter={atFilter}
              onSelect={(_path, name) => {
                if (atCursorPos >= 0) {
                  // Insert name at cursor position, replacing filter text
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

          {!isMemberSession && localSlashPanel && (
            <div ref={slashMenuRef}>
              <LocalSlashCommandPanel
                command={localSlashPanel}
                sessionId={activeTabId ?? undefined}
                cwd={resolvedWorkDir}
                commands={allSlashCommands}
                onClose={() => setLocalSlashPanel(null)}
              />
            </div>
          )}

          {!isMemberSession && slashMenuOpen && filteredCommands.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
            >
              <div className="max-h-[300px] overflow-y-auto py-1">
                {filteredCommands.map((command, index) => (
                  <button
                    key={command.name}
                    ref={(el) => { slashItemRefs.current[index] = el }}
                    onClick={() => selectSlashCommand(command.name)}
                    onMouseEnter={() => setSlashSelectedIndex(index)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      index === slashSelectedIndex
                        ? 'bg-[var(--color-surface-hover)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                      /{command.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-tertiary)]">
                      {command.description}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Up/Down</kbd>
                <span>{t('chat.navigate')}</span>
                <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
                <span>{t('chat.select')}</span>
                <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
                <span>{t('chat.dismiss')}</span>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            isHeroComposer ? (
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            ) : (
              <div className="px-3 pt-3">
                <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
              </div>
            )
          )}

          {!isMemberSession && isVoiceRecording && (
            <div className={isHeroComposer ? 'flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-xs text-[var(--color-text-secondary)]' : 'mx-1 mb-3 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-xs text-[var(--color-text-secondary)]'}>
              <Mic className="h-4 w-4 animate-pulse text-[var(--color-text-accent)]" />
              <span>{t('chat.voice.listening')}</span>
            </div>
          )}

          {!isMemberSession && (isPromptOptimizing || promptOptimizePreview || promptOptimizeError) && (
            <div className={isHeroComposer ? 'space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3' : 'mx-1 mb-3 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3'}>
              {isPromptOptimizing ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    <div className="flex min-w-0 items-center gap-2">
                      <WandSparkles className="h-4 w-4 shrink-0 animate-pulse text-[var(--color-text-accent)]" />
                      <span className="truncate">{t('chat.promptOptimize.loading')}</span>
                    </div>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">
                      {t('chat.promptOptimize.progress', { progress: promptOptimizeProgressPercent })}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={t('chat.promptOptimize.loading')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={promptOptimizeProgressPercent}
                    className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-border)_55%,transparent)]"
                  >
                    <div
                      className="h-full rounded-full bg-[image:var(--gradient-btn-primary)] transition-[width] duration-500 ease-out"
                      style={{ width: `${promptOptimizeProgressPercent}%` }}
                    />
                  </div>
                  {showPromptOptimizeSlowNotice && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                      <span className="min-w-0 flex-1 leading-relaxed">
                        {t('chat.promptOptimize.slowNotice')}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelPromptOptimization}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          {t('chat.promptOptimize.cancelWait')}
                        </button>
                        <button
                          type="button"
                          onClick={continuePromptOptimization}
                          className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          {t('chat.promptOptimize.continueWait')}
                        </button>
                      </div>
                    </div>
                  )}
                  {isPromptOptimizeContinuing && (
                    <div className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
                      {t('chat.promptOptimize.continuing')}
                    </div>
                  )}
                </div>
              ) : promptOptimizePreview ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="min-w-0">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-tertiary)]">
                        {t('chat.promptOptimize.original')}
                      </div>
                      <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--color-surface-container-lowest)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                        {promptOptimizePreview.originalText}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-tertiary)]">
                        {t('chat.promptOptimize.optimized')}
                      </div>
                      <div className="max-h-[160px] overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--color-surface-container-lowest)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-primary)]">
                        {promptOptimizePreview.optimizedText}
                      </div>
                    </div>
                  </div>
                  {promptOptimizePreview.summary && (
                    <div className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
                      <span className="font-semibold text-[var(--color-text-secondary)]">{t('chat.promptOptimize.summary')}</span>
                      <span className="ml-2">{promptOptimizePreview.summary}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPromptOptimizePreview(null)
                        setPromptOptimizeError(null)
                      }}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      {t('chat.promptOptimize.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={replaceWithOptimizedPrompt}
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      {t('chat.promptOptimize.replace')}
                    </button>
                    <button
                      type="button"
                      onClick={sendOptimizedPrompt}
                      className="rounded-md bg-[image:var(--gradient-btn-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-all hover:brightness-105"
                    >
                      {t('chat.promptOptimize.send')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  {promptOptimizeError}
                </div>
              )}
            </div>
          )}

          {isHeroComposer ? (
            <div className="flex items-start gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={() => { composingRef.current = false }}
                onPaste={handlePaste}
                placeholder={composerPlaceholder}
                disabled={isWorkspaceMissing}
                rows={2}
                className="flex-1 resize-none border-none bg-transparent py-2 leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
              />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onPaste={handlePaste}
              placeholder={composerPlaceholder}
              disabled={isWorkspaceMissing}
              rows={1}
              className="w-full resize-none bg-transparent py-2 pb-12 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
            />
          )}

          <div className={isHeroComposer
            ? 'flex items-center justify-between border-t border-[var(--color-border-separator)] pt-3'
            : 'absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-[var(--color-border-separator)] px-3 py-3'}>
            <div className="flex items-center gap-2">
              {!isMemberSession && (
                <>
                  <div ref={plusMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setPlusMenuOpen((value) => !value)}
                      disabled={isActive || isWorkspaceMissing}
                      aria-label="Open composer tools"
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>

                    {plusMenuOpen && (
                      <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
                        <button
                          onClick={() => {
                            fileInputRef.current?.click()
                            setPlusMenuOpen(false)
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">attach_file</span>
                          <span className="text-sm text-[var(--color-text-primary)]">{addFilesLabel}</span>
                        </button>
                        <button
                          onClick={insertSlashCommand}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="w-[24px] text-center text-[18px] font-bold text-[var(--color-text-secondary)]">/</span>
                          <span className="text-sm text-[var(--color-text-primary)]">{slashCommandsLabel}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleOptimizePrompt}
                    disabled={!canOptimizePrompt}
                    title={isPromptOptimizing ? t('chat.promptOptimize.loading') : t('chat.promptOptimize.title')}
                    aria-label={t('chat.promptOptimize.title')}
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <WandSparkles className={`h-[18px] w-[18px] ${isPromptOptimizing ? 'animate-pulse text-[var(--color-text-accent)]' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    disabled={!isVoiceRecording && !canStartVoiceInput}
                    title={voiceButtonTitle}
                    aria-label={isVoiceRecording ? t('chat.voice.stop') : t('chat.voice.start')}
                    aria-pressed={isVoiceRecording}
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {isVoiceRecording ? (
                      <MicOff className="h-[18px] w-[18px] text-[var(--color-text-accent)]" />
                    ) : (
                      <Mic className="h-[18px] w-[18px]" />
                    )}
                  </button>

                  <PermissionModeSelector />
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!isMemberSession && activeTabId && (
                <CeWorkflowRoleSelector sessionKey={activeTabId} disabled={isWorkspaceMissing} />
              )}
              <button
                onClick={!isMemberSession && isActive ? () => stopGeneration(activeTabId!) : () => handleSubmit()}
                disabled={!isMemberSession && isActive ? false : !canSubmit}
                title={!isMemberSession && isActive ? t('chat.stopTitle') : undefined}
                className={`flex w-[112px] items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:brightness-105 disabled:opacity-30 ${
                  !isMemberSession && isActive
                    ? 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                    : 'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)]'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {!isMemberSession && isActive ? 'stop' : 'arrow_forward'}
                </span>
                {!isMemberSession && isActive ? t('common.stop') : isMemberSession ? t('common.send') : t('common.run')}
              </button>
            </div>
          </div>
        </div>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

        {!isMemberSession && (
          <div className="mt-3 px-1">
            {hasMessages ? (
              <ProjectContextChip
                workDir={resolvedWorkDir}
                repoName={gitInfo?.repoName || null}
                branch={gitInfo?.branch || null}
              />
            ) : (
              <DirectoryPicker
                value={resolvedWorkDir || ''}
                onChange={async (newWorkDir) => {
                  if (!activeTabId) return
                  const oldId = activeTabId
                  const { deleteSession, createSession } = useSessionStore.getState()
                  const { replaceTabSession } = useTabStore.getState()
                  const { disconnectSession, connectToSession } = useChatStore.getState()
                  const newId = await createSession(newWorkDir)
                  useSessionRuntimeStore.getState().moveSelection(oldId, newId)
                  useCeWorkflowRoleStore.getState().moveRole(oldId, newId)
                  disconnectSession(oldId)
                  replaceTabSession(oldId, newId)
                  connectToSession(newId)
                  deleteSession(oldId).catch(() => {})
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
