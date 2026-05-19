import { useState, useEffect, useMemo, useRef, type FormEvent, type ReactNode } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useTranslation, type TranslationKey } from '../i18n'
import { Modal } from '../components/shared/Modal'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { Dropdown } from '../components/shared/Dropdown'
import type { PermissionMode, EffortLevel, ThemeMode } from '../types/settings'
import type { Locale } from '../i18n'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'
import { AdapterSettings } from './AdapterSettings'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AgentDefinition, AgentSource } from '../api/agents'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useSkillStore } from '../stores/skillStore'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { McpSettings } from './McpSettings'
import { TerminalSettings } from './TerminalSettings'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { useUpdateStore } from '../stores/updateStore'
import { formatBytes } from '../lib/formatBytes'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { attachmentParserApi } from '../api/attachmentParser'
import type { AttachmentParserConfig, AttachmentParserTestResult } from '../types/attachmentParser'
import { ConfigBackupSettings } from './ConfigBackupSettings'
import { useBillingStore } from '../stores/billingStore'
import type { BillingStatus } from '../types/billing'

const HIDDEN_PROVIDER_PRESET_IDS = new Set(['official', 'chatgpt'])

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    setActiveTab(pendingSettingsTab)
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex-1 flex overflow-hidden">
        {/* Tab navigation */}
        <div className="w-[180px] border-r border-[var(--color-border)] py-3 flex-shrink-0 flex flex-col">
          <div className="flex-1">
            <TabButton icon="dns" label={t('settings.tab.providers')} active={activeTab === 'providers'} onClick={() => setActiveTab('providers')} />
            <TabButton icon="document_scanner" label={t('settings.tab.attachmentParser')} active={activeTab === 'attachmentParser'} onClick={() => setActiveTab('attachmentParser')} />
            <TabButton icon="ios_share" label={t('settings.tab.configBackup')} active={activeTab === 'configBackup'} onClick={() => setActiveTab('configBackup')} />
            <TabButton icon="shield" label={t('settings.tab.permissions')} active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
            <TabButton icon="tune" label={t('settings.tab.general')} active={activeTab === 'general'} onClick={() => setActiveTab('general')} />
            <TabButton icon="chat" label={t('settings.tab.adapters')} active={activeTab === 'adapters'} onClick={() => setActiveTab('adapters')} />
            <TabButton icon="terminal" label={t('settings.tab.terminal')} active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} />
            <TabButton icon="dns" label={t('settings.tab.mcp')} active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} />
            <TabButton icon="smart_toy" label={t('settings.tab.agents')} active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
            <TabButton icon="auto_awesome" label={t('settings.tab.skills')} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
            <TabButton icon="extension" label={t('settings.tab.plugins')} active={activeTab === 'plugins'} onClick={() => setActiveTab('plugins')} />
            <TabButton icon="mouse" label={t('settings.tab.computerUse')} active={activeTab === 'computerUse'} onClick={() => setActiveTab('computerUse')} />
          </div>
          <div className="border-t border-[var(--color-border)]/40 pt-1">
            <TabButton icon="workspace_premium" label={t('settings.tab.billing')} active={activeTab === 'billing'} onClick={() => setActiveTab('billing')} />
            <TabButton icon="info" label={t('settings.tab.about')} active={activeTab === 'about'} onClick={() => setActiveTab('about')} />
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'attachmentParser' && <AttachmentParserSettings />}
          {activeTab === 'configBackup' && <ConfigBackupSettings />}
          {activeTab === 'permissions' && <PermissionSettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'adapters' && <AdapterSettings />}
          {activeTab === 'terminal' && <TerminalSettings />}
          {activeTab === 'mcp' && <McpSettings />}
          {activeTab === 'agents' && <AgentsSettings />}
          {activeTab === 'skills' && <SkillSettings />}
          {activeTab === 'plugins' && <PluginSettings />}
          {activeTab === 'computerUse' && <ComputerUseSettings />}
          {activeTab === 'billing' && <BillingSettings />}
          {activeTab === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  )
}

// ─── Provider Settings ──────────────────────────────────────

type AttachmentParserFormState = {
  enabled: boolean
  mode: 'managed' | 'custom'
  apiKey: string
  baseUrl: string
  visionModel: string
  ocrModel: string
  summarizeModel: string
}

const DEFAULT_ATTACHMENT_PARSER_FORM: AttachmentParserFormState = {
  enabled: true,
  mode: 'managed',
  apiKey: '',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  visionModel: 'glm-5v-turbo',
  ocrModel: 'glm-ocr',
  summarizeModel: 'glm-5.1',
}

