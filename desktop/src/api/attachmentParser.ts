import { api } from './client'
import type {
  AttachmentParserConfig,
  AttachmentParserTestResult,
  UpdateAttachmentParserConfigInput,
} from '../types/attachmentParser'

type ConfigResponse = { config: AttachmentParserConfig }
type TestResponse = { result: AttachmentParserTestResult }

export const attachmentParserApi = {
  getConfig() {
    return api.get<ConfigResponse>('/api/attachment-parser/config')
  },

  updateConfig(input: UpdateAttachmentParserConfigInput) {
    return api.put<ConfigResponse>('/api/attachment-parser/config', input)
  },

  test(input?: UpdateAttachmentParserConfigInput) {
    return api.post<TestResponse>('/api/attachment-parser/test', input ?? {}, { timeout: 120_000 })
  },
}
