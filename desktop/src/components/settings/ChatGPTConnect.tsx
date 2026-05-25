import { useEffect, useRef } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useChatGPTOAuthStore } from '../../stores/chatgptOAuthStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'

async function openAuthorizeUrl(url: string): Promise<void> {
  try {
    await shellOpen(url)
    return
  } catch (err) {
    console.warn('[ChatGPTConnect] Tauri shell.open failed, falling back to window.open:', err)
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    throw new Error('Browser blocked the ChatGPT authorization popup. Please allow popups and try again.')
  }
}

export function ChatGPTConnect() {
  const t = useTranslation()
  const hasEnsuredProviderRef = useRef(false)
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    ensureProvider,
    startPolling,
    stopPolling,
  } = useChatGPTOAuthStore()
  const fetchProviders = useProviderStore((s) => s.fetchProviders)
  const fetchSettings = useSettingsStore((s) => s.fetchAll)

  const syncProvider = async () => {
    try {
      const latestStatus = await fetchStatus()
      if (!latestStatus?.loggedIn) return
      hasEnsuredProviderRef.current = true
      await ensureProvider()
      if (typeof fetchProviders === 'function') await fetchProviders()
      if (typeof fetchSettings === 'function') await fetchSettings()
    } catch (err) {
      hasEnsuredProviderRef.current = false
      useChatGPTOAuthStore.setState({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  useEffect(() => {
    void syncProvider()
    const handleFocus = () => {
      void syncProvider()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
      stopPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!status?.loggedIn || hasEnsuredProviderRef.current) return
    hasEnsuredProviderRef.current = true
    void ensureProvider()
      .then(async () => {
        if (typeof fetchProviders === 'function') await fetchProviders()
        if (typeof fetchSettings === 'function') await fetchSettings()
      })
      .catch(() => {
        hasEnsuredProviderRef.current = false
      })
  }, [ensureProvider, fetchProviders, fetchSettings, status])

  const handleLogin = async () => {
    hasEnsuredProviderRef.current = false
    try {
      const { authorizeUrl } = await login()
      await openAuthorizeUrl(authorizeUrl)
      startPolling()
      window.setTimeout(() => {
        void syncProvider()
      }, 1000)
    } catch (err) {
      console.error('[ChatGPTConnect] login failed:', err)
      useChatGPTOAuthStore.setState({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleLogout = async () => {
    hasEnsuredProviderRef.current = false
    await logout()
  }

  if (status === null) {
    return (
      <div className="text-xs text-[var(--color-text-tertiary)]">
        {t('common.loading')}
      </div>
    )
  }

  if (status.loggedIn) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--color-success)]">
          {t('settings.chatgptConnect.connected')}
          {status.accountId ? ` (${status.accountId})` : ''}
        </span>
        <button
          type="button"
          onClick={handleLogin}
          disabled={isLoading}
          className="px-3 py-1 text-xs rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {isLoading
            ? t('settings.chatgptConnect.connecting')
            : t('settings.chatgptConnect.reconnect')}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoading}
          className="px-3 py-1 text-xs rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {isLoading
            ? t('settings.chatgptConnect.disconnecting')
            : t('settings.chatgptConnect.disconnect')}
        </button>
        {error && (
          <span className="text-xs text-[var(--color-error)]">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.chatgptConnect.intro')}
      </div>
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="self-start rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:brightness-105 disabled:opacity-50 transition-opacity"
      >
        {isLoading
          ? t('settings.chatgptConnect.connecting')
          : t('settings.chatgptConnect.connect')}
      </button>
      {error && (
        <div className="text-xs text-[var(--color-error)]">
          {error}
        </div>
      )}
    </div>
  )
}