function AttachmentParserSettings() {
  const t = useTranslation()
  const [config, setConfig] = useState<AttachmentParserConfig | null>(null)
  const [form, setForm] = useState<AttachmentParserFormState>(DEFAULT_ATTACHMENT_PARSER_FORM)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testResult, setTestResult] = useState<AttachmentParserTestResult | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    attachmentParserApi.getConfig()
      .then(({ config }) => {
        if (cancelled) return
        setConfig(config)
        setForm({
          enabled: config.enabled,
          mode: config.mode ?? 'managed',
          apiKey: '',
          baseUrl: config.baseUrl,
          visionModel: config.visionModel,
          ocrModel: config.ocrModel,
          summarizeModel: config.summarizeModel,
        })
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updateForm = <K extends keyof AttachmentParserFormState>(
    key: K,
    value: AttachmentParserFormState[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
    setMessage(null)
    setTestResult(null)
  }

  const buildPayload = () => ({
    enabled: form.enabled,
    mode: form.mode,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    ...(!config?.hasApiKey && !form.apiKey.trim() ? { apiKey: '' } : {}),
    baseUrl: form.baseUrl.trim(),
    visionModel: form.visionModel.trim(),
    ocrModel: form.ocrModel.trim(),
    summarizeModel: form.summarizeModel.trim(),
  })

  const handleSave = async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      const { config: next } = await attachmentParserApi.updateConfig(buildPayload())
      setConfig(next)
      setForm({
        enabled: next.enabled,
        mode: next.mode ?? 'managed',
        apiKey: '',
        baseUrl: next.baseUrl,
        visionModel: next.visionModel,
        ocrModel: next.ocrModel,
        summarizeModel: next.summarizeModel,
      })
      setMessage({ type: 'success', text: t('settings.attachmentParser.saved') })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    setMessage(null)
    setTestResult(null)
    try {
      const { result } = await attachmentParserApi.test(buildPayload())
      setTestResult(result)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.attachmentParser.title')}</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-tertiary)]">{t('settings.attachmentParser.description')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          onClick={() => updateForm('enabled', !form.enabled)}
          disabled={isLoading}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors disabled:opacity-50 ${
            form.enabled ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-surface-container-high)]'
          }`}
        >
          <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
            form.enabled ? 'translate-x-7' : 'translate-x-1'
          }`} />
        </button>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.attachmentParser.mode')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['managed', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateForm('mode', mode)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      form.mode === mode
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-text-primary)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)]'
                    }`}
                  >
                    <div className="font-medium">
                      {mode === 'managed' ? t('settings.attachmentParser.modeManaged') : t('settings.attachmentParser.modeCustom')}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      {mode === 'managed' ? t('settings.attachmentParser.modeManagedDesc') : t('settings.attachmentParser.modeCustomDesc')}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {form.mode === 'custom' && (
              <>
                <Input
                  label={t('settings.attachmentParser.apiKey')}
                  type="password"
                  value={form.apiKey}
                  placeholder={config?.hasApiKey ? config.apiKey : t('settings.attachmentParser.apiKeyPlaceholder')}
                  onChange={(event) => updateForm('apiKey', event.target.value)}
                />
                <Input
                  label={t('settings.attachmentParser.baseUrl')}
                  value={form.baseUrl}
                  onChange={(event) => updateForm('baseUrl', event.target.value)}
                />
              </>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input
                label={t('settings.attachmentParser.visionModel')}
                value={form.visionModel}
                onChange={(event) => updateForm('visionModel', event.target.value)}
              />
              <Input
                label={t('settings.attachmentParser.ocrModel')}
                value={form.ocrModel}
                onChange={(event) => updateForm('ocrModel', event.target.value)}
              />
              <Input
                label={t('settings.attachmentParser.summarizeModel')}
                value={form.summarizeModel}
                onChange={(event) => updateForm('summarizeModel', event.target.value)}
              />
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {t('settings.attachmentParser.strategy')}
            </div>

            {testResult && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${
                testResult.success
                  ? 'border-[var(--color-success)]/30 text-[var(--color-success)]'
                  : 'border-[var(--color-error)]/30 text-[var(--color-error)]'
              }`}>
                {testResult.success
                  ? t('settings.attachmentParser.testOk', { latency: String(testResult.latencyMs) })
                  : testResult.error || t('settings.attachmentParser.testFailed')}
                <span className="ml-2 text-[var(--color-text-tertiary)]">{testResult.modelUsed}</span>
              </div>
            )}

            {message && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${
                message.type === 'success'
                  ? 'border-[var(--color-success)]/30 text-[var(--color-success)]'
                  : 'border-[var(--color-error)]/30 text-[var(--color-error)]'
              }`}>
                {message.text}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleTest} loading={isTesting}>
                {t('settings.attachmentParser.test')}
              </Button>
              <Button onClick={handleSave} loading={isSaving}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProviderSettings() {
  const {
    providers,
    activeId,
    presets,
    isLoading,
    isPresetsLoading,
    fetchProviders,
    fetchPresets,
    deleteProvider,
    activateProvider,
    testProvider,
  } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<SavedProvider | null>(null)
  const [isDeletingProvider, setIsDeletingProvider] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => {
    void fetchProviders()
    void fetchPresets()
  }, [fetchPresets, fetchProviders])

  const presetMap = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
  )
  const visibleProviders = useMemo(
    () => providers.filter((provider) => !isChatGPTProvider(provider)),
    [providers],
  )

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    setPendingDeleteProvider(provider)
  }

  const confirmDelete = async () => {
    if (!pendingDeleteProvider) return
    setIsDeletingProvider(true)
    try {
      await deleteProvider(pendingDeleteProvider.id)
      setPendingDeleteProvider(null)
    } catch (error) {
      console.error(error)
    } finally {
      setIsDeletingProvider(false)
    }
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.providers.title')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">{t('settings.providers.description')}</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateModal(true)} disabled={isPresetsLoading || presets.length === 0}>
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('settings.providers.addProvider')}
        </Button>
      </div>

      {/* Saved providers */}
      {isLoading && providers.length === 0 ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleProviders.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = presetMap.get(provider.presetId)
            const categoryLabel = formatPresetCategoryLabel(preset, t)
            const routingSummary = formatProviderRoutingSummary(preset, provider.models, t)
            return (
              <div
                key={provider.id}
                onClick={() => {
                  if (!isActive) void handleActivate(provider.id)
                }}
                className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all group ${
                  isActive
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface-container)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] cursor-pointer'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{provider.name}</span>
                    {preset && preset.id !== 'custom' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">{preset.name}</span>
                    )}
                    {categoryLabel && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">{categoryLabel}</span>
                    )}
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-warning)] leading-none">
                      {formatPresetProtocolLabel(preset, provider.apiFormat, t)}
                    </span>
                    {isActive && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded border border-[var(--color-brand)]/18 bg-[var(--color-brand)]/14 text-[var(--color-brand)] leading-none">{t('settings.providers.default')}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
                    {provider.baseUrl} &middot; {provider.models.main}
                  </div>
                  {routingSummary && (
                    <div className="text-[11px] text-[var(--color-text-tertiary)] truncate mt-0.5">
                      {routingSummary}
                    </div>
                  )}
                  {test && !test.loading && test.result && (
                    <div className="text-xs mt-1 flex flex-col gap-0.5">
                      <span className={test.result.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                        {test.result.connectivity.success
                          ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                          : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error || '' })}
                      </span>
                      {test.result.proxy && (
                        <span className={test.result.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                          {test.result.proxy.success
                            ? t('settings.providers.proxyOk', { latency: String(test.result.proxy.latencyMs) })
                            : t('settings.providers.proxyFailed', { error: test.result.proxy.error || '' })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(provider.id)}>{t('settings.providers.setDefault')}</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>{t('settings.providers.test')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)}>{t('settings.providers.edit')}</Button>
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">{t('common.delete')}</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {showCreateModal && (
        <ProviderFormModal open={true} onClose={() => setShowCreateModal(false)} mode="create" presets={presets} />
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} presets={presets} />
      )}

      <ConfirmDialog
        open={pendingDeleteProvider !== null}
        onClose={() => {
          if (isDeletingProvider) return
          setPendingDeleteProvider(null)
        }}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteProvider ? t('settings.providers.confirmDelete', { name: pendingDeleteProvider.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isDeletingProvider}
      />
    </div>
  )
}

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
  presets: ProviderPreset[]
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
}

function buildFallbackPreset(provider?: SavedProvider): ProviderPreset {
  return {
    id: provider?.presetId ?? 'custom',
    name: provider?.name ?? 'Custom',
    baseUrl: provider?.baseUrl ?? '',
    apiFormat: provider?.apiFormat ?? 'anthropic',
    defaultModels: provider?.models ?? { main: '', haiku: '', sonnet: '', opus: '' },
    needsApiKey: provider?.authKind === 'chatgpt_oauth' || provider?.authKind === 'gugu_managed' ? false : true,
    websiteUrl: '',
  }
}

function isChatGPTProvider(provider: SavedProvider): boolean {
  return provider.authKind === 'chatgpt_oauth' ||
    provider.apiFormat === 'chatgpt_codex' ||
    provider.presetId === 'chatgpt'
}

function isGuguManagedApi(apiFormat: ApiFormat): boolean {
  return apiFormat === 'gugu_managed'
}

function getProviderAuthKind(apiFormat: ApiFormat) {
  if (apiFormat === 'chatgpt_codex') return 'chatgpt_oauth'
  if (apiFormat === 'gugu_managed') return 'gugu_managed'
  return 'api_key'
}

function formatApiFormatLabel(apiFormat: ApiFormat, t: ReturnType<typeof useTranslation>): string {
  if (apiFormat === 'openai_chat') return t('settings.providers.apiFormatOpenaiChat')
  if (apiFormat === 'openai_responses') return t('settings.providers.apiFormatOpenaiResponses')
  if (apiFormat === 'chatgpt_codex') return t('settings.providers.apiFormatChatgptCodex')
  if (apiFormat === 'gugu_managed') return t('settings.providers.apiFormatGuguManaged')
  return t('settings.providers.apiFormatAnthropic')
}

function inferPresetProtocol(preset: ProviderPreset | undefined, apiFormat: ApiFormat): NonNullable<ProviderPreset['protocol']> {
  if (preset?.protocol) return preset.protocol
  if (apiFormat === 'openai_chat') return 'openai_chat_proxy'
  if (apiFormat === 'openai_responses') return 'openai_responses_proxy'
  if (apiFormat === 'chatgpt_codex') return 'chatgpt_codex'
  if (apiFormat === 'gugu_managed') return 'gugu_managed'
  return preset?.id === 'official' ? 'anthropic_native' : 'anthropic_compatible'
}

function formatPresetCategoryLabel(preset: ProviderPreset | undefined, t: ReturnType<typeof useTranslation>): string | null {
  switch (preset?.category) {
    case 'official':
      return t('settings.providers.categoryOfficial')
    case 'domestic':
      return t('settings.providers.categoryDomestic')
    case 'domestic-coding':
      return t('settings.providers.categoryDomesticCoding')
    case 'aggregator':
      return t('settings.providers.categoryAggregator')
    case 'local':
      return t('settings.providers.categoryLocal')
    case 'custom':
      return t('settings.providers.categoryCustom')
    default:
      return null
  }
}

function formatPresetProtocolLabel(
  preset: ProviderPreset | undefined,
  apiFormat: ApiFormat,
  t: ReturnType<typeof useTranslation>,
): string {
  switch (inferPresetProtocol(preset, apiFormat)) {
    case 'anthropic_native':
      return t('settings.providers.protocolAnthropicNative')
    case 'anthropic_compatible':
      return t('settings.providers.protocolAnthropicCompatible')
    case 'openai_chat_proxy':
      return t('settings.providers.protocolOpenaiChatProxy')
    case 'openai_responses_proxy':
      return t('settings.providers.protocolOpenaiResponsesProxy')
    case 'chatgpt_codex':
      return t('settings.providers.protocolChatgptCodex')
    case 'gugu_managed':
      return t('settings.providers.protocolGuguManaged')
  }
}

function formatPresetAgentLabel(preset: ProviderPreset | undefined, apiFormat: ApiFormat, t: ReturnType<typeof useTranslation>): string {
  if (preset?.agentCompatible === false) return t('settings.providers.agentNotReady')
  if (apiFormat === 'openai_chat' || apiFormat === 'openai_responses') return t('settings.providers.agentReadyViaProxy')
  if (apiFormat === 'chatgpt_codex') return t('settings.providers.agentReadyViaCodex')
  if (apiFormat === 'gugu_managed') return t('settings.providers.agentReadyViaGugu')
  return t('settings.providers.agentReady')
}

function getModelRoleLabel(role: NonNullable<ProviderPreset['routingHint']>['fast'], t: ReturnType<typeof useTranslation>): string {
  if (role === 'haiku') return t('settings.providers.haikuModel')
  if (role === 'sonnet') return t('settings.providers.sonnetModel')
  if (role === 'opus') return t('settings.providers.opusModel')
  return t('settings.providers.mainModel')
}

function getModelByRole(models: ModelMapping, role: NonNullable<ProviderPreset['routingHint']>['fast']): string {
  if (role === 'haiku') return models.haiku || models.main
  if (role === 'sonnet') return models.sonnet || models.main
  if (role === 'opus') return models.opus || models.sonnet || models.main
  return models.main
}

function formatProviderRoutingSummary(
  preset: ProviderPreset | undefined,
  models: ModelMapping,
  t: ReturnType<typeof useTranslation>,
): string | null {
  const hint = preset?.routingHint ?? { fast: 'haiku' as const, balanced: 'main' as const, pro: 'opus' as const }
  const fastModel = hint.fast ? getModelByRole(models, hint.fast) : ''
  const balancedModel = hint.balanced ? getModelByRole(models, hint.balanced) : ''
  const proModel = hint.pro ? getModelByRole(models, hint.pro) : ''
  const segments = [
    fastModel ? t('settings.providers.routingFast', { model: fastModel }) : '',
    balancedModel ? t('settings.providers.routingBalanced', { model: balancedModel }) : '',
    proModel ? t('settings.providers.routingPro', { model: proModel }) : '',
  ].filter(Boolean)
  return segments.length > 0 ? segments.join(' · ') : null
}

function formatProviderRoutingRoleSummary(
  preset: ProviderPreset | undefined,
  t: ReturnType<typeof useTranslation>,
): string | null {
  if (!preset?.routingHint) return null
  const segments = [
    preset.routingHint.fast
      ? t('settings.providers.routingFast', { model: getModelRoleLabel(preset.routingHint.fast, t) })
      : '',
    preset.routingHint.balanced
      ? t('settings.providers.routingBalanced', { model: getModelRoleLabel(preset.routingHint.balanced, t) })
      : '',
    preset.routingHint.pro
      ? t('settings.providers.routingPro', { model: getModelRoleLabel(preset.routingHint.pro, t) })
      : '',
  ].filter(Boolean)
  return segments.length > 0 ? segments.join(' · ') : null
}

type BaseUrlNotice = {
  tone: 'neutral' | 'warning'
  text: string
}

function formatEndpointPreview(baseUrl: string, apiFormat: ApiFormat): string | null {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return null
  const isVersionedBase = /\/v\d+$/i.test(base)
  if (apiFormat === 'openai_chat') {
    return `${base}${isVersionedBase ? '' : '/v1'}/chat/completions`
  }
  if (apiFormat === 'openai_responses') {
    return `${base}${isVersionedBase ? '' : '/v1'}/responses`
  }
  if (apiFormat === 'anthropic') {
    return `${base}/v1/messages`
  }
  if (apiFormat === 'gugu_managed') {
    return 'http://127.0.0.1:3456/proxy/gugu-managed/v1/messages'
  }
  return null
}

function getBaseUrlNotice(baseUrl: string, apiFormat: ApiFormat, t: ReturnType<typeof useTranslation>): BaseUrlNotice | null {
  const normalized = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized || apiFormat === 'chatgpt_codex' || apiFormat === 'gugu_managed') return null

  if (apiFormat === 'openai_chat' && normalized.endsWith('/chat/completions')) {
    return { tone: 'warning', text: t('settings.providers.baseUrlWarnFullOpenaiChat') }
  }
  if (apiFormat === 'openai_responses' && normalized.endsWith('/responses')) {
    return { tone: 'warning', text: t('settings.providers.baseUrlWarnFullOpenaiResponses') }
  }
  if (apiFormat === 'anthropic' && normalized.endsWith('/v1/messages')) {
    return { tone: 'warning', text: t('settings.providers.baseUrlWarnFullAnthropic') }
  }

  const preview = formatEndpointPreview(baseUrl, apiFormat)
  if (!preview) return null
  return { tone: 'neutral', text: t('settings.providers.baseUrlResolvedEndpoint', { endpoint: preview }) }
}

function openExternalUrl(url: string) {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  void import('@tauri-apps/plugin-shell')
    .then((mod) => mod.open(url))
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}

const API_KEY_JSON_PLACEHOLDER = '••••••••'
const API_KEY_JSON_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

function maskSettingsJsonSecrets(raw: string, apiKey: string): string {
  if (!apiKey.trim()) return raw
  try {
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> }
    if (!parsed.env || typeof parsed.env !== 'object') return raw
    let changed = false
    for (const key of API_KEY_JSON_KEYS) {
      if (parsed.env[key] === apiKey) {
        parsed.env[key] = API_KEY_JSON_PLACEHOLDER
        changed = true
      }
    }
    return changed ? JSON.stringify(parsed, null, 2) : raw
  } catch {
    return raw
  }
}

function restoreSettingsJsonSecrets<T>(settings: T, apiKey: string): T {
  if (!apiKey.trim() || !settings || typeof settings !== 'object') return settings
  const parsed = settings as { env?: Record<string, unknown> }
  if (!parsed.env || typeof parsed.env !== 'object') return settings
  for (const key of API_KEY_JSON_KEYS) {
    if (parsed.env[key] === API_KEY_JSON_PLACEHOLDER) {
      parsed.env[key] = apiKey
    }
  }
  return settings
}

function ProviderFormModal({ open, onClose, mode, provider, presets }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = presets.filter((p) => !HIDDEN_PROVIDER_PRESET_IDS.has(p.id))
  const regularPresets = availablePresets.filter((p) => !p.featured)
  const featuredPresets = availablePresets.filter((p) => p.featured)
  const presetDefaultEnvKeys = useMemo(
    () => new Set(presets.flatMap((preset) => Object.keys(preset.defaultEnv ?? {}))),
    [presets],
  )
  const fallbackPreset = provider
    ? buildFallbackPreset(provider)
    : requirePreset(availablePresets[availablePresets.length - 1])
  const initialPreset = requirePreset(
    provider
      ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
      : availablePresets[0] ?? fallbackPreset,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? initialPreset.apiFormat ?? 'anthropic')
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const jsonPastedRef = useRef(false)

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    // Skip if JSON was just populated by user paste
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    import('../api/providers').then(({ providersApi }) => {
      providersApi.getSettings().then((settings) => {
        const needsProxy = apiFormat !== 'anthropic'
        const proxyPath = apiFormat === 'gugu_managed' ? '/proxy/gugu-managed' : '/proxy'
        const existingEnv = (settings.env as Record<string, string>) || {}
        const cleanedEnv = Object.fromEntries(
          Object.entries(existingEnv).filter(([key]) => !presetDefaultEnvKeys.has(key)),
        )
        const merged = {
          ...settings,
          skipWebFetchPreflight: settings.skipWebFetchPreflight ?? true,
          env: {
            ...cleanedEnv,
            ...(selectedPreset.defaultEnv ?? {}),
            ANTHROPIC_BASE_URL: needsProxy ? `http://127.0.0.1:3456${proxyPath}` : baseUrl,
            ANTHROPIC_AUTH_TOKEN: needsProxy
              ? 'proxy-managed'
              : (apiKey || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || (selectedPreset.needsApiKey ? '(your API key)' : '')),
            ANTHROPIC_MODEL: models.main,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
            ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
            ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
          },
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
      }).catch(() => {
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id])

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setModels({ ...preset.defaultModels })
    setTestResult(null)
  }

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false && apiFormat !== 'chatgpt_codex' && apiFormat !== 'gugu_managed'
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.main.trim() && !settingsJsonError
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
  const promoText = selectedPreset.promoText?.trim()
  const displayedSettingsJson = showApiKey
    ? settingsJson
    : maskSettingsJsonSecrets(settingsJson, apiKey)
  const apiFormatItems = [
    {
      value: 'anthropic' as const,
      label: t('settings.providers.apiFormatAnthropic'),
      icon: <span className="material-symbols-outlined text-[17px]">hub</span>,
    },
    {
      value: 'openai_chat' as const,
      label: t('settings.providers.apiFormatOpenaiChat'),
      icon: <span className="material-symbols-outlined text-[17px]">forum</span>,
    },
    {
      value: 'openai_responses' as const,
      label: t('settings.providers.apiFormatOpenaiResponses'),
      icon: <span className="material-symbols-outlined text-[17px]">route</span>,
    },
    {
      value: 'chatgpt_codex' as const,
      label: t('settings.providers.apiFormatChatgptCodex'),
      icon: <span className="material-symbols-outlined text-[17px]">smart_toy</span>,
    },
    {
      value: 'gugu_managed' as const,
      label: t('settings.providers.apiFormatGuguManaged'),
      icon: <span className="material-symbols-outlined text-[17px]">workspace_premium</span>,
    },
  ]
  const selectedApiFormatLabel = apiFormatItems.find((item) => item.value === apiFormat)?.label ?? t('settings.providers.apiFormatAnthropic')
  const selectedCategoryLabel = formatPresetCategoryLabel(selectedPreset, t)
  const selectedProtocolLabel = formatPresetProtocolLabel(selectedPreset, apiFormat, t)
  const selectedAgentLabel = formatPresetAgentLabel(selectedPreset, apiFormat, t)
  const selectedRoutingSummary = formatProviderRoutingSummary(selectedPreset, models, t)
  const selectedRoutingRoleSummary = formatProviderRoutingRoleSummary(selectedPreset, t)
  const baseUrlNotice = getBaseUrlNotice(baseUrl, apiFormat, t)
  const renderPresetButton = (preset: ProviderPreset) => (
    <button
      key={preset.id}
      onClick={() => handlePresetChange(preset)}
      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
        selectedPreset.id === preset.id
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container-high)] text-[var(--color-brand)] shadow-[var(--shadow-focus-ring)]'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
      }`}
      title={[formatPresetCategoryLabel(preset, t), formatPresetProtocolLabel(preset, preset.apiFormat, t)].filter(Boolean).join(' · ')}
    >
      {preset.name}
    </button>
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      // Write the edited cc-haha settings.json first so provider-specific model
      // settings never conflict with the user's global ~/.claude/settings.json.
      if (settingsJson.trim()) {
        try {
          const parsed = restoreSettingsJsonSecrets(JSON.parse(settingsJson), apiKey)
          const { providersApi } = await import('../api/providers')
          await providersApi.updateSettings(parsed)
        } catch {
          // JSON validation already prevents this
        }
      }

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          authKind: getProviderAuthKind(apiFormat),
          models,
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat,
          authKind: getProviderAuthKind(apiFormat),
          models,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: models.main.trim(),
          apiFormat,
        })
      } else {
        if (requiresApiKey && !apiKey.trim()) return
        result = await testConfig({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || 'local',
          modelId: models.main.trim(),
          apiFormat,
        })
      }
      setTestResult(result)
    } catch {
      setTestResult({ connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('settings.providers.addTitle') : t('settings.providers.editTitle')}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? t('common.add') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset chips */}
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.preset')}</label>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {regularPresets.map(renderPresetButton)}
              </div>
              {featuredPresets.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/60 pt-2">
                  {featuredPresets.map(renderPresetButton)}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedCategoryLabel && (
              <span className="rounded bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--color-text-tertiary)]">
                {selectedCategoryLabel}
              </span>
            )}
            <span className="rounded bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--color-warning)]">
              {selectedProtocolLabel}
            </span>
            <span className="rounded border border-[var(--color-success)]/20 bg-[var(--color-success)]/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--color-success)]">
              {selectedAgentLabel}
            </span>
          </div>
          {selectedRoutingSummary && (
            <div className="mt-2 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
              {selectedRoutingSummary}
            </div>
          )}
          {selectedRoutingRoleSummary && (
            <div className="mt-0.5 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
              {selectedRoutingRoleSummary}
            </div>
          )}
        </div>

        <Input label={t('settings.providers.name')} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providers.namePlaceholder')} />

        <Input label={t('settings.providers.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('settings.providers.notesPlaceholder')} />

        <div>
          <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />
          {baseUrlNotice && (
            <p className={`mt-1 text-[11px] leading-5 ${
              baseUrlNotice.tone === 'warning'
                ? 'text-[var(--color-warning)]'
                : 'text-[var(--color-text-tertiary)]'
            }`}>
              {baseUrlNotice.text}
            </p>
          )}
        </div>

        {/* API Format */}
        {(isCustom || mode === 'edit') ? (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
            <Dropdown<ApiFormat>
              items={apiFormatItems}
              value={apiFormat}
              onChange={setApiFormat}
              width="100%"
              className="block w-full"
              trigger={
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)]"
                >
                  <span className="min-w-0 flex-1 truncate">{selectedApiFormatLabel}</span>
                  <span className="material-symbols-outlined flex-shrink-0 text-[18px] text-[var(--color-text-secondary)]">expand_more</span>
                </button>
              }
            />
            {apiFormat !== 'anthropic' && (
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.proxyHint')}</p>
            )}
          </div>
        ) : apiFormat !== 'anthropic' ? (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
            <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
              {formatApiFormatLabel(apiFormat, t)}
            </div>
          </div>
        ) : null}

        {requiresApiKey ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="provider-api-key" className="text-sm font-medium text-[var(--color-text-primary)]">
              {mode === 'edit' ? t('settings.providers.apiKeyKeep') : t('settings.providers.apiKey')}
              {mode === 'create' && <span className="text-[var(--color-error)] ml-0.5">*</span>}
            </label>
            <div className="relative">
              <input
                id="provider-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={mode === 'edit' ? '****' : 'sk-...'}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pr-10 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((visible) => !visible)}
                aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {showApiKey ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
            {isGuguManagedApi(apiFormat) ? t('settings.providers.guguManagedNoApiKeyRequired') : t('settings.providers.noApiKeyRequired')}
          </div>
        )}

        {(apiKeyUrl || promoText) && (
          <div className="-mt-2 flex flex-col gap-1.5">
            {apiKeyUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(apiKeyUrl)}
                className="group inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 text-[11px] font-medium leading-none text-[var(--color-brand)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
              >
                <span className="material-symbols-outlined text-[13px]">key</span>
                {t('settings.providers.getApiKey')}
                <span className="material-symbols-outlined text-[9px] opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">arrow_outward</span>
              </button>
            )}
            {promoText && (
              <button
                type="button"
                onClick={() => apiKeyUrl && openExternalUrl(apiKeyUrl)}
                disabled={!apiKeyUrl}
                className="group flex w-full cursor-pointer items-start gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/8 px-2.5 py-1.5 text-left text-[11px] leading-5 text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-brand)]/45 hover:bg-[var(--color-brand)]/12 focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:hover:border-[var(--color-brand)]/25 disabled:hover:bg-[var(--color-brand)]/8"
              >
                <span className="material-symbols-outlined mt-0.5 text-[13px] text-[var(--color-brand)]">tips_and_updates</span>
                <span>{promoText}</span>
                {apiKeyUrl && (
                  <span className="material-symbols-outlined ml-auto mt-1 text-[10px] text-[var(--color-brand)] opacity-45 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">arrow_outward</span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Model Mapping */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('settings.providers.mainModel')} required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
            <Input label={t('settings.providers.haikuModel')} value={models.haiku} onChange={(e) => setModels({ ...models, haiku: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.sonnetModel')} value={models.sonnet} onChange={(e) => setModels({ ...models, sonnet: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.opusModel')} value={models.opus} onChange={(e) => setModels({ ...models, opus: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
          </div>
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models.main.trim()}>
            {t('settings.providers.testConnection')}
          </Button>
          {testResult && (
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs ${testResult.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {testResult.connectivity.success
                  ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
                  : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error || '' })}
              </span>
              {testResult.proxy && (
                <span className={`text-xs ${testResult.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                  {testResult.proxy.success
                    ? t('settings.providers.proxyOk', { latency: String(testResult.proxy.latencyMs) })
                    : t('settings.providers.proxyFailed', { error: testResult.proxy.error || '' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Settings JSON — editable, shown for all presets including official */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.settingsJson')}</label>
          <textarea
            value={displayedSettingsJson}
            onChange={(e) => {
              const raw = e.target.value
              try {
                const parsed = restoreSettingsJsonSecrets(JSON.parse(raw), apiKey)
                setSettingsJson(JSON.stringify(parsed, null, 2))
                setSettingsJsonError(null)
                // Auto-fill form fields from parsed JSON env
                const env = parsed.env as Record<string, string> | undefined
                if (env) {
                  if (env.ANTHROPIC_BASE_URL) {
                    setBaseUrl(env.ANTHROPIC_BASE_URL)
                    // Auto-switch to matching preset or Custom
                    if (mode === 'create') {
                      const matchedPreset = availablePresets.find((p) => p.id !== 'custom' && p.baseUrl === env.ANTHROPIC_BASE_URL)
                      const targetPreset = requirePreset(
                        matchedPreset ?? availablePresets.find((p) => p.id === 'custom'),
                      )
                      if (targetPreset.id !== selectedPreset.id) {
                        jsonPastedRef.current = true
                        setSelectedPreset(targetPreset)
                      }
                    }
                  }
                  const nextApiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
                  if (nextApiKey && nextApiKey !== '(your API key)' && nextApiKey !== API_KEY_JSON_PLACEHOLDER) {
                    setApiKey(nextApiKey)
                  }
                  const newModels: Partial<ModelMapping> = {}
                  if (env.ANTHROPIC_MODEL) newModels.main = env.ANTHROPIC_MODEL
                  if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) newModels.haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL
                  if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) newModels.sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL
                  if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) newModels.opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL
                  if (Object.keys(newModels).length > 0) {
                    setModels((prev) => ({ ...prev, ...newModels }))
                  }
                }
              } catch (err) {
                setSettingsJson(raw)
                setSettingsJsonError(err instanceof Error ? err.message : 'Invalid JSON')
              }
            }}
            rows={16}
            spellCheck={false}
            className={`w-full text-xs px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
              settingsJsonError
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)]'
            }`}
          />
          {settingsJsonError && (
            <p className="text-[11px] text-[var(--color-error)] mt-1">{t('settings.providers.jsonError', { error: settingsJsonError })}</p>
          )}
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonDesc')}</p>
        </div>
      </div>
    </Modal>
  )
}


