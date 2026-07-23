import { useCallback } from 'react'
import { FeishuConnectionCard } from '../components/settings/FeishuConnectionCard'
import { WeixinConnectionCard } from '../components/settings/WeixinConnectionCard'
import { useTranslation } from '../i18n'
import { useAdapterStore } from '../stores/adapterStore'

export function AdapterSettings() {
  const t = useTranslation()
  const { fetchConfig, restartAdapters } = useAdapterStore()

  const handleConnectionChanged = useCallback(async () => {
    await restartAdapters()
    await fetchConfig()
  }, [fetchConfig, restartAdapters])

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.adapters.description')}
      </p>

      <WeixinConnectionCard onConnectionChanged={handleConnectionChanged} />
      <FeishuConnectionCard onConnectionChanged={handleConnectionChanged} />
    </div>
  )
}
