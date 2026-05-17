export type AttachmentParserConfig = {
  enabled: boolean
  mode: 'managed' | 'custom'
  apiKey: string
  hasApiKey: boolean
  baseUrl: string
  visionModel: string
  ocrModel: string
  summarizeModel: string
}

export type UpdateAttachmentParserConfigInput = {
  enabled?: boolean
  mode?: 'managed' | 'custom'
  apiKey?: string
  baseUrl?: string
  visionModel?: string
  ocrModel?: string
  summarizeModel?: string
}

export type AttachmentParserTestResult = {
  success: boolean
  latencyMs: number
  modelUsed: string
  error?: string
}
