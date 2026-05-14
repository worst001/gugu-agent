export type ConfigBackupSection =
  | 'providers'
  | 'attachmentParser'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'agents'
  | 'guiPreferences'

export type ConfigBackupPreviewAction =
  | 'add'
  | 'overwrite'
  | 'skip'
  | 'preserve'

export type ConfigBackupPreviewItem = {
  section: ConfigBackupSection
  name: string
  action: ConfigBackupPreviewAction
  reason?: string
}

export type ConfigBackupPreview = {
  valid: boolean
  format: string
  version: number
  secretsIncluded: boolean
  items: ConfigBackupPreviewItem[]
  summary: Record<ConfigBackupPreviewAction, number>
}

export type ConfigBackupPackage = {
  format: 'gugu-config-export'
  version: 1
  exportedAt: string
  app: {
    name: 'Gugu Agent'
    configDir: string
  }
  secretsIncluded: boolean
  sections: Record<string, unknown>
}

export type ConfigBackupImportResult = {
  ok: true
  preview: ConfigBackupPreview
}
