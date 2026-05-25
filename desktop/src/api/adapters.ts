import { api } from './client'
import type { AdapterDiagnostics, AdapterFileConfig } from '../types/adapter'

export const adaptersApi = {
  getConfig() {
    return api.get<AdapterFileConfig>('/api/adapters')
  },

  getStatus() {
    return api.get<AdapterDiagnostics>('/api/adapters/status')
  },

  updateConfig(patch: Partial<AdapterFileConfig>) {
    return api.put<AdapterFileConfig>('/api/adapters', patch)
  },
}
