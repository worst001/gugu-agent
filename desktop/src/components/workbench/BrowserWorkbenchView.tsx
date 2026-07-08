import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nativeBrowserApi, type NativeBrowserBounds } from '../../api/nativeBrowser'
import { useTranslation } from '../../i18n'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { openExternalFromAppAction } from '../../utils/appActions'

type Props = {
  sessionId: string
}

const DEFAULT_BROWSER_URL = ''
const MIN_BROWSER_SIZE = 80
const SLOW_LOAD_NOTICE_MS = 30_000

function normalizeBrowserTarget(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) return trimmed

  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }

  if (/^[^\s]+\.[^\s]+$/.test(trimmed)) {
    return `https://${trimmed}`
  }

  return `https://www.baidu.com/s?wd=${encodeURIComponent(trimmed)}`
}

function boundsFromElement(element: HTMLElement): NativeBrowserBounds | null {
  const rect = element.getBoundingClientRect()
  const width = Math.floor(rect.width)
  const height = Math.floor(rect.height)
  if (width < MIN_BROWSER_SIZE || height < MIN_BROWSER_SIZE) return null
  return {
    x: Math.max(0, Math.floor(rect.left)),
    y: Math.max(0, Math.floor(rect.top)),
    width,
    height,
  }
}

function sameBounds(left: NativeBrowserBounds | null, right: NativeBrowserBounds | null) {
  if (!left || !right) return false
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function BrowserWorkbenchView({ sessionId }: Props) {
  const t = useTranslation()
  const isNativeAvailable = nativeBrowserApi.isAvailable()
  const initialUrl = useMemo(
    () => useWorkbenchStore.getState().getSessionState(sessionId).browserUrl ?? DEFAULT_BROWSER_URL,
    [sessionId],
  )
  const setBrowserUrl = useWorkbenchStore((state) => state.setBrowserUrl)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const createdRef = useRef(false)
  const lastBoundsRef = useRef<NativeBrowserBounds | null>(null)
  const currentUrlRef = useRef(initialUrl)
  const [urlInput, setUrlInput] = useState(initialUrl)
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [hasBrowser, setHasBrowser] = useState(false)
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [suggestedExternalUrl, setSuggestedExternalUrl] = useState<string | null>(null)

  const statusText = useMemo(() => {
    if (notice) return notice
    if (isLoading) return t('workbench.browser.loading')
    return title || currentUrl || t('workbench.browser.empty')
  }, [currentUrl, isLoading, notice, t, title])
  const externalTarget = suggestedExternalUrl ?? currentUrl
  const hasExternalTarget = externalTarget.trim().length > 0

  useEffect(() => {
    currentUrlRef.current = currentUrl
    setBrowserUrl(sessionId, currentUrl || null)
  }, [currentUrl, sessionId, setBrowserUrl])

  const setBrowserBounds = useCallback(async (bounds: NativeBrowserBounds) => {
    if (sameBounds(lastBoundsRef.current, bounds)) return
    lastBoundsRef.current = bounds
    if (!createdRef.current) return
    try {
      await nativeBrowserApi.setBounds({ sessionId, bounds })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const ensureBrowser = useCallback(async (url: string) => {
    const element = surfaceRef.current
    if (!element || !isNativeAvailable) return null
    const bounds = boundsFromElement(element)
    if (!bounds) return null
    lastBoundsRef.current = bounds
    try {
      const result = await nativeBrowserApi.create({ sessionId, url, bounds })
      createdRef.current = true
      setHasBrowser(true)
      setCurrentUrl(result.url)
      setUrlInput(result.url)
      setNotice(null)
      return result.url
    } catch (error) {
      createdRef.current = false
      setHasBrowser(false)
      setNotice(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [isNativeAvailable, sessionId])

  const navigate = useCallback(async (raw: string) => {
    const nextUrl = normalizeBrowserTarget(raw)
    if (!nextUrl) return

    setUrlInput(nextUrl)
    setCurrentUrl(nextUrl)
    setNotice(null)
    setSuggestedExternalUrl(null)

    if (!isNativeAvailable) {
      await openExternalFromAppAction(nextUrl)
      return
    }

    if (createdRef.current) {
      try {
        await nativeBrowserApi.close(sessionId)
      } catch {
        // Recreate the browser from the current panel bounds even if the old child
        // webview was already gone after a hot reload or platform-level reset.
      } finally {
        createdRef.current = false
        setHasBrowser(false)
        lastBoundsRef.current = null
      }
    }

    await ensureBrowser(nextUrl)
  }, [ensureBrowser, isNativeAvailable, sessionId])

  const runBrowserAction = useCallback(async (action: 'back' | 'forward' | 'reload' | 'stop') => {
    if (!isNativeAvailable || !createdRef.current) return
    try {
      if (action === 'back') await nativeBrowserApi.goBack(sessionId)
      if (action === 'forward') await nativeBrowserApi.goForward(sessionId)
      if (action === 'reload') await nativeBrowserApi.reload(sessionId)
      if (action === 'stop') await nativeBrowserApi.stop(sessionId)
      setNotice(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [isNativeAvailable, sessionId])

  const copyCurrentUrl = useCallback(async () => {
    if (!hasExternalTarget) return
    try {
      await navigator.clipboard?.writeText(externalTarget)
      setNotice(t('workbench.browser.copied'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [externalTarget, hasExternalTarget, t])

  useEffect(() => {
    if (!isNativeAvailable) return

    let cancelled = false
    let frame = 0

    const syncBounds = () => {
      if (cancelled) return
      const element = surfaceRef.current
      const bounds = element ? boundsFromElement(element) : null
      if (bounds) void setBrowserBounds(bounds)
    }

    const boot = () => {
      if (cancelled) return
      if (currentUrlRef.current) void ensureBrowser(currentUrlRef.current)
      syncBounds()
    }

    frame = window.requestAnimationFrame(boot)

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => syncBounds())
        : null
    if (surfaceRef.current) observer?.observe(surfaceRef.current)
    window.addEventListener('resize', syncBounds)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', syncBounds)
      if (createdRef.current) void nativeBrowserApi.hide(sessionId).catch(() => {})
    }
  }, [ensureBrowser, isNativeAvailable, sessionId, setBrowserBounds])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false

    void nativeBrowserApi.listen((event) => {
      if (cancelled || event.sessionId !== sessionId) return
      const shouldReflectUrl =
        event.event === 'loading-started' ||
        event.event === 'loading-finished' ||
        event.event === 'navigation'
      if (shouldReflectUrl && event.url) {
        setCurrentUrl(event.url)
        setUrlInput(event.url)
        setSuggestedExternalUrl(null)
      }
      if (event.event === 'loading-started') setIsLoading(true)
      if (event.event === 'loading-finished') {
        setIsLoading(false)
        setNotice((current) => current === t('workbench.browser.loadSlow') ? null : current)
      }
      if (event.event === 'title-changed') setTitle(event.title ?? '')
      if (event.event === 'navigation-blocked') {
        setNotice(event.message ?? t('workbench.browser.navigationBlocked'))
      }
      if (event.event === 'new-window') {
        setSuggestedExternalUrl(event.url ?? null)
        setNotice(t('workbench.browser.newWindowBlocked'))
      }
      if (event.event === 'download-requested') {
        setSuggestedExternalUrl(event.url ?? null)
        setNotice(t('workbench.browser.downloadBlocked'))
      }
    }).then((nextUnlisten) => {
      if (cancelled) nextUnlisten()
      else unlisten = nextUnlisten
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [sessionId, t])

  useEffect(() => {
    if (!isLoading) return
    const timeout = window.setTimeout(() => {
      setNotice(t('workbench.browser.loadSlow'))
    }, SLOW_LOAD_NOTICE_MS)
    return () => window.clearTimeout(timeout)
  }, [isLoading, t])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => void runBrowserAction('back')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          disabled={!isNativeAvailable || !hasBrowser}
          title={t('workbench.browser.back')}
          aria-label={t('workbench.browser.back')}
        >
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_back</span>
        </button>
        <button
          type="button"
          onClick={() => void runBrowserAction('forward')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          disabled={!isNativeAvailable || !hasBrowser}
          title={t('workbench.browser.forward')}
          aria-label={t('workbench.browser.forward')}
        >
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_forward</span>
        </button>
        <button
          type="button"
          onClick={() => void runBrowserAction(isLoading ? 'stop' : 'reload')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          disabled={!isNativeAvailable || !hasBrowser}
          title={isLoading ? t('workbench.browser.stop') : t('workbench.browser.reload')}
          aria-label={isLoading ? t('workbench.browser.stop') : t('workbench.browser.reload')}
        >
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
            {isLoading ? 'close' : 'refresh'}
          </span>
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            void navigate(urlInput)
          }}
        >
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder={t('workbench.browser.urlPlaceholder')}
            aria-label={t('workbench.browser.urlPlaceholder')}
            className="h-8 w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-left text-[11px] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:bg-[var(--color-surface)]"
          />
        </form>
        <button
          type="button"
          onClick={() => void navigate(urlInput)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          title={t('workbench.browser.go')}
          aria-label={t('workbench.browser.go')}
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
        </button>
        <button
          type="button"
          onClick={() => void copyCurrentUrl()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          title={t('workbench.browser.copy')}
          aria-label={t('workbench.browser.copy')}
          disabled={!hasExternalTarget}
        >
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">content_copy</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (hasExternalTarget) void openExternalFromAppAction(externalTarget)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          title={t('workbench.browser.external')}
          aria-label={t('workbench.browser.external')}
          disabled={!hasExternalTarget}
        >
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">open_in_new</span>
        </button>
      </div>

      <div className="truncate px-1 text-[10px] text-[var(--color-text-tertiary)]">
        {statusText}
      </div>

      <div
        ref={surfaceRef}
        data-testid="native-browser-surface"
        className="relative min-h-[260px] flex-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)]"
      >
        {isNativeAvailable && !hasBrowser && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[12px] text-[var(--color-text-secondary)]">
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">public</span>
            <div>{t('workbench.browser.emptyHint')}</div>
          </div>
        )}
        {!isNativeAvailable && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-[12px] text-[var(--color-text-secondary)]">
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">public</span>
            <div>{t('workbench.browser.desktopOnly')}</div>
            <button
              type="button"
              onClick={() => {
                if (hasExternalTarget) void openExternalFromAppAction(externalTarget)
              }}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
              disabled={!hasExternalTarget}
            >
              {t('workbench.browser.external')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
