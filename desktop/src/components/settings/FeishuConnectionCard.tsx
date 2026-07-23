import { useCallback, useEffect, useState } from 'react'
import { adaptersApi } from '../../api/adapters'
import { openExternalFromAppAction } from '../../utils/appActions'
import type {
  FeishuConnection,
  FeishuInstallationStatus,
} from '../../types/adapter'
import { Button } from '../shared/Button'

type Props = {
  onConnectionChanged?: () => Promise<void>
}

const terminalStates = new Set([
  'authorized',
  'expired',
  'failed',
  'cancelled',
])

export function FeishuConnectionCard({ onConnectionChanged }: Props) {
  const [connection, setConnection] = useState<FeishuConnection | null>(null)
  const [installation, setInstallation] =
    useState<FeishuInstallationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshConnection = useCallback(async () => {
    setConnection(await adaptersApi.getFeishuConnection())
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
    if (!installation || terminalStates.has(installation.state)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await adaptersApi.getFeishuInstallation(
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
        if (!terminalStates.has(next.state)) timer = setTimeout(poll, 750)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
          timer = setTimeout(poll, 750)
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
      setInstallation(await adaptersApi.startFeishuInstallation())
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
      await adaptersApi.cancelFeishuInstallation(installation.installationId)
      setInstallation(null)
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
      await adaptersApi.disconnectFeishu()
      setInstallation(null)
      await synchronizeConnection()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#3370ff]" aria-hidden="true">
              send
            </span>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">飞书</h3>
            {connection?.connected && (
              <span className="rounded-full bg-[#3370ff]/10 px-2 py-0.5 text-[11px] text-[#3370ff]">
                已连接
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            用手机系统相机扫码创建并授权 Bot，无需手动填写 App ID 或密钥。
          </p>
          {connection?.appId && (
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
              应用：{connection.appId}
            </p>
          )}
        </div>
        {connection?.connected ? (
          <Button variant="danger" size="sm" loading={busy} onClick={disconnect}>
            断开连接
          </Button>
        ) : !installation || ['expired', 'failed', 'cancelled'].includes(installation.state) ? (
          <Button size="sm" loading={busy} disabled={!connection} onClick={start}>
            {installation ? '重新连接' : '连接飞书'}
          </Button>
        ) : null}
      </div>

      {installation && !terminalStates.has(installation.state) && (
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
          {installation.qrCodeDataUrl && (
            <img
              src={installation.qrCodeDataUrl}
              alt="飞书连接二维码"
              className="mx-auto h-[280px] w-[280px] rounded-lg"
            />
          )}
          <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
            {installation.state === 'authorizing'
              ? '授权已确认，正在保存应用并启动本地接入。'
              : '请用手机系统相机扫码；飞书 App 内置扫一扫可能提示二维码不合法。'}
          </p>
          {installation.authorizationUrl && installation.state === 'waiting' && (
            <button
              type="button"
              className="mt-3 block w-full text-xs font-medium text-[#3370ff] hover:underline"
              onClick={() => void openExternalFromAppAction(installation.authorizationUrl!)}
            >
              在浏览器打开授权页
            </button>
          )}
          {installation.state === 'waiting' && (
            <button
              type="button"
              className="mt-3 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              onClick={cancel}
            >
              取消
            </button>
          )}
        </div>
      )}

      {installation && ['expired', 'failed'].includes(installation.state) && (
        <p className="mt-3 text-xs text-[var(--color-error)]">
          {installation.error || '飞书二维码已失效，请重新连接。'}
        </p>
      )}
      {error && <p className="mt-3 text-xs text-[var(--color-error)]">{error}</p>}
    </section>
  )
}
