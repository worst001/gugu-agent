import { useCallback, useEffect, useState } from 'react'
import { adaptersApi } from '../../api/adapters'
import type {
  WeixinConnection,
  WeixinInstallationStatus,
} from '../../types/adapter'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'

type Props = {
  onConnectionChanged?: () => Promise<void>
}

const terminalStates = new Set([
  'authorized',
  'expired',
  'failed',
  'cancelled',
])

export function WeixinConnectionCard({ onConnectionChanged }: Props) {
  const [connection, setConnection] = useState<WeixinConnection | null>(null)
  const [installation, setInstallation] = useState<WeixinInstallationStatus | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshConnection = useCallback(async () => {
    setConnection(await adaptersApi.getWeixinConnection())
  }, [])

  const synchronizeConnection = useCallback(async () => {
    try {
      await onConnectionChanged?.()
    } finally {
      await refreshConnection()
    }
  }, [onConnectionChanged, refreshConnection])

  useEffect(() => {
    void refreshConnection().catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [refreshConnection])

  useEffect(() => {
    if (!connection?.connected) return
    const timer = setInterval(() => {
      void refreshConnection().catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [connection?.connected, refreshConnection])

  useEffect(() => {
    if (!installation || terminalStates.has(installation.state)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await adaptersApi.getWeixinInstallation(
          installation.installationId,
          controller.signal,
        )
        if (controller.signal.aborted) return
        setError('')
        setInstallation(next)
        if (next.state === 'authorized') {
          try {
            await synchronizeConnection()
          } catch (err) {
            if (!controller.signal.aborted) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }
          return
        }
        if (!terminalStates.has(next.state)) timer = setTimeout(poll, 500)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
          timer = setTimeout(poll, 500)
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [installation?.installationId, synchronizeConnection])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      setInstallation(await adaptersApi.startWeixinInstallation())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!installation) return
    setBusy(true)
    setError('')
    try {
      setInstallation(await adaptersApi.submitWeixinVerification(
        installation.installationId,
        verificationCode,
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!installation) return
    setBusy(true)
    setError('')
    try {
      await adaptersApi.cancelWeixinInstallation(installation.installationId)
      setInstallation(null)
      setVerificationCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError('')
    try {
      await adaptersApi.disconnectWeixin()
      setInstallation(null)
      await synchronizeConnection()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runtimeState = connection?.runtime.state ?? 'offline'

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#07c160]" aria-hidden="true">
              chat
            </span>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">微信</h3>
            {connection?.connected && (
              <span className="rounded-full bg-[#07c160]/10 px-2 py-0.5 text-[11px] text-[#079447]">
                {runtimeState === 'online' ? '在线' : runtimeState === 'degraded' ? '连接异常' : '已授权'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            用手机微信扫码授权，无需填写 App ID 或密钥。
          </p>
          {connection?.accountId && (
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
              账号：{connection.accountId}
            </p>
          )}
        </div>
        {connection?.connected ? (
          <Button variant="danger" size="sm" loading={busy} onClick={disconnect}>
            断开连接
          </Button>
        ) : !installation || ['expired', 'failed', 'cancelled'].includes(installation.state) ? (
          <Button size="sm" loading={busy} disabled={!connection} onClick={start}>
            {installation ? '重新连接' : '连接微信'}
          </Button>
        ) : null}
      </div>

      {installation && !terminalStates.has(installation.state) && (
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
          {installation.qrCodeDataUrl && (
            <img
              src={installation.qrCodeDataUrl}
              alt="微信连接二维码"
              className="mx-auto h-[220px] w-[220px] rounded-lg"
            />
          )}
          <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
            {installation.state === 'scanned'
              ? '已扫码，请在手机微信中确认。'
              : installation.state === 'needs_verification'
                ? '请输入手机微信显示的数字。'
                : '请使用手机微信扫码。'}
          </p>
          {installation.state === 'needs_verification' && (
            <div className="mx-auto mt-3 flex max-w-[280px] gap-2">
              <Input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ''))}
                placeholder="验证码"
                inputMode="numeric"
                maxLength={8}
                aria-label="微信验证码"
              />
              <Button size="sm" loading={busy} onClick={verify}>确认</Button>
            </div>
          )}
          <button
            type="button"
            className="mt-3 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            onClick={cancel}
          >
            取消
          </button>
        </div>
      )}

      {installation && ['expired', 'failed'].includes(installation.state) && (
        <p className="mt-3 text-xs text-[var(--color-error)]">
          {installation.error || '二维码已失效，请重新连接。'}
        </p>
      )}
      {error && <p className="mt-3 text-xs text-[var(--color-error)]">{error}</p>}
    </section>
  )
}
