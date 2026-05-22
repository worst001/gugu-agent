import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useAdapterStore } from '../stores/adapterStore'
import { useTranslation } from '../i18n'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { adaptersApi } from '../api/adapters'
import type { AdapterDiagnostics, AdapterPlatform } from '../types/adapter'

type ImTab = Exclude<AdapterPlatform, 'telegram'>
const visibleAdapterPlatforms = new Set<AdapterPlatform>(['feishu', 'dingtalk', 'wecom', 'qq'])
const FEISHU_DEVELOPER_CONSOLE_URL = 'https://open.feishu.cn/app?lang=zh-CN'
const DINGTALK_DEVELOPER_CONSOLE_URL = 'https://open.dingtalk.com/'
const WECOM_ADMIN_CONSOLE_URL = 'https://work.weixin.qq.com/wework_admin/frame'
const QQ_DEVELOPER_CONSOLE_URL = 'https://q.qq.com/qqbot/#/developer/developer-setting'

function openExternalUrl(url: string) {
  void import('@tauri-apps/plugin-shell')
    .then((mod) => mod.open(url))
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function parseStringAllowedUsers(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function AdapterSettings() {
  const t = useTranslation()
  const {
    config,
    isLoading,
    fetchConfig,
    updateConfig,
    generatePairingCode,
    removePairedUser,
    restartAdapters,
  } = useAdapterStore()

  // Active IM tab —— Feishu 默认展示，在前
  const [activeIm, setActiveIm] = useState<ImTab>('feishu')

  // Server —— serverUrl 不再暴露在 UI 里（见下方 Server URL 注释），
  // 桌面端用 Tauri env var 注入动态端口。
  const [defaultProjectDir, setDefaultProjectDir] = useState('')

  // Feishu
  const [fsAppId, setFsAppId] = useState('')
  const [fsAppSecret, setFsAppSecret] = useState('')
  const [fsEncryptKey, setFsEncryptKey] = useState('')
  const [fsVerificationToken, setFsVerificationToken] = useState('')
  const [fsAllowedUsers, setFsAllowedUsers] = useState('')
  const [fsStreamingCard, setFsStreamingCard] = useState(false)

  // DingTalk
  const [dtClientId, setDtClientId] = useState('')
  const [dtClientSecret, setDtClientSecret] = useState('')
  const [dtRobotCode, setDtRobotCode] = useState('')
  const [dtWebhookUrl, setDtWebhookUrl] = useState('')
  const [dtWebhookSecret, setDtWebhookSecret] = useState('')
  const [dtAllowedUsers, setDtAllowedUsers] = useState('')

  // WeCom
  const [wcCorpId, setWcCorpId] = useState('')
  const [wcAgentId, setWcAgentId] = useState('')
  const [wcSecret, setWcSecret] = useState('')
  const [wcToken, setWcToken] = useState('')
  const [wcEncodingAesKey, setWcEncodingAesKey] = useState('')
  const [wcWebhookUrl, setWcWebhookUrl] = useState('')
  const [wcAllowedUsers, setWcAllowedUsers] = useState('')

  // QQ
  const [qqAppId, setQqAppId] = useState('')
  const [qqToken, setQqToken] = useState('')
  const [qqAppSecret, setQqAppSecret] = useState('')
  const [qqSandbox, setQqSandbox] = useState(false)
  const [qqOneBotUrl, setQqOneBotUrl] = useState('')
  const [qqOneBotAccessToken, setQqOneBotAccessToken] = useState('')
  const [qqAllowedUsers, setQqAllowedUsers] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [diagnostics, setDiagnostics] = useState<AdapterDiagnostics | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [isRestartingAdapters, setIsRestartingAdapters] = useState(false)
  const [adapterRestartStatus, setAdapterRestartStatus] = useState<'idle' | 'started' | 'error'>('idle')
  const [adapterRestartError, setAdapterRestartError] = useState('')

  // Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [pendingUnbind, setPendingUnbind] = useState<{ platform: AdapterPlatform; userId: string | number } | null>(null)
  const [isUnbinding, setIsUnbinding] = useState(false)

  useEffect(() => {
    fetchConfig()
  }, [])

  // Sync form state when config is loaded
  useEffect(() => {
    setDefaultProjectDir(config.defaultProjectDir ?? '')
    setFsAppId(config.feishu?.appId ?? '')
    setFsAppSecret(config.feishu?.appSecret ?? '')
    setFsEncryptKey(config.feishu?.encryptKey ?? '')
    setFsVerificationToken(config.feishu?.verificationToken ?? '')
    setFsAllowedUsers(config.feishu?.allowedUsers?.join(', ') ?? '')
    setFsStreamingCard(config.feishu?.streamingCard ?? false)
    setDtClientId(config.dingtalk?.clientId ?? '')
    setDtClientSecret(config.dingtalk?.clientSecret ?? '')
    setDtRobotCode(config.dingtalk?.robotCode ?? '')
    setDtWebhookUrl(config.dingtalk?.webhookUrl ?? '')
    setDtWebhookSecret(config.dingtalk?.webhookSecret ?? '')
    setDtAllowedUsers(config.dingtalk?.allowedUsers?.join(', ') ?? '')
    setWcCorpId(config.wecom?.corpId ?? '')
    setWcAgentId(config.wecom?.agentId ?? '')
    setWcSecret(config.wecom?.secret ?? '')
    setWcToken(config.wecom?.token ?? '')
    setWcEncodingAesKey(config.wecom?.encodingAesKey ?? '')
    setWcWebhookUrl(config.wecom?.webhookUrl ?? '')
    setWcAllowedUsers(config.wecom?.allowedUsers?.join(', ') ?? '')
    setQqAppId(config.qq?.appId ?? '')
    setQqToken(config.qq?.token ?? '')
    setQqAppSecret(config.qq?.appSecret ?? '')
    setQqSandbox(config.qq?.sandbox ?? false)
    setQqOneBotUrl(config.qq?.oneBotUrl ?? '')
    setQqOneBotAccessToken(config.qq?.oneBotAccessToken ?? '')
    setQqAllowedUsers(config.qq?.allowedUsers?.join(', ') ?? '')
  }, [config])

  async function handleSave() {
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const patch: Record<string, unknown> = {}

      patch.defaultProjectDir = defaultProjectDir.trim()
      const fsUsers = parseStringAllowedUsers(fsAllowedUsers)

      patch.feishu = {
        appId: fsAppId.trim(),
        appSecret: fsAppSecret.trim(),
        encryptKey: fsEncryptKey.trim(),
        verificationToken: fsVerificationToken.trim(),
        allowedUsers: fsUsers.length ? fsUsers : [],
        streamingCard: fsStreamingCard,
      }

      const dtUsers = parseStringAllowedUsers(dtAllowedUsers)
      patch.dingtalk = {
        clientId: dtClientId.trim(),
        clientSecret: dtClientSecret.trim(),
        robotCode: dtRobotCode.trim(),
        webhookUrl: dtWebhookUrl.trim(),
        webhookSecret: dtWebhookSecret.trim(),
        allowedUsers: dtUsers.length ? dtUsers : [],
      }

      const wcUsers = parseStringAllowedUsers(wcAllowedUsers)
      patch.wecom = {
        corpId: wcCorpId.trim(),
        agentId: wcAgentId.trim(),
        secret: wcSecret.trim(),
        token: wcToken.trim(),
        encodingAesKey: wcEncodingAesKey.trim(),
        webhookUrl: wcWebhookUrl.trim(),
        allowedUsers: wcUsers.length ? wcUsers : [],
      }

      const qqUsers = parseStringAllowedUsers(qqAllowedUsers)
      patch.qq = {
        appId: qqAppId.trim(),
        token: qqToken.trim(),
        appSecret: qqAppSecret.trim(),
        sandbox: qqSandbox,
        oneBotUrl: qqOneBotUrl.trim(),
        oneBotAccessToken: qqOneBotAccessToken.trim(),
        allowedUsers: qqUsers.length ? qqUsers : [],
      }

      await updateConfig(patch)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateCode = useCallback(async () => {
    setIsGenerating(true)
    try {
      const code = await generatePairingCode()
      setPairingCode(code)
    } catch (err) {
      console.error('Failed to generate pairing code:', err)
    } finally {
      setIsGenerating(false)
    }
  }, [generatePairingCode])

  const handleUnbind = useCallback(async (platform: AdapterPlatform, userId: string | number) => {
    setPendingUnbind({ platform, userId })
  }, [])

  const confirmUnbind = useCallback(async () => {
    if (!pendingUnbind) return
    setIsUnbinding(true)
    try {
      await removePairedUser(pendingUnbind.platform, pendingUnbind.userId)
      await fetchConfig()
      setPendingUnbind(null)
    } finally {
      setIsUnbinding(false)
    }
  }, [pendingUnbind, removePairedUser, fetchConfig])

  const handleCheckConfig = useCallback(async () => {
    setIsChecking(true)
    setCheckError('')
    try {
      setDiagnostics(await adaptersApi.getStatus())
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setIsChecking(false)
    }
  }, [])

  const handleRestartAdapters = useCallback(async () => {
    setIsRestartingAdapters(true)
    setAdapterRestartStatus('idle')
    setAdapterRestartError('')
    try {
      await restartAdapters()
      setAdapterRestartStatus('started')
      setTimeout(() => setAdapterRestartStatus('idle'), 3000)
    } catch (err) {
      setAdapterRestartStatus('error')
      setAdapterRestartError(err instanceof Error ? err.message : 'Restart failed')
    } finally {
      setIsRestartingAdapters(false)
    }
  }, [restartAdapters])

  // Collect all paired users across platforms
  const allPairedUsers = [
    ...(config.feishu?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'feishu' as const })),
    ...(config.dingtalk?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'dingtalk' as const })),
    ...(config.wecom?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'wecom' as const })),
    ...(config.qq?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'qq' as const })),
  ].filter((u) => visibleAdapterPlatforms.has(u.platform))
  const fsAllowedCount = parseStringAllowedUsers(fsAllowedUsers).length
  const dtAllowedCount = parseStringAllowedUsers(dtAllowedUsers).length
  const wcAllowedCount = parseStringAllowedUsers(wcAllowedUsers).length
  const qqAllowedCount = parseStringAllowedUsers(qqAllowedUsers).length
  const totalAllowedCount = fsAllowedCount + dtAllowedCount + wcAllowedCount + qqAllowedCount
  const feishuCredentialsReady = hasText(fsAppId) && hasText(fsAppSecret)
  const dingtalkCredentialsReady = hasText(dtClientId) && hasText(dtClientSecret)
  const wecomCredentialsReady = hasText(wcCorpId)
    && hasText(wcAgentId)
    && hasText(wcSecret)
    && hasText(wcToken)
    && hasText(wcEncodingAesKey)
  const qqCredentialsReady = (hasText(qqAppId) && (hasText(qqAppSecret) || hasText(qqToken))) || hasText(qqOneBotUrl)
  const activeChannelCount = Number(feishuCredentialsReady)
    + Number(dingtalkCredentialsReady)
    + Number(wecomCredentialsReady)
    + Number(qqCredentialsReady)
  const visibleDiagnosticChannels = diagnostics?.channels.filter((channel) => channel.platform !== 'telegram') ?? []

  // Check pairing expiry
  const pairingExpiry = config.pairing?.expiresAt
  const isPairingActive = pairingExpiry ? Date.now() < pairingExpiry : false
  const minutesLeft = pairingExpiry ? Math.max(0, Math.ceil((pairingExpiry - Date.now()) / 60000)) : 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]">
        <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
        Loading...
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Description */}
      <div>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('settings.adapters.description')}</p>
      </div>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-brand)]">verified_user</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('settings.adapters.securityTitle')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {t('settings.adapters.securityDesc')}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCheckConfig}
                loading={isChecking}
                icon={<span className="material-symbols-outlined text-[15px]" aria-hidden="true">fact_check</span>}
              >
                {t('settings.adapters.checkConfig')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRestartAdapters}
                loading={isRestartingAdapters}
                icon={<span className="material-symbols-outlined text-[16px]">play_circle</span>}
              >
                {t('settings.adapters.restartLocalAdapters')}
              </Button>
            </div>
            <p className="max-w-[260px] text-right text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              {t('settings.adapters.localRuntimeHint')}
            </p>
          </div>
        </div>
        {checkError && (
          <div className="mb-3 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
            {checkError}
          </div>
        )}
        {adapterRestartStatus === 'started' && (
          <div className="mb-3 rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-xs text-[var(--color-success)]">
            {t('settings.adapters.localRuntimeStarted')}
          </div>
        )}
        {adapterRestartStatus === 'error' && (
          <div className="mb-3 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
            {t('settings.adapters.localRuntimeStartFailed')} {adapterRestartError}
          </div>
        )}
        {diagnostics && (
          <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">{t('settings.adapters.diagnosticsTitle')}</span>
              <span>{diagnostics.configLocation}</span>
              <span>·</span>
              <span>
                {diagnostics.defaultProjectConfigured
                  ? t('settings.adapters.defaultProjectReady')
                  : t('settings.adapters.defaultProjectMissing')}
              </span>
              <span>·</span>
              <span>
                {diagnostics.pairingActive
                  ? t('settings.adapters.pairingActive')
                  : t('settings.adapters.pairingInactive')}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {visibleDiagnosticChannels.map((channel) => (
                <ChannelDiagnostic key={channel.platform} channel={channel} />
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              {t('settings.adapters.diagnosticsHint')}
            </p>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <BoundaryMetric
            icon="vpn_key"
            label={t('settings.adapters.statusCredentials')}
            value={activeChannelCount > 0
              ? t('settings.adapters.statusCredentialsReady', { count: activeChannelCount })
              : t('settings.adapters.statusCredentialsMissing')}
            tone={activeChannelCount > 0 ? 'success' : 'warning'}
          />
          <BoundaryMetric
            icon="link"
            label={t('settings.adapters.statusPairing')}
            value={allPairedUsers.length > 0
              ? t('settings.adapters.statusPairingCount', { count: allPairedUsers.length })
              : t('settings.adapters.statusPairingEmpty')}
            tone={allPairedUsers.length > 0 ? 'success' : 'neutral'}
          />
          <BoundaryMetric
            icon="group"
            label={t('settings.adapters.statusAllowlist')}
            value={totalAllowedCount > 0
              ? t('settings.adapters.statusAllowlistRestricted', { count: totalAllowedCount })
              : t('settings.adapters.statusAllowlistPairedOnly')}
            tone={totalAllowedCount > 0 ? 'success' : 'neutral'}
          />
        </div>
      </section>

      {/* Pairing */}
      <section className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-[var(--color-surface-hover)] border-b border-[var(--color-border)]">
          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">link</span>
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.adapters.pairing')}</span>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">{t('settings.adapters.pairingDesc')}</p>

          {/* Generate code */}
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerateCode} loading={isGenerating}>
              {pairingCode || isPairingActive ? t('settings.adapters.regenerateCode') : t('settings.adapters.generateCode')}
            </Button>
            {pairingCode && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xl font-bold tracking-[0.3em] text-[var(--color-brand)]">
                  {pairingCode}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.codeExpiresIn')} 60 {t('settings.adapters.minutes')}
                </span>
              </div>
            )}
            {!pairingCode && isPairingActive && (
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {t('settings.adapters.codeExpiresIn')} {minutesLeft} {t('settings.adapters.minutes')}
              </span>
            )}
          </div>
          {pairingCode && (
            <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.pairingCodeHint')}</p>
          )}

          {/* Paired users list */}
          <div>
            <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">{t('settings.adapters.pairedUsers')}</h4>
            {allPairedUsers.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.adapters.noPairedUsers')}</p>
            ) : (
              <div className="space-y-2">
                {allPairedUsers.map((user) => (
                  <div
                    key={`${user.platform}-${user.userId}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--color-surface-hover)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
                        {t(`settings.adapters.platform.${user.platform}`)}
                      </span>
                      <span className="text-sm text-[var(--color-text-primary)]">{user.displayName}</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {new Date(user.pairedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      onClick={() => handleUnbind(user.platform, user.userId)}
                      className="text-xs text-[var(--color-error)] hover:underline cursor-pointer"
                    >
                      {t('settings.adapters.unbind')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Server URL —— 之前是个手填字段，但桌面端 Tauri 启动 adapter sidecar
          时已经把 server 的动态端口通过 ADAPTER_SERVER_URL env var 注进去了，
          loadConfig() 里 env 优先级高于这里的 file value，所以这个字段在桌面
          运行时完全不会被读到。用户也根本不知道该填什么端口（每次启动随机）。
          Standalone 模式（直接 bun run adapters/...）保留 file 字段兜底就够了。 */}

      {/* Default Project */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('settings.adapters.defaultProject')}
        </label>
        <DirectoryPicker value={defaultProjectDir} onChange={setDefaultProjectDir} />
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {t('settings.adapters.defaultProjectHint')}
        </p>
      </div>

      {/* IM Adapter Tabs */}
      <section className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div role="tablist" aria-label="IM adapter" className="flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]">
          <ImTabButton
            label={t('settings.adapters.feishu')}
            active={activeIm === 'feishu'}
            onClick={() => setActiveIm('feishu')}
          />
          <ImTabButton
            label={t('settings.adapters.dingtalk')}
            active={activeIm === 'dingtalk'}
            onClick={() => setActiveIm('dingtalk')}
          />
          <ImTabButton
            label={t('settings.adapters.wecom')}
            active={activeIm === 'wecom'}
            onClick={() => setActiveIm('wecom')}
          />
          <ImTabButton
            label={t('settings.adapters.qq')}
            active={activeIm === 'qq'}
            onClick={() => setActiveIm('qq')}
          />
        </div>

        {activeIm === 'feishu' && (
          <div className="p-4 space-y-4">
            <AdapterStatusNotice
              ready={feishuCredentialsReady}
              title={t(feishuCredentialsReady
                ? 'settings.adapters.feishuCredentialsReady'
                : 'settings.adapters.feishuCredentialsMissing')}
              description={t('settings.adapters.feishuStatusDesc')}
            />
            <FeishuSetupGuide
              onRestartAdapters={handleRestartAdapters}
              isRestartingAdapters={isRestartingAdapters}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('settings.adapters.appId')}
                value={fsAppId}
                onChange={(e) => setFsAppId(e.target.value)}
                placeholder={t('settings.adapters.appIdPlaceholder')}
              />
              <Input
                label={t('settings.adapters.appSecret')}
                type="password"
                value={fsAppSecret}
                onChange={(e) => setFsAppSecret(e.target.value)}
                placeholder={t('settings.adapters.appSecretPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('settings.adapters.encryptKey')}
                type="password"
                value={fsEncryptKey}
                onChange={(e) => setFsEncryptKey(e.target.value)}
                placeholder={t('settings.adapters.encryptKeyPlaceholder')}
              />
              <Input
                label={t('settings.adapters.verificationToken')}
                type="password"
                value={fsVerificationToken}
                onChange={(e) => setFsVerificationToken(e.target.value)}
                placeholder={t('settings.adapters.verificationTokenPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={fsAllowedUsers}
                onChange={(e) => setFsAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.fsAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={fsStreamingCard}
                onChange={(e) => setFsStreamingCard(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
              />
              <div>
                <span className="text-sm text-[var(--color-text-primary)]">{t('settings.adapters.streamingCard')}</span>
                <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.streamingCardDesc')}</p>
              </div>
            </label>
          </div>
        )}

        {activeIm === 'dingtalk' && (
          <div className="p-4 space-y-4">
            <AdapterStatusNotice
              ready={dingtalkCredentialsReady}
              title={t(dingtalkCredentialsReady
                ? 'settings.adapters.dingtalkCredentialsReady'
                : 'settings.adapters.dingtalkCredentialsMissing')}
              description={t('settings.adapters.dingtalkStatusDesc')}
            />
            <DingtalkSetupGuide
              onRestartAdapters={handleRestartAdapters}
              isRestartingAdapters={isRestartingAdapters}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('settings.adapters.clientId')}
                value={dtClientId}
                onChange={(e) => setDtClientId(e.target.value)}
                placeholder={t('settings.adapters.dingtalkClientIdPlaceholder')}
              />
              <Input
                label={t('settings.adapters.clientSecret')}
                type="password"
                value={dtClientSecret}
                onChange={(e) => setDtClientSecret(e.target.value)}
                placeholder={t('settings.adapters.clientSecretPlaceholder')}
              />
            </div>
            <Input
              label={t('settings.adapters.robotCode')}
              value={dtRobotCode}
              onChange={(e) => setDtRobotCode(e.target.value)}
              placeholder={t('settings.adapters.robotCodePlaceholder')}
            />
            <div className="flex flex-col gap-1">
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={dtAllowedUsers}
                onChange={(e) => setDtAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.dtAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          </div>
        )}

        {activeIm === 'wecom' && (
          <div className="p-4 space-y-4">
            <AdapterStatusNotice
              ready={wecomCredentialsReady}
              title={t(wecomCredentialsReady
                ? 'settings.adapters.wecomCredentialsReady'
                : 'settings.adapters.wecomCredentialsMissing')}
              description={t('settings.adapters.wecomStatusDesc')}
            />
            <WecomSetupGuide
              onRestartAdapters={handleRestartAdapters}
              isRestartingAdapters={isRestartingAdapters}
              callbackUrl={wcWebhookUrl.trim()}
            />
            <div className="grid gap-4 md:grid-cols-3">
              <Input
                label={t('settings.adapters.corpId')}
                value={wcCorpId}
                onChange={(e) => setWcCorpId(e.target.value)}
                placeholder={t('settings.adapters.corpIdPlaceholder')}
              />
              <Input
                label={t('settings.adapters.agentId')}
                value={wcAgentId}
                onChange={(e) => setWcAgentId(e.target.value)}
                placeholder={t('settings.adapters.agentIdPlaceholder')}
              />
              <Input
                label={t('settings.adapters.secret')}
                type="password"
                value={wcSecret}
                onChange={(e) => setWcSecret(e.target.value)}
                placeholder={t('settings.adapters.secretPlaceholder')}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label={t('settings.adapters.token')}
                type="password"
                value={wcToken}
                onChange={(e) => setWcToken(e.target.value)}
                placeholder={t('settings.adapters.tokenPlaceholder')}
              />
              <Input
                label={t('settings.adapters.encodingAesKey')}
                type="password"
                value={wcEncodingAesKey}
                onChange={(e) => setWcEncodingAesKey(e.target.value)}
                placeholder={t('settings.adapters.encodingAesKeyPlaceholder')}
              />
            </div>
            <Input
              label={t('settings.adapters.wecomPublicCallbackUrl')}
              value={wcWebhookUrl}
              onChange={(e) => setWcWebhookUrl(e.target.value)}
              placeholder={t('settings.adapters.wecomPublicCallbackUrlPlaceholder')}
            />
            <div className="flex flex-col gap-1">
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={wcAllowedUsers}
                onChange={(e) => setWcAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.wcAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          </div>
        )}

        {activeIm === 'qq' && (
          <div className="p-4 space-y-4">
            <AdapterStatusNotice
              ready={qqCredentialsReady}
              title={t(qqCredentialsReady
                ? 'settings.adapters.qqCredentialsReady'
                : 'settings.adapters.qqCredentialsMissing')}
              description={t('settings.adapters.qqStatusDesc')}
            />
            <QqSetupGuide
              onRestartAdapters={handleRestartAdapters}
              isRestartingAdapters={isRestartingAdapters}
            />
            <div className="grid gap-4 md:grid-cols-3">
              <Input
                label={t('settings.adapters.qqAppId')}
                value={qqAppId}
                onChange={(e) => setQqAppId(e.target.value)}
                placeholder={t('settings.adapters.qqAppIdPlaceholder')}
              />
              <Input
                label={t('settings.adapters.qqToken')}
                type="password"
                value={qqToken}
                onChange={(e) => setQqToken(e.target.value)}
                placeholder={t('settings.adapters.qqTokenPlaceholder')}
              />
              <Input
                label={t('settings.adapters.appSecret')}
                type="password"
                value={qqAppSecret}
                onChange={(e) => setQqAppSecret(e.target.value)}
                placeholder={t('settings.adapters.qqAppSecretPlaceholder')}
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={qqSandbox}
                onChange={(e) => setQqSandbox(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
              />
              <div>
                <span className="text-sm text-[var(--color-text-primary)]">{t('settings.adapters.qqSandbox')}</span>
                <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.qqSandboxDesc')}</p>
              </div>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label={t('settings.adapters.oneBotUrl')}
                value={qqOneBotUrl}
                onChange={(e) => setQqOneBotUrl(e.target.value)}
                placeholder={t('settings.adapters.oneBotUrlPlaceholder')}
              />
              <Input
                label={t('settings.adapters.oneBotAccessToken')}
                type="password"
                value={qqOneBotAccessToken}
                onChange={(e) => setQqOneBotAccessToken(e.target.value)}
                placeholder={t('settings.adapters.oneBotAccessTokenPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={qqAllowedUsers}
                onChange={(e) => setQqAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.qqAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          </div>
        )}
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={isSaving}>
          {saveStatus === 'saved' ? t('settings.adapters.saved') : t('settings.adapters.save')}
        </Button>
        {saveStatus === 'saved' && (
          <span className="text-sm text-[var(--color-success)]">
            <span className="material-symbols-outlined text-[16px] align-middle mr-1">check_circle</span>
            {t('settings.adapters.saved')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-sm text-[var(--color-error)]">
            <span className="material-symbols-outlined text-[16px] align-middle mr-1">error</span>
            {saveError}
          </span>
        )}
      </div>

      <ConfirmDialog
        open={pendingUnbind !== null}
        onClose={() => {
          if (isUnbinding) return
          setPendingUnbind(null)
        }}
        onConfirm={confirmUnbind}
        title={t('settings.adapters.unbind')}
        body={t('settings.adapters.unbindConfirm')}
        confirmLabel={t('settings.adapters.unbind')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isUnbinding}
      />
    </div>
  )
}

function BoundaryMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: string
  label: string
  value: string
  tone: 'success' | 'warning' | 'neutral'
}) {
  const toneClass = tone === 'success'
    ? 'text-[var(--color-success)]'
    : tone === 'warning'
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-text-secondary)]'

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`material-symbols-outlined text-[18px] ${toneClass}`}>{icon}</span>
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      </div>
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}

function AdapterStatusNotice({
  ready,
  title,
  description,
}: {
  ready: boolean
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <span className={`material-symbols-outlined mt-0.5 text-[18px] ${ready ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
        {ready ? 'check_circle' : 'error'}
      </span>
      <div>
        <div className="text-sm font-medium text-[var(--color-text-primary)]">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{description}</div>
      </div>
    </div>
  )
}

function DingtalkSetupGuide({
  onRestartAdapters,
  isRestartingAdapters,
}: {
  onRestartAdapters: () => void
  isRestartingAdapters: boolean
}) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border-y border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--color-surface-hover)]"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-brand)]">forum</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.adapters.dingtalkSetupTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {t('settings.adapters.dingtalkSetupSummary')}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
          {isOpen ? t('settings.adapters.feishuSetupCollapse') : t('settings.adapters.feishuSetupExpand')}
          <span className={`material-symbols-outlined text-[18px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-[var(--color-border)] px-3 py-3">
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <FeishuPlaceCard
              icon="web"
              title={t('settings.adapters.dingtalkDevConsoleLabel')}
              description={t('settings.adapters.dingtalkDevConsoleDesc')}
            />
            <FeishuPlaceCard
              icon="chat"
              title={t('settings.adapters.dingtalkAppLabel')}
              description={t('settings.adapters.dingtalkAppDesc')}
            />
          </div>
          <div className="space-y-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-[var(--color-text-primary)]">
                  {t('settings.adapters.dingtalkSetupConsoleTitle')}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openExternalUrl(DINGTALK_DEVELOPER_CONSOLE_URL)}
                  icon={<span className="material-symbols-outlined text-[16px]">open_in_new</span>}
                >
                  {t('settings.adapters.dingtalkOpenDeveloperConsole')}
                </Button>
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.dingtalkStepCreateApp')}
                  description={t('settings.adapters.dingtalkStepCreateAppDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.dingtalkStepCreateAppDetail1'),
                        t('settings.adapters.dingtalkStepCreateAppDetail2'),
                        t('settings.adapters.dingtalkStepCreateAppDetail3'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.dingtalkStepCredentials')}
                  description={t('settings.adapters.dingtalkStepCredentialsDesc')}
                  extra={(
                    <div className="mt-1 grid gap-1.5">
                      <PermissionRow scope="Client ID / AppKey" description={t('settings.adapters.dingtalkClientIdDesc')} />
                      <PermissionRow scope="Client Secret / AppSecret" description={t('settings.adapters.dingtalkClientSecretDesc')} />
                      <PermissionRow scope="Robot Code" description={t('settings.adapters.dingtalkRobotCodeDesc')} optional />
                    </div>
                  )}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.dingtalkStepBotAbility')}
                  description={t('settings.adapters.dingtalkStepBotAbilityDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.dingtalkStepBotAbilityDetail1'),
                        t('settings.adapters.dingtalkStepBotAbilityDetail2'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.dingtalkStepStream')}
                  description={t('settings.adapters.dingtalkStepStreamDesc')}
                  extra={(
                    <div className="mt-1 grid gap-2">
                      <DetailList
                        items={[
                          t('settings.adapters.dingtalkStepStreamDetail1'),
                          t('settings.adapters.dingtalkStepStreamDetail2'),
                          t('settings.adapters.dingtalkStepStreamDetail3'),
                        ]}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <CodePill>Stream</CodePill>
                        <CodePill>/v1.0/im/bot/messages/get</CodePill>
                      </div>
                    </div>
                  )}
                />
                <SetupStep
                  number="5"
                  title={t('settings.adapters.dingtalkStepPublish')}
                  description={t('settings.adapters.dingtalkStepPublishDesc')}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.dingtalkSetupLocalTitle')}
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.dingtalkLocalStepFill')}
                  description={t('settings.adapters.dingtalkLocalStepFillDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.dingtalkLocalStepFillDetail1'),
                        t('settings.adapters.dingtalkLocalStepFillDetail2'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.dingtalkLocalStepSave')}
                  description={t('settings.adapters.dingtalkLocalStepSaveDesc')}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.dingtalkLocalStepStart')}
                  description={t('settings.adapters.dingtalkLocalStepStartDesc')}
                  action={(
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onRestartAdapters}
                      loading={isRestartingAdapters}
                      icon={<span className="material-symbols-outlined text-[16px]">play_circle</span>}
                    >
                      {t('settings.adapters.restartLocalAdapters')}
                    </Button>
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.dingtalkLocalStepPair')}
                  description={t('settings.adapters.dingtalkLocalStepPairDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.dingtalkLocalStepPairDetail1'),
                        t('settings.adapters.dingtalkLocalStepPairDetail2'),
                        t('settings.adapters.dingtalkLocalStepPairDetail3'),
                      ]}
                    />
                  )}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.dingtalkSetupTroubleshooting')}
              </div>
              <div className="grid gap-1.5">
                <TipRow text={t('settings.adapters.dingtalkTroubleNoReply')} />
                <TipRow text={t('settings.adapters.dingtalkTroubleThinking')} />
                <TipRow text={t('settings.adapters.dingtalkTroubleRobotCode')} />
                <TipRow text={t('settings.adapters.dingtalkTroubleGroup')} />
                <TipRow text={t('settings.adapters.dingtalkTroubleMediaBoundary')} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function QqSetupGuide({
  onRestartAdapters,
  isRestartingAdapters,
}: {
  onRestartAdapters: () => void
  isRestartingAdapters: boolean
}) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border-y border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--color-surface-hover)]"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-brand)]">forum</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.adapters.qqSetupTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {t('settings.adapters.qqSetupSummary')}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
          {isOpen ? t('settings.adapters.feishuSetupCollapse') : t('settings.adapters.feishuSetupExpand')}
          <span className={`material-symbols-outlined text-[18px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-[var(--color-border)] px-3 py-3">
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <FeishuPlaceCard
              icon="web"
              title={t('settings.adapters.qqDevConsoleLabel')}
              description={t('settings.adapters.qqDevConsoleDesc')}
            />
            <FeishuPlaceCard
              icon="chat"
              title={t('settings.adapters.qqAppLabel')}
              description={t('settings.adapters.qqAppDesc')}
            />
          </div>
          <div className="space-y-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-[var(--color-text-primary)]">
                  {t('settings.adapters.qqSetupOfficialTitle')}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openExternalUrl(QQ_DEVELOPER_CONSOLE_URL)}
                  icon={<span className="material-symbols-outlined text-[16px]">open_in_new</span>}
                >
                  {t('settings.adapters.qqOpenDeveloperConsole')}
                </Button>
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.qqStepCreateBot')}
                  description={t('settings.adapters.qqStepCreateBotDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.qqStepCreateBotDetail1'),
                        t('settings.adapters.qqStepCreateBotDetail2'),
                        t('settings.adapters.qqStepCreateBotDetail3'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.qqStepCredentials')}
                  description={t('settings.adapters.qqStepCredentialsDesc')}
                  extra={(
                    <div className="mt-1 grid gap-1.5">
                      <PermissionRow scope="AppID" description={t('settings.adapters.qqAppIdDesc')} />
                      <PermissionRow scope="AppSecret" description={t('settings.adapters.qqAppSecretDesc')} />
                      <PermissionRow scope="Token" description={t('settings.adapters.qqTokenDesc')} optional />
                    </div>
                  )}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.qqStepSandbox')}
                  description={t('settings.adapters.qqStepSandboxDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.qqStepSandboxDetail1'),
                        t('settings.adapters.qqStepSandboxDetail2'),
                        t('settings.adapters.qqStepSandboxDetail3'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.qqStepIpWhitelist')}
                  description={t('settings.adapters.qqStepIpWhitelistDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.qqStepIpWhitelistDetail1'),
                        t('settings.adapters.qqStepIpWhitelistDetail2'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="5"
                  title={t('settings.adapters.qqStepRelease')}
                  description={t('settings.adapters.qqStepReleaseDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.qqStepReleaseDetail1'),
                        t('settings.adapters.qqStepReleaseDetail2'),
                      ]}
                    />
                  )}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.qqSetupLocalTitle')}
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.qqLocalStepChoosePath')}
                  description={t('settings.adapters.qqLocalStepChoosePathDesc')}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.qqLocalStepFill')}
                  description={t('settings.adapters.qqLocalStepFillDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.qqLocalStepFillDetail1'),
                        t('settings.adapters.qqLocalStepFillDetail2'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.qqLocalStepOneBot')}
                  description={t('settings.adapters.qqLocalStepOneBotDesc')}
                  extra={(
                    <div className="mt-1 grid gap-2">
                      <DetailList
                        items={[
                          t('settings.adapters.qqLocalStepOneBotDetail1'),
                          t('settings.adapters.qqLocalStepOneBotDetail2'),
                          t('settings.adapters.qqLocalStepOneBotDetail3'),
                        ]}
                      />
                      <PermissionRow scope="ws://127.0.0.1:3001" description={t('settings.adapters.qqOneBotUrlDesc')} />
                    </div>
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.qqLocalStepStart')}
                  description={t('settings.adapters.qqLocalStepStartDesc')}
                  action={(
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onRestartAdapters}
                      loading={isRestartingAdapters}
                      icon={<span className="material-symbols-outlined text-[16px]">play_circle</span>}
                    >
                      {t('settings.adapters.restartLocalAdapters')}
                    </Button>
                  )}
                />
                <SetupStep
                  number="5"
                  title={t('settings.adapters.qqLocalStepPair')}
                  description={t('settings.adapters.qqLocalStepPairDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.qqLocalStepPairDetail1'),
                        t('settings.adapters.qqLocalStepPairDetail2'),
                        t('settings.adapters.qqLocalStepPairDetail3'),
                      ]}
                    />
                  )}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.qqSetupTroubleshooting')}
              </div>
              <div className="grid gap-1.5">
                <TipRow text={t('settings.adapters.qqTroubleNoReply')} />
                <TipRow text={t('settings.adapters.qqTroubleSandbox')} />
                <TipRow text={t('settings.adapters.qqTroubleIpWhitelist')} />
                <TipRow text={t('settings.adapters.qqTroubleMedia')} />
                <TipRow text={t('settings.adapters.qqTroubleOneBot')} />
                <TipRow text={t('settings.adapters.qqTroubleProductBoundary')} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WecomSetupGuide({
  onRestartAdapters,
  isRestartingAdapters,
  callbackUrl,
}: {
  onRestartAdapters: () => void
  isRestartingAdapters: boolean
  callbackUrl: string
}) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const displayCallbackUrl = callbackUrl || 'https://your-domain.example/wecom/events'

  return (
    <div className="border-y border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--color-surface-hover)]"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-brand)]">admin_panel_settings</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.adapters.wecomSetupTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {t('settings.adapters.wecomSetupSummary')}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
          {isOpen ? t('settings.adapters.feishuSetupCollapse') : t('settings.adapters.feishuSetupExpand')}
          <span className={`material-symbols-outlined text-[18px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-[var(--color-border)] px-3 py-3">
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <FeishuPlaceCard
              icon="web"
              title={t('settings.adapters.wecomAdminConsoleLabel')}
              description={t('settings.adapters.wecomAdminConsoleDesc')}
            />
            <FeishuPlaceCard
              icon="chat"
              title={t('settings.adapters.wecomAppLabel')}
              description={t('settings.adapters.wecomAppDesc')}
            />
          </div>
          <div className="space-y-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-[var(--color-text-primary)]">
                  {t('settings.adapters.wecomSetupConsoleTitle')}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openExternalUrl(WECOM_ADMIN_CONSOLE_URL)}
                  icon={<span className="material-symbols-outlined text-[16px]">open_in_new</span>}
                >
                  {t('settings.adapters.wecomOpenAdminConsole')}
                </Button>
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.wecomStepCreateApp')}
                  description={t('settings.adapters.wecomStepCreateAppDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.wecomStepCreateAppDetail1'),
                        t('settings.adapters.wecomStepCreateAppDetail2'),
                        t('settings.adapters.wecomStepCreateAppDetail3'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.wecomStepCredentials')}
                  description={t('settings.adapters.wecomStepCredentialsDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.wecomStepCredentialsDetail1'),
                        t('settings.adapters.wecomStepCredentialsDetail2'),
                        t('settings.adapters.wecomStepCredentialsDetail3'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.wecomStepReceiveMessages')}
                  description={t('settings.adapters.wecomStepReceiveMessagesDesc')}
                  extra={(
                    <div className="mt-1 grid gap-2">
                      <DetailList
                        items={[
                          t('settings.adapters.wecomStepReceiveMessagesDetail1'),
                          t('settings.adapters.wecomStepReceiveMessagesDetail2'),
                          t('settings.adapters.wecomStepReceiveMessagesDetail3'),
                          t('settings.adapters.wecomStepReceiveMessagesDetail4'),
                        ]}
                      />
                      <div className="grid gap-1.5">
                        <PermissionRow scope={displayCallbackUrl} description={t('settings.adapters.wecomCallbackUrlDesc')} />
                        <PermissionRow scope="Token" description={t('settings.adapters.wecomTokenDesc')} />
                        <PermissionRow scope="EncodingAESKey" description={t('settings.adapters.wecomEncodingAesKeyDesc')} />
                      </div>
                    </div>
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.wecomStepPublish')}
                  description={t('settings.adapters.wecomStepPublishDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.wecomStepPublishDetail1'),
                        t('settings.adapters.wecomStepPublishDetail2'),
                      ]}
                    />
                  )}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.wecomSetupLocalTitle')}
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.wecomLocalStepFill')}
                  description={t('settings.adapters.wecomLocalStepFillDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.wecomLocalStepFillDetail1'),
                        t('settings.adapters.wecomLocalStepFillDetail2'),
                      ]}
                    />
                  )}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.wecomLocalStepTunnel')}
                  description={t('settings.adapters.wecomLocalStepTunnelDesc')}
                  extra={(
                    <div className="mt-1 grid gap-2">
                      <DetailList
                        items={[
                          t('settings.adapters.wecomLocalStepTunnelDetail1'),
                          t('settings.adapters.wecomLocalStepTunnelDetail2'),
                          t('settings.adapters.wecomLocalStepTunnelDetail3'),
                        ]}
                      />
                      <PermissionRow
                        scope="http://127.0.0.1:3478/wecom/events"
                        description={t('settings.adapters.wecomLocalCallbackDesc')}
                      />
                    </div>
                  )}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.wecomLocalStepStart')}
                  description={t('settings.adapters.wecomLocalStepStartDesc')}
                  action={(
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onRestartAdapters}
                      loading={isRestartingAdapters}
                      icon={<span className="material-symbols-outlined text-[16px]">play_circle</span>}
                    >
                      {t('settings.adapters.restartLocalAdapters')}
                    </Button>
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.wecomLocalStepPair')}
                  description={t('settings.adapters.wecomLocalStepPairDesc')}
                  extra={(
                    <DetailList
                      items={[
                        t('settings.adapters.wecomLocalStepPairDetail1'),
                        t('settings.adapters.wecomLocalStepPairDetail2'),
                        t('settings.adapters.wecomLocalStepPairDetail3'),
                      ]}
                    />
                  )}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.wecomSetupTroubleshooting')}
              </div>
              <div className="grid gap-1.5">
                <TipRow text={t('settings.adapters.wecomTroubleNoVerify')} />
                <TipRow text={t('settings.adapters.wecomTroubleNoReply')} />
                <TipRow text={t('settings.adapters.wecomTroublePort')} />
                <TipRow text={t('settings.adapters.wecomWebhookUnsupported')} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FeishuSetupGuide({
  onRestartAdapters,
  isRestartingAdapters,
}: {
  onRestartAdapters: () => void
  isRestartingAdapters: boolean
}) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const requiredPermissions = [
    {
      scope: 'im:message.p2p_msg:readonly',
      description: t('settings.adapters.feishuPermissionP2p'),
    },
    {
      scope: 'im:message:send_as_bot',
      description: t('settings.adapters.feishuPermissionSend'),
    },
  ]
  const optionalPermissions = [
    {
      scope: 'im:message:update',
      description: t('settings.adapters.feishuPermissionUpdate'),
    },
    {
      scope: 'im:resource',
      description: t('settings.adapters.feishuPermissionResource'),
    },
  ]

  return (
    <div className="border-y border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--color-surface-hover)]"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-brand)]">fact_check</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.adapters.feishuSetupTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {t('settings.adapters.feishuSetupSummary')}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
          {isOpen ? t('settings.adapters.feishuSetupCollapse') : t('settings.adapters.feishuSetupExpand')}
          <span className={`material-symbols-outlined text-[18px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-[var(--color-border)] px-3 py-3">
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <FeishuPlaceCard
              icon="web"
              title={t('settings.adapters.feishuDevConsoleLabel')}
              description={t('settings.adapters.feishuDevConsoleDesc')}
            />
            <FeishuPlaceCard
              icon="chat"
              title={t('settings.adapters.feishuAppLabel')}
              description={t('settings.adapters.feishuAppDesc')}
            />
          </div>
          <div className="space-y-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-[var(--color-text-primary)]">
                  {t('settings.adapters.feishuSetupConsoleTitle')}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openExternalUrl(FEISHU_DEVELOPER_CONSOLE_URL)}
                  icon={<span className="material-symbols-outlined text-[16px]">open_in_new</span>}
                >
                  {t('settings.adapters.feishuOpenDeveloperConsole')}
                </Button>
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.feishuSetupCredentials')}
                  description={t('settings.adapters.feishuSetupCredentialsDesc')}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.feishuSetupBotAbility')}
                  description={t('settings.adapters.feishuSetupBotAbilityDesc')}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.feishuSetupEvents')}
                  description={t('settings.adapters.feishuSetupEventsDesc')}
                  extra={(
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <CodePill>im.message.receive_v1</CodePill>
                      <CodePill>card.action.trigger</CodePill>
                    </div>
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.feishuSetupPermissions')}
                  description={t('settings.adapters.feishuSetupPermissionsDesc')}
                  extra={(
                    <div className="mt-1 grid gap-1.5">
                      {requiredPermissions.map((item) => (
                        <PermissionRow key={item.scope} scope={item.scope} description={item.description} />
                      ))}
                      {optionalPermissions.map((item) => (
                        <PermissionRow key={item.scope} scope={item.scope} description={item.description} optional />
                      ))}
                    </div>
                  )}
                />
                <SetupStep
                  number="5"
                  title={t('settings.adapters.feishuSetupPublish')}
                  description={t('settings.adapters.feishuSetupPublishDesc')}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.feishuSetupLocalTitle')}
              </div>
              <div className="grid gap-2">
                <SetupStep
                  number="1"
                  title={t('settings.adapters.feishuLocalStepCredentials')}
                  description={t('settings.adapters.feishuLocalStepCredentialsDesc')}
                />
                <SetupStep
                  number="2"
                  title={t('settings.adapters.feishuLocalStepSave')}
                  description={t('settings.adapters.feishuLocalStepSaveDesc')}
                />
                <SetupStep
                  number="3"
                  title={t('settings.adapters.feishuLocalStepStart')}
                  description={t('settings.adapters.feishuLocalStepStartDesc')}
                  action={(
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onRestartAdapters}
                      loading={isRestartingAdapters}
                      icon={<span className="material-symbols-outlined text-[16px]">play_circle</span>}
                    >
                      {t('settings.adapters.restartLocalAdapters')}
                    </Button>
                  )}
                />
                <SetupStep
                  number="4"
                  title={t('settings.adapters.feishuLocalStepPair')}
                  description={t('settings.adapters.feishuLocalStepPairDesc')}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.adapters.feishuSetupTroubleshooting')}
              </div>
              <div className="grid gap-1.5">
                <TipRow text={t('settings.adapters.feishuTroubleNoReply')} />
                <TipRow text={t('settings.adapters.feishuTroubleThinking')} />
                <TipRow text={t('settings.adapters.feishuTroublePairing')} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FeishuPlaceCard({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <span className="material-symbols-outlined mt-0.5 text-[16px] text-[var(--color-brand)]">{icon}</span>
      <div>
        <div className="text-xs font-medium text-[var(--color-text-primary)]">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{description}</div>
      </div>
    </div>
  )
}

function SetupStep({
  number,
  title,
  description,
  action,
  extra,
}: {
  number: string
  title: string
  description: string
  action?: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[22px_1fr] gap-2">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] font-semibold text-[var(--color-text-secondary)]">
        {number}
      </span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--color-text-primary)]">{title}</span>
          {action}
        </div>
        <p>{description}</p>
        {extra}
      </div>
    </div>
  )
}

function TipRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="material-symbols-outlined mt-[1px] text-[15px] text-[var(--color-text-tertiary)]">help</span>
      <span>{text}</span>
    </div>
  )
}

function DetailList({ items }: { items: string[] }) {
  return (
    <ol className="mt-1 grid gap-1">
      {items.map((item, index) => (
        <li key={item} className="grid grid-cols-[18px_1fr] gap-1.5">
          <span className="mt-[1px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--color-surface)] text-[10px] font-semibold text-[var(--color-text-tertiary)]">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

function PermissionRow({
  scope,
  description,
  optional = false,
}: {
  scope: string
  description: string
  optional?: boolean
}) {
  const t = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <CodePill>{scope}</CodePill>
      {optional && (
        <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
          {t('settings.adapters.optional')}
        </span>
      )}
      <span>{description}</span>
    </div>
  )
}

function CodePill({ children }: { children: string }) {
  return (
    <code className="break-all rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)]">
      {children}
    </code>
  )
}

function ChannelDiagnostic({
  channel,
}: {
  channel: AdapterDiagnostics['channels'][number]
}) {
  const t = useTranslation()
  const tone = channel.status === 'ready'
    ? 'text-[var(--color-success)]'
    : channel.status === 'needs_credentials'
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-text-tertiary)]'
  const missing = channel.missingCredentials.length > 0
    ? channel.missingCredentials.join(', ')
    : t('settings.adapters.diagnostics.noneMissing')

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          {t(`settings.adapters.platform.${channel.platform}`)}
        </span>
        <span className={`text-xs font-medium ${tone}`}>
          {t(`settings.adapters.diagnostics.status.${channel.status}`)}
        </span>
      </div>
      <div className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {t('settings.adapters.diagnostics.channelDetail', {
          allowed: channel.allowedUsersCount,
          paired: channel.pairedUsersCount,
          missing,
        })}
      </div>
    </div>
  )
}

function ImTabButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset ${
        active
          ? 'text-[var(--color-text-primary)] font-semibold after:absolute after:left-3 after:right-3 after:bottom-0 after:h-[2px] after:bg-[var(--color-brand)]'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {label}
    </button>
  )
}