// ─── Permission Settings ──────────────────────────────────────

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()
  const displayMode: PermissionMode = permissionMode === 'plan' ? 'default' : permissionMode

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: t('settings.permissions.default'), desc: t('settings.permissions.defaultDesc') },
    { mode: 'acceptEdits', icon: 'edit_note', label: t('settings.permissions.acceptEdits'), desc: t('settings.permissions.acceptEditsDesc') },
    { mode: 'bypassPermissions', icon: 'bolt', label: t('settings.permissions.bypass'), desc: t('settings.permissions.bypassDesc') },
  ]

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.permissions.title')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">{t('settings.permissions.description')}</p>

      <div className="flex flex-col gap-2">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = displayMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isSelected
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-container)] shadow-[var(--shadow-focus-ring)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-[var(--color-text-secondary)]">{icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">{desc}</div>
              </div>
              {isSelected && (
                <span className="material-symbols-outlined text-[18px] text-[var(--color-brand)]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── General Settings ──────────────────────────────────────

function GeneralSettings() {
  const {
    effortLevel,
    setEffort,
    locale,
    setLocale,
    theme,
    setTheme,
    skipWebFetchPreflight,
    setSkipWebFetchPreflight,
  } = useSettingsStore()
  const t = useTranslation()

  const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: t('settings.general.effort.low'),
    medium: t('settings.general.effort.medium'),
    high: t('settings.general.effort.high'),
    max: t('settings.general.effort.max'),
  }

  const LANGUAGES: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ]

  const THEMES: Array<{ value: ThemeMode; label: string }> = [
    { value: 'light', label: t('settings.general.appearance.light') },
    { value: 'dark', label: t('settings.general.appearance.dark') },
  ]

  return (
    <div className="max-w-xl">
      {/* Appearance selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.appearanceTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.appearanceDescription')}</p>
      <div className="flex gap-2 mb-8">
        {THEMES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => void setTheme(value)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              theme === value
                ? 'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] border-transparent shadow-[var(--shadow-button-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Language selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.languageTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.languageDescription')}</p>
      <div className="flex gap-2 mb-8">
        {LANGUAGES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setLocale(value)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              locale === value
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Effort Level */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.effortTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.effortDescription')}</p>
      <div className="flex gap-2">
        {(['low', 'medium', 'high', 'max'] as EffortLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => setEffort(level)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              effortLevel === level
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.webFetchPreflightTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webFetchPreflightDescription')}</p>
        <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 cursor-pointer hover:border-[var(--color-border-focus)] transition-colors">
          <input
            type="checkbox"
            aria-label={t('settings.general.webFetchPreflightEnabled')}
            checked={skipWebFetchPreflight}
            onChange={(e) => void setSkipWebFetchPreflight(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.general.webFetchPreflightEnabled')}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">
              {t('settings.general.webFetchPreflightHint')}
            </div>
          </div>
        </label>
      </div>
    </div>
  )
}

// ─── Agents Settings ──────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  cyan: '#06b6d4',
}

const AGENT_SOURCE_ORDER: AgentSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'policySettings',
  'plugin',
  'flagSettings',
  'built-in',
]

function AgentsSettings() {
  const {
    activeAgents,
    allAgents,
    isLoading,
    error,
    selectedAgent,
    selectedAgentReturnTab,
    fetchAgents,
    selectAgent,
  } = useAgentStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchAgents(currentWorkDir)
  }, [fetchAgents, currentWorkDir])

  const groupedAgents = useMemo(() => {
    const groups: Partial<Record<AgentSource, AgentDefinition[]>> = {}
    for (const agent of allAgents) {
      ;(groups[agent.source] ??= []).push(agent)
    }
    return groups
  }, [allAgents])

  const sourceCount = AGENT_SOURCE_ORDER.filter((source) => (groupedAgents[source] ?? []).length > 0).length

  const handleAgentBack = () => {
    const returnTab = selectedAgentReturnTab
    selectAgent(null)
    if (returnTab === 'plugins') {
      useUIStore.getState().setPendingSettingsTab('plugins')
    }
  }

  if (selectedAgent) {
    return (
      <div className="w-full min-w-0">
        <AgentDetailView agent={selectedAgent} onBack={handleAgentBack} />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      {isLoading && allAgents.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="text-center py-12 px-4">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-error)] mb-3 block">error_outline</span>
          <p className="text-sm text-[var(--color-error)] mb-2">{error}</p>
          <button
            onClick={() => void fetchAgents(currentWorkDir)}
            className="text-xs text-[var(--color-text-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : allAgents.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-3 block">smart_toy</span>
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.agents.empty')}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.agents.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 min-w-0">
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
            <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                  {t('settings.agents.browserEyebrow')}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                    smart_toy
                  </span>
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {t('settings.agents.browserTitle')}
                  </h3>
                </div>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
                  {t('settings.agents.description')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
                <SummaryCard
                  label={t('settings.agents.summary.totalAgents')}
                  value={String(allAgents.length)}
                  icon="smart_toy"
                />
                <SummaryCard
                  label={t('settings.agents.summary.activeAgents')}
                  value={String(activeAgents.length)}
                  icon="bolt"
                />
                <SummaryCard
                  label={t('settings.agents.summary.sources')}
                  value={String(sourceCount)}
                  icon="layers"
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            </div>
          </section>

          <div className={`grid gap-4 ${sourceCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
            {AGENT_SOURCE_ORDER.map((source) => {
              const group = groupedAgents[source]
              if (!group?.length) return null

              const sourceLabel = t(`settings.agents.source.${source}`)
              return (
                <section
                  key={source}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${getAgentSourceAccentClass(source)}`}>
                          <span className="material-symbols-outlined text-[16px]">
                            {getAgentSourceIcon(source)}
                          </span>
                        </span>
                        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {sourceLabel}
                        </h4>
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          {group.length}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                        {t('settings.agents.groupHint', {
                          source: sourceLabel,
                          count: String(group.length),
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col p-2">
                    {group.map((agent) => (
                      <button
                        key={`${agent.source}-${agent.agentType}`}
                        onClick={() => selectAgent(agent, 'agents')}
                        className="group rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center"
                            style={{ color: getAgentDotColor(agent.color) }}
                          >
                            <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-[var(--color-text-primary)] break-all">
                                {agent.agentType}
                              </span>
                              {agent.modelDisplay && (
                                <MetaPill>{agent.modelDisplay}</MetaPill>
                              )}
                              <MetaPill>{sourceLabel}</MetaPill>
                              <MetaPill>
                                {agent.isActive
                                  ? t('settings.agents.status.active')
                                  : t('settings.agents.status.available')}
                              </MetaPill>
                              {agent.overriddenBy && (
                                <MetaPill>
                                  {t('settings.agents.overriddenBy', {
                                    source: t(`settings.agents.source.${agent.overriddenBy}`),
                                  })}
                                </MetaPill>
                              )}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words [&_.prose]:text-xs [&_.prose]:leading-5 [&_.prose]:text-[var(--color-text-secondary)]">
                              <MarkdownRenderer
                                content={agent.description || t('settings.agents.noDescription')}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                              <span>
                                {agent.tools?.length
                                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                                  : t('settings.agents.noTools')}
                              </span>
                              {agent.baseDir && (
                                <span className="break-all">{agent.baseDir}</span>
                              )}
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                            chevron_right
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function AgentDetailView({ agent, onBack }: { agent: AgentDefinition; onBack: () => void }) {
  const t = useTranslation()
  const sourceLabel = t(`settings.agents.source.${agent.source}`)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 min-w-0">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t('settings.agents.backToList')}
        </button>
      </div>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.agents.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getAgentDotColor(agent.color) }}
              />
              <h3 className="text-[22px] font-semibold leading-tight text-[var(--color-text-primary)] break-all">
                {agent.agentType}
              </h3>
              <MetaPill>{sourceLabel}</MetaPill>
              {agent.modelDisplay && <MetaPill>{agent.modelDisplay}</MetaPill>}
              <MetaPill>
                {agent.isActive
                  ? t('settings.agents.status.active')
                  : t('settings.agents.status.available')}
              </MetaPill>
              {agent.overriddenBy && (
                <MetaPill>
                  {t('settings.agents.overriddenByShort', {
                    source: t(`settings.agents.source.${agent.overriddenBy}`),
                  })}
                </MetaPill>
              )}
            </div>
            <div className="max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
              <MarkdownRenderer
                content={agent.description || t('settings.agents.noDescription')}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-tertiary)]">
              <span>
                {agent.tools?.length
                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                  : t('settings.agents.noTools')}
              </span>
              {agent.baseDir && <span className="break-all">{agent.baseDir}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <DetailStat
              label={t('settings.agents.summary.source')}
              value={sourceLabel}
              icon="layers"
            />
            <DetailStat
              label={t('settings.agents.summary.model')}
              value={agent.modelDisplay || '—'}
              icon="psychology"
            />
            <DetailStat
              label={t('settings.agents.summary.tools')}
              value={String(agent.tools?.length ?? 0)}
              icon="build"
            />
            <DetailStat
              label={t('settings.agents.summary.status')}
              value={agent.isActive ? t('settings.agents.status.active') : t('settings.agents.status.available')}
              icon="bolt"
            />
          </div>
        </div>
      </section>

      {agent.tools && agent.tools.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
              build
            </span>
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.agents.tools')}
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map((tool) => (
              <MetaPill key={tool}>{tool}</MetaPill>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-1 min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-[var(--color-text-secondary)] break-all">
                  {agent.baseDir || sourceLabel}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.agents.promptHint')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] border border-[var(--color-border)]">
                {t('settings.agents.systemPrompt')}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-container-lowest)]">
            {agent.systemPrompt ? (
              <div className="px-6 py-5 lg:px-8">
                <MarkdownRenderer
                  content={agent.systemPrompt}
                  variant="document"
                  className="mx-auto max-w-[72ch]"
                />
              </div>
            ) : (
              <div className="px-6 py-10 text-center">
                <span className="material-symbols-outlined text-[32px] text-[var(--color-text-tertiary)] mb-2 block">
                  article
                </span>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.agents.noSystemPrompt')}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function getAgentDotColor(color?: string) {
  return color && AGENT_COLORS[color] ? AGENT_COLORS[color] : 'var(--color-text-tertiary)'
}

function getAgentSourceIcon(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'person'
    case 'projectSettings':
      return 'folder'
    case 'localSettings':
      return 'folder_lock'
    case 'policySettings':
      return 'shield'
    case 'plugin':
      return 'extension'
    case 'flagSettings':
      return 'terminal'
    case 'built-in':
      return 'inventory_2'
  }
}

function getAgentSourceAccentClass(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
    case 'projectSettings':
      return 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    case 'localSettings':
      return 'bg-[var(--color-info-container)] text-[var(--color-info)]'
    case 'policySettings':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'plugin':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'flagSettings':
      return 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    case 'built-in':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
  }
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  )
}

function DetailStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)] break-all">
        {value}
      </div>
    </div>
  )
}
// ─── Skill Settings ──────────────────────────────────────

function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const t = useTranslation()

  if (selectedSkill) {
    return (
      <div className="w-full min-w-0">
        <SkillDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
        {t('settings.skills.title')}
      </h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
        {t('settings.skills.description')}
      </p>
      <SkillList />
    </div>
  )
}

function PluginSettings() {
  const selectedPlugin = usePluginStore((s) => s.selectedPlugin)
  const t = useTranslation()

  if (selectedPlugin) {
    return (
      <div className="w-full min-w-0">
        <PluginDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
        {t('settings.plugins.title')}
      </h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
        {t('settings.plugins.description')}
      </p>
      <PluginList />
    </div>
  )
}

// ─── Billing Settings ──────────────────────────────────────

const BILLING_STATUS_LABEL_KEYS: Record<BillingStatus, TranslationKey> = {
  not_configured: 'settings.billing.status.notConfigured',
  inactive: 'settings.billing.status.inactive',
  active: 'settings.billing.status.active',
  expired: 'settings.billing.status.expired',
  quota_exhausted: 'settings.billing.status.quotaExhausted',
  check_failed: 'settings.billing.status.checkFailed',
}

const BILLING_STATUS_ICON: Record<BillingStatus, string> = {
  not_configured: 'pending',
  inactive: 'workspace_premium',
  active: 'verified',
  expired: 'event_busy',
  quota_exhausted: 'hourglass_disabled',
  check_failed: 'sync_problem',
}

const BILLING_STATUS_TONE: Record<BillingStatus, string> = {
  not_configured: 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
  inactive: 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
  active: 'border-[var(--color-success)]/40 text-[var(--color-success)]',
  expired: 'border-[var(--color-warning)]/40 text-[var(--color-warning)]',
  quota_exhausted: 'border-[var(--color-warning)]/40 text-[var(--color-warning)]',
  check_failed: 'border-[var(--color-error)]/40 text-[var(--color-error)]',
}

function BillingSettings() {
  const t = useTranslation()
  const status = useBillingStore((s) => s.status)
  const config = useBillingStore((s) => s.config)
  const isLoading = useBillingStore((s) => s.isLoading)
  const isSaving = useBillingStore((s) => s.isSaving)
  const error = useBillingStore((s) => s.error)
  const message = useBillingStore((s) => s.message)
  const fetchBilling = useBillingStore((s) => s.fetchBilling)
  const activateLicense = useBillingStore((s) => s.activateLicense)
  const refresh = useBillingStore((s) => s.refresh)
  const clearLicense = useBillingStore((s) => s.clearLicense)
  const [licenseKey, setLicenseKey] = useState('')

  useEffect(() => {
    void fetchBilling()
  }, [fetchBilling])

  const currentStatus = status?.status ?? 'not_configured'
  const purchaseUrl = status?.purchaseUrl ?? config?.purchaseUrl ?? null
  const activationConfigured = Boolean(config?.verifyUrlConfigured || config?.gatewayUrlConfigured)
  const lastCheckedAt = status?.lastCheckedAt ? formatBillingDate(status.lastCheckedAt) : null
  const canActivate = activationConfigured && licenseKey.trim().length > 0 && !isSaving
  const creditsTotal = status?.creditsTotal ?? null
  const creditsRemaining = status?.creditsRemaining ?? null
  const hasCredits = typeof creditsTotal === 'number' && creditsTotal > 0 && typeof creditsRemaining === 'number'
  const creditsRemainingPercent = hasCredits
    ? Math.max(0, Math.min(100, Math.round((Math.max(0, Math.min(creditsTotal, creditsRemaining)) / creditsTotal) * 100)))
    : 0
  const isCreditsExhausted = currentStatus === 'quota_exhausted' || (hasCredits && creditsRemaining <= 0)
  const isCreditsLow = hasCredits && !isCreditsExhausted && creditsRemaining / creditsTotal <= 0.2
  const creditsBarClass = isCreditsExhausted || isCreditsLow
    ? 'bg-[var(--color-warning)]'
    : 'bg-[var(--color-brand)]'
  const transientMessage = getVisibleBillingMessage(message)
  const statusMessage = getVisibleBillingMessage(status?.message)
  const billingMessage = transientMessage || statusMessage || (currentStatus === 'active' ? null : t('settings.billing.defaultMessage'))

  const handleActivate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canActivate) return
    await activateLicense(licenseKey)
    setLicenseKey('')
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.billing.title')}</h2>
        <p className="mt-0.5 text-sm text-[var(--color-text-tertiary)]">{t('settings.billing.description')}</p>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
          {isLoading && !status ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                    {t('settings.billing.currentStatus')}
                  </div>
                  <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${BILLING_STATUS_TONE[currentStatus]}`}>
                    <span className="material-symbols-outlined text-[17px]">{BILLING_STATUS_ICON[currentStatus]}</span>
                    {t(BILLING_STATUS_LABEL_KEYS[currentStatus])}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void refresh()}
                    loading={isSaving}
                  >
                    <span className="material-symbols-outlined text-[15px]">sync</span>
                    {t('settings.billing.refresh')}
                  </Button>
                  {status?.maskedLicenseKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void clearLicense()}
                      loading={isSaving}
                    >
                      {t('settings.billing.clear')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <BillingDetail label={t('settings.billing.plan')} value={formatBillingPlan(status?.plan, t)} />
                <BillingDetail label={t('settings.billing.expiresAt')} value={status?.expiresAt ? formatBillingDate(status.expiresAt) : t('settings.billing.noExpiry')} />
                <BillingDetail label={t('settings.billing.license')} value={status?.maskedLicenseKey || t('settings.billing.noLicense')} />
              </div>

              {hasCredits && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-[var(--color-text-primary)]">{t('settings.billing.credits')}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      {isCreditsExhausted
                        ? t('settings.billing.creditsExhausted')
                        : t('settings.billing.creditsPercent', { percent: creditsRemainingPercent })}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-container-high)]">
                    <div
                      className={`h-full rounded-full transition-all ${creditsBarClass}`}
                      style={{ width: `${creditsRemainingPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    {isCreditsExhausted
                      ? t('settings.billing.creditsExhaustedHint')
                      : isCreditsLow
                        ? t('settings.billing.creditsLow')
                        : t('settings.billing.creditsHealthy')}
                  </div>
                  {status?.quotaReason && (
                    <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                      {status.quotaReason}
                    </p>
                  )}
                </div>
              )}

              {billingMessage && (
                <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                  {billingMessage}
                </p>
              )}

              {lastCheckedAt && (
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.billing.lastCheckedAt', { time: lastCheckedAt })}
                </p>
              )}
            </div>
          )}
        </section>

        <section className={`rounded-xl border p-4 ${
          isCreditsExhausted
            ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10'
            : 'border-[var(--color-border)] bg-[var(--color-surface-container-low)]'
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.billing.purchaseTitle')}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                {purchaseUrl ? t('settings.billing.purchaseReady') : t('settings.billing.purchaseComingSoon')}
              </p>
            </div>
            <Button
              variant={isCreditsExhausted ? 'primary' : 'secondary'}
              disabled={!purchaseUrl}
              onClick={() => purchaseUrl && openExternalUrl(purchaseUrl)}
            >
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
              {t('settings.billing.purchase')}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
          <form onSubmit={handleActivate} className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.billing.activationTitle')}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                {activationConfigured ? t('settings.billing.activationReady') : t('settings.billing.activationUnavailable')}
              </p>
            </div>

            <Input
              label={t('settings.billing.licenseInput')}
              type="password"
              value={licenseKey}
              placeholder={t('settings.billing.licensePlaceholder')}
              onChange={(event) => setLicenseKey(event.target.value)}
              disabled={!activationConfigured || isSaving}
            />

            {error && (
              <div className="rounded-lg border border-[var(--color-error)]/30 px-3 py-2 text-xs text-[var(--color-error)]">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" loading={isSaving} disabled={!canActivate}>
                {t('settings.billing.activate')}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

function getVisibleBillingMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim()
  if (!trimmed) return null
  if (trimmed === 'Gateway entitlement is active.' || trimmed === '网关订阅状态正常。') {
    return null
  }
  return trimmed
}

function formatBillingPlan(plan: string | null | undefined, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const normalized = plan?.trim().toLowerCase()
  if (!normalized || normalized === 'free') return t('settings.billing.planFree')
  if (normalized === 'light') return 'Light'
  if (normalized === 'pro') return 'Pro'
  if (normalized === 'max') return 'Max'
  if (normalized === 'team') return 'Team'
  return plan!.trim()
}

function BillingDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 min-w-0">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] truncate">{label}</div>
      <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)] truncate">{value}</div>
    </div>
  )
}

function formatBillingDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── About Settings ──────────────────────────────────────

const CODE_REPO = 'https://gitee.com/xiyouwangluo/claude-code-gugu'
const CODE_ISSUES = `${CODE_REPO}/issues`
const CODE_RELEASES = `${CODE_REPO}/releases`
const STUDIO_NAME = '谷星曜工作室'
const AUTHOR_PROFILE = 'https://gitee.com/xiyouwangluo'
const SOCIAL_LINKS = [
  { name: 'Bilibili', icon: '/icons/bilibili.svg', url: 'https://space.bilibili.com/434377496', label: STUDIO_NAME },
  { name: 'Douyin', icon: '/icons/douyin.svg', url: 'https://www.douyin.com/user/MS4wLjABAAAATJPY7LAlaa5X-c8uNdWkvz0jUGgpw4eeXIwu_8BhvqE', label: STUDIO_NAME },
  { name: 'Xiaohongshu', icon: '/icons/xiaohongshu.svg', url: 'https://www.xiaohongshu.com/user/profile/5f58bd990000000001003753', label: STUDIO_NAME },
] as const

function AboutSettings() {
  const t = useTranslation()
  const [version, setVersion] = useState('')
  const updateStatus = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes)
  const totalBytes = useUpdateStore((s) => s.totalBytes)
  const error = useUpdateStore((s) => s.error)
  const checkedAt = useUpdateStore((s) => s.checkedAt)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const initialize = useUpdateStore((s) => s.initialize)

  useEffect(() => {
    let cancelled = false

    import('@tauri-apps/api/app')
      .then((mod) => mod.getVersion())
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => {
        if (!cancelled) setVersion('0.1.0')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void initialize()
  }, [initialize])

  const openUrl = (url: string) => {
    import('@tauri-apps/plugin-shell').then((mod) => mod.open(url)).catch(() => window.open(url, '_blank'))
  }

  const checkedAtText =
    checkedAt
      ? new Date(checkedAt).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        })
      : null

  const hasKnownProgress = typeof totalBytes === 'number' && totalBytes > 0
  const downloadedText = formatBytes(downloadedBytes)
  const updateDescription =
    updateStatus === 'checking'
      ? t('update.checking')
      : updateStatus === 'downloading'
        ? hasKnownProgress
          ? t('update.progress', { progress: String(progressPercent) })
          : t('update.progressBytes', { downloaded: downloadedText })
        : updateStatus === 'restarting'
          ? t('update.restarting')
          : updateStatus === 'available' && availableVersion
            ? t('update.newVersion', { version: availableVersion })
            : updateStatus === 'up-to-date'
              ? t('update.upToDate', { version: version || t('update.currentVersionUnknown') })
              : error
                ? t('update.failed', { error })
                : t('update.idle')

  return (
    <div className="w-full min-w-0 max-w-lg mx-auto flex flex-col items-center py-6">
      {/* Logo + App Name + Version */}
      <img src="/app-icon.svg" alt="Gugu Agent" className="w-20 h-20 mb-4" />
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Gugu Agent</h1>
      {version && (
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span>{t('settings.about.version')} {version}</span>
          <span className="text-[var(--color-border)]">·</span>
          <button
            onClick={() => openUrl(CODE_RELEASES)}
            className="rounded-[var(--radius-sm)] text-[var(--color-text-accent)] transition-colors hover:text-[var(--color-brand)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
          >
            {t('settings.about.changelog')}
          </button>
        </div>
      )}

      {/* Code Repository */}
      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(CODE_REPO)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">source</span>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">xiyouwangluo/claude-code-gugu</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('settings.about.starHint')}</div>
          </div>
        </button>
      </div>

      <div className="mt-4 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.about.updates')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('settings.about.updatesDesc')}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void checkForUpdates()}
            loading={updateStatus === 'checking'}
          >
            {t('update.checkNow')}
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('settings.about.version')}
              </div>
              <div className="text-sm font-medium text-[var(--color-text-primary)] mt-1">
                {version || t('update.currentVersionUnknown')}
              </div>
            </div>

            {availableVersion && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                  {t('update.availableLabel')}
                </div>
                <div className="text-sm font-medium text-[var(--color-text-primary)] mt-1">
                  {availableVersion}
                </div>
              </div>
            )}
          </div>

          <p className={`mt-3 text-sm ${error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}`}>
            {updateDescription}
          </p>

          {checkedAtText && (
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {t('update.checkedAt', { time: checkedAtText })}
            </p>
          )}

          {(updateStatus === 'downloading' || updateStatus === 'restarting') && (
            <div className="mt-3">
              <div className="h-1.5 bg-[var(--color-surface-container-low)] rounded-full overflow-hidden">
                {hasKnownProgress || updateStatus === 'restarting' ? (
                  <div
                    className="h-full bg-[var(--color-text-accent)] transition-all duration-300"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 rounded-full bg-[var(--color-text-accent)]/75 animate-pulse" />
                )}
              </div>
              {!hasKnownProgress && updateStatus === 'downloading' && downloadedBytes > 0 && (
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {downloadedText}
                </p>
              )}
            </div>
          )}

          {releaseNotes && availableVersion && (
            <div className="mt-3 rounded-lg bg-[var(--color-surface-container-low)] px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('update.releaseNotes')}
              </div>
              <MarkdownRenderer
                content={releaseNotes}
                variant="document"
                className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)] [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:text-[13px] [&_p]:leading-6"
              />
            </div>
          )}

          {availableVersion && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={() => void installUpdate()}
                loading={updateStatus === 'downloading' || updateStatus === 'restarting'}
                disabled={updateStatus === 'checking'}
              >
                {updateStatus === 'restarting' ? t('update.restarting') : t('update.now')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-full border-t border-[var(--color-border)]/40 my-6" />

      {/* Author */}
      <div className="w-full">
        <h3 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">{t('settings.about.author')}</h3>
        <button
          onClick={() => openUrl(AUTHOR_PROFILE)}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">business_center</span>
          <span className="text-sm text-[var(--color-text-primary)]">{STUDIO_NAME}</span>
          <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">Gitee</span>
        </button>
      </div>

      {/* Social Media */}
      <div className="w-full mt-4">
        <h3 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">{t('settings.about.socialMedia')}</h3>
        <div className="flex flex-col gap-0.5">
          {SOCIAL_LINKS.map((link) => (
            <button
              key={link.name}
              onClick={() => openUrl(link.url)}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              <img src={link.icon} alt={link.name} className="w-4 h-4 opacity-60" />
              <span className="text-sm text-[var(--color-text-primary)]">{link.label}</span>
              <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{link.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(CODE_ISSUES)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">feedback</span>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.about.feedback')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('settings.about.feedbackDesc')}</div>
          </div>
        </button>
      </div>
    </div>
  )
}
