import { useState, useEffect, useCallback } from 'react'
import { useAdapterStore } from '../stores/adapterStore'
import { useTranslation } from '../i18n'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { adaptersApi } from '../api/adapters'
import type { AdapterDiagnostics, AdapterPlatform } from '../types/adapter'

type ImTab = AdapterPlatform

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function parseTelegramAllowedUsers(value: string): number[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
}

function parseStringAllowedUsers(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function AdapterSettings() {
  const t = useTranslation()
  const { config, isLoading, fetchConfig, updateConfig, generatePairingCode, removePairedUser } = useAdapterStore()

  // Active IM tab —— Feishu 默认展示，在前
  const [activeIm, setActiveIm] = useState<ImTab>('feishu')

  // Server —— serverUrl 不再暴露在 UI 里（见下方 Server URL 注释），
  // 桌面端用 Tauri env var 注入动态端口。
  const [defaultProjectDir, setDefaultProjectDir] = useState('')

  // Telegram
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgAllowedUsers, setTgAllowedUsers] = useState('')

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
    setTgBotToken(config.telegram?.botToken ?? '')
    setTgAllowedUsers(config.telegram?.allowedUsers?.join(', ') ?? '')
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
      const tgUsers = parseTelegramAllowedUsers(tgAllowedUsers)

      patch.telegram = {
        botToken: tgBotToken.trim(),
        allowedUsers: tgUsers.length ? tgUsers : [],
      }

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

  // Collect all paired users across platforms
  const allPairedUsers = [
    ...(config.telegram?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'telegram' as const })),
    ...(config.feishu?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'feishu' as const })),
    ...(config.dingtalk?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'dingtalk' as const })),
    ...(config.wecom?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'wecom' as const })),
    ...(config.qq?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'qq' as const })),
  ]
  const tgAllowedCount = parseTelegramAllowedUsers(tgAllowedUsers).length
  const fsAllowedCount = parseStringAllowedUsers(fsAllowedUsers).length
  const dtAllowedCount = parseStringAllowedUsers(dtAllowedUsers).length
  const wcAllowedCount = parseStringAllowedUsers(wcAllowedUsers).length
  const qqAllowedCount = parseStringAllowedUsers(qqAllowedUsers).length
  const totalAllowedCount = tgAllowedCount + fsAllowedCount + dtAllowedCount + wcAllowedCount + qqAllowedCount
  const telegramCredentialsReady = hasText(tgBotToken)
  const feishuCredentialsReady = hasText(fsAppId) && hasText(fsAppSecret)
  const dingtalkCredentialsReady = (hasText(dtClientId) && hasText(dtClientSecret)) || hasText(dtWebhookUrl)
  const wecomCredentialsReady = (hasText(wcCorpId) && hasText(wcAgentId) && hasText(wcSecret)) || hasText(wcWebhookUrl)
  const qqCredentialsReady = (hasText(qqAppId) && hasText(qqToken)) || hasText(qqOneBotUrl)
  const activeChannelCount = Number(telegramCredentialsReady)
    + Number(feishuCredentialsReady)
    + Number(dingtalkCredentialsReady)
    + Number(wecomCredentialsReady)
    + Number(qqCredentialsReady)

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
          <Button variant="secondary" size="sm" onClick={handleCheckConfig} loading={isChecking}>
            {t('settings.adapters.checkConfig')}
          </Button>
        </div>
        {checkError && (
          <div className="mb-3 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
            {checkError}
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
              {diagnostics.channels.map((channel) => (
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

      {/* IM Adapter Tabs —— Feishu 默认在前，Telegram 在后 */}
      <section className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div role="tablist" aria-label="IM adapter" className="flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]">
          <ImTabButton
            label={t('settings.adapters.feishu')}
            active={activeIm === 'feishu'}
            onClick={() => setActiveIm('feishu')}
          />
          <ImTabButton
            label={t('settings.adapters.telegram')}
            active={activeIm === 'telegram'}
            onClick={() => setActiveIm('telegram')}
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

        {activeIm === 'telegram' && (
          <div className="p-4 space-y-4">
            <AdapterStatusNotice
              ready={telegramCredentialsReady}
              title={t(telegramCredentialsReady
                ? 'settings.adapters.telegramCredentialsReady'
                : 'settings.adapters.telegramCredentialsMissing')}
              description={t('settings.adapters.telegramStatusDesc')}
            />
            <Input
              label={t('settings.adapters.botToken')}
              type="password"
              value={tgBotToken}
              onChange={(e) => setTgBotToken(e.target.value)}
              placeholder={t('settings.adapters.botTokenPlaceholder')}
            />
            <div className="flex flex-col gap-1">
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={tgAllowedUsers}
                onChange={(e) => setTgAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.tgAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
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
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('settings.adapters.webhookUrl')}
                type="password"
                value={dtWebhookUrl}
                onChange={(e) => setDtWebhookUrl(e.target.value)}
                placeholder={t('settings.adapters.webhookUrlPlaceholder')}
              />
              <Input
                label={t('settings.adapters.webhookSecret')}
                type="password"
                value={dtWebhookSecret}
                onChange={(e) => setDtWebhookSecret(e.target.value)}
                placeholder={t('settings.adapters.webhookSecretPlaceholder')}
              />
            </div>
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
            <div className="grid grid-cols-3 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
              label={t('settings.adapters.webhookUrl')}
              type="password"
              value={wcWebhookUrl}
              onChange={(e) => setWcWebhookUrl(e.target.value)}
              placeholder={t('settings.adapters.webhookUrlPlaceholder')}
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
            <div className="grid grid-cols-3 gap-4">
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
                placeholder={t('settings.adapters.appSecretPlaceholder')}
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
            <div className="grid grid-cols-2 gap-4">
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
