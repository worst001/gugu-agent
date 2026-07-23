import { api } from './client'
import type {
  AdapterDiagnostics,
  AdapterFileConfig,
  FeishuConnection,
  FeishuInstallationStatus,
  WeixinConnection,
  WeixinInstallationStatus,
} from '../types/adapter'

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

  getFeishuConnection() {
    return api.get<FeishuConnection>('/api/adapters/feishu/connection')
  },

  startFeishuInstallation() {
    return api.post<FeishuInstallationStatus>('/api/adapters/feishu/installations')
  },

  getFeishuInstallation(installationId: string, signal?: AbortSignal) {
    return api.get<FeishuInstallationStatus>(
      '/api/adapters/feishu/installations/' + encodeURIComponent(installationId),
      { timeout: 45_000, signal },
    )
  },

  cancelFeishuInstallation(installationId: string) {
    return api.delete<FeishuInstallationStatus>(
      '/api/adapters/feishu/installations/' + encodeURIComponent(installationId),
    )
  },

  disconnectFeishu() {
    return api.delete<{ ok: true }>('/api/adapters/feishu/connection')
  },
  getWeixinConnection() {
    return api.get<WeixinConnection>('/api/adapters/weixin/connection')
  },

  startWeixinInstallation() {
    return api.post<WeixinInstallationStatus>('/api/adapters/weixin/installations')
  },

  getWeixinInstallation(installationId: string, signal?: AbortSignal) {
    return api.get<WeixinInstallationStatus>(
      '/api/adapters/weixin/installations/' + encodeURIComponent(installationId),
      { timeout: 45_000, signal },
    )
  },

  submitWeixinVerification(installationId: string, code: string) {
    return api.post<WeixinInstallationStatus>(
      '/api/adapters/weixin/installations/' + encodeURIComponent(installationId) + '/verification',
      { code },
    )
  },

  cancelWeixinInstallation(installationId: string) {
    return api.delete<WeixinInstallationStatus>(
      '/api/adapters/weixin/installations/' + encodeURIComponent(installationId),
    )
  },

  disconnectWeixin() {
    return api.delete<{ ok: true }>('/api/adapters/weixin/connection')
  },
}
