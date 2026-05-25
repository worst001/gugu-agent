import { useRef, useState, type ChangeEvent } from 'react'
import { Button } from '../components/shared/Button'
import { configBackupApi } from '../api/configBackup'
import { useTranslation, type TranslationKey } from '../i18n'
import type {
  ConfigBackupPackage,
  ConfigBackupPreview,
  ConfigBackupPreviewAction,
  ConfigBackupSection,
} from '../types/configBackup'

export function ConfigBackupSettings() {
  const t = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [overwrite, setOverwrite] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [configPackage, setConfigPackage] = useState<ConfigBackupPackage | null>(null)
  const [preview, setPreview] = useState<ConfigBackupPreview | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleExport = async () => {
    setIsExporting(true)
    setMessage(null)
    try {
      const exported = await configBackupApi.exportConfig(includeSecrets)
      downloadJson(exported)
      setMessage({ type: 'success', text: t('settings.configBackup.exported') })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsExporting(false)
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage(null)
    setSelectedFileName(file.name)
    setPreview(null)
    setConfigPackage(null)

    try {
      const parsed = JSON.parse(await readFileText(file)) as ConfigBackupPackage
      setConfigPackage(parsed)
      await previewPackage(parsed, overwrite)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : t('settings.configBackup.invalidFile') })
    } finally {
      event.target.value = ''
    }
  }

  const previewPackage = async (pkg: ConfigBackupPackage, nextOverwrite = overwrite) => {
    setIsPreviewing(true)
    setMessage(null)
    try {
      const { preview } = await configBackupApi.previewImport(pkg, nextOverwrite)
      setPreview(preview)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleOverwriteChange = async (nextOverwrite: boolean) => {
    setOverwrite(nextOverwrite)
    if (configPackage) {
      await previewPackage(configPackage, nextOverwrite)
    }
  }

  const handleImport = async () => {
    if (!configPackage) return
    setIsImporting(true)
    setMessage(null)
    try {
      const result = await configBackupApi.importConfig(configPackage, overwrite)
      setPreview(result.preview)
      setMessage({ type: 'success', text: t('settings.configBackup.imported') })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.configBackup.title')}</h2>
        <p className="mt-0.5 text-sm text-[var(--color-text-tertiary)]">{t('settings.configBackup.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-text-accent)]">ios_share</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.configBackup.exportTitle')}</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.configBackup.exportDescription')}</p>
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(event) => setIncludeSecrets(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--color-text-primary)]">{t('settings.configBackup.includeSecrets')}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--color-warning)]">{t('settings.configBackup.includeSecretsWarning')}</span>
            </span>
          </label>

          <div className="mt-4 flex justify-end">
            <Button onClick={handleExport} loading={isExporting}>
              <span className="material-symbols-outlined text-[16px]">download</span>
              {t('settings.configBackup.exportButton')}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-text-accent)]">upload_file</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.configBackup.importTitle')}</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.configBackup.importDescription')}</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <span className="material-symbols-outlined text-[16px]">folder_open</span>
              {t('settings.configBackup.chooseFile')}
            </Button>
            {selectedFileName && (
              <span className="max-w-[240px] truncate text-xs text-[var(--color-text-tertiary)]">
                {selectedFileName}
              </span>
            )}
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => void handleOverwriteChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--color-text-primary)]">{t('settings.configBackup.overwrite')}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.configBackup.overwriteHint')}</span>
            </span>
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={!configPackage}
              loading={isPreviewing}
              onClick={() => configPackage && void previewPackage(configPackage)}
            >
              {t('settings.configBackup.previewButton')}
            </Button>
            <Button
              disabled={!configPackage || !preview}
              loading={isImporting}
              onClick={handleImport}
            >
              {t('settings.configBackup.importButton')}
            </Button>
          </div>
        </section>
      </div>

      {message && (
        <div className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
          message.type === 'success'
            ? 'border-[var(--color-success)]/30 text-[var(--color-success)]'
            : 'border-[var(--color-error)]/30 text-[var(--color-error)]'
        }`}>
          {message.text}
        </div>
      )}

      {preview && (
        <section className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.configBackup.previewTitle')}</h3>
              <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.configBackup.previewMeta', {
                  version: preview.version,
                  secrets: preview.secretsIncluded
                    ? t('settings.configBackup.secretsIncluded')
                    : t('settings.configBackup.secretsMasked'),
                })}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['add', 'overwrite', 'skip', 'preserve'] as const).map((action) => (
                <PreviewStat
                  key={action}
                  label={t(actionKey(action))}
                  value={preview.summary[action] ?? 0}
                />
              ))}
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {preview.items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                {t('settings.configBackup.previewEmpty')}
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {preview.items.map((item, index) => (
                  <div key={`${item.section}-${item.name}-${index}`} className="grid grid-cols-[150px_1fr_120px] gap-3 px-4 py-3 text-sm">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                      {t(sectionKey(item.section))}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[var(--color-text-primary)]">{item.name}</div>
                      {item.reason && (
                        <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{item.reason}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${actionClass(item.action)}`}>
                        {t(actionKey(item.action))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-center">
      <div className="text-base font-semibold text-[var(--color-text-primary)]">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{label}</div>
    </div>
  )
}

function downloadJson(configPackage: ConfigBackupPackage) {
  const blob = new Blob([JSON.stringify(configPackage, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'gugu-config-export.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function sectionKey(section: ConfigBackupSection): TranslationKey {
  return `settings.configBackup.section.${section}` as TranslationKey
}

function actionKey(action: ConfigBackupPreviewAction): TranslationKey {
  return `settings.configBackup.action.${action}` as TranslationKey
}

function actionClass(action: ConfigBackupPreviewAction): string {
  switch (action) {
    case 'add':
      return 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    case 'overwrite':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'preserve':
      return 'bg-[var(--color-info-container)] text-[var(--color-info)]'
    case 'skip':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
  }
}
