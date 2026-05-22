import { api } from './client'
import type {
  ConfigBackupImportResult,
  ConfigBackupPackage,
  ConfigBackupPreview,
} from '../types/configBackup'

export const configBackupApi = {
  exportConfig(includeSecrets = false) {
    return api.post<ConfigBackupPackage>('/api/config-backup/export', { includeSecrets })
  },

  previewImport(configPackage: unknown, overwrite = true) {
    return api.post<{ preview: ConfigBackupPreview }>('/api/config-backup/preview', {
      package: configPackage,
      overwrite,
    })
  },

  importConfig(configPackage: unknown, overwrite = true) {
    return api.post<ConfigBackupImportResult>('/api/config-backup/import', {
      package: configPackage,
      overwrite,
    })
  },
}
