// Provider presets inspired by cc-switch (https://github.com/farion1231/cc-switch)
// Original work by Jason Young, MIT License

import { z } from 'zod'

import providerPresetsJson from './providerPresets.json'
import { ApiFormatSchema } from '../types/provider.js'

const ModelMappingSchema = z.object({
  main: z.string(),
  haiku: z.string(),
  sonnet: z.string(),
  opus: z.string(),
})

const ProviderPresetCategorySchema = z.enum([
  'official',
  'domestic',
  'domestic-coding',
  'aggregator',
  'local',
  'custom',
])

const ProviderPresetProtocolSchema = z.enum([
  'anthropic_native',
  'anthropic_compatible',
  'openai_chat_proxy',
  'openai_responses_proxy',
  'chatgpt_codex',
  'gugu_managed',
])

const ProviderPresetModelRoleSchema = z.enum(['main', 'haiku', 'sonnet', 'opus'])

const ProviderPresetRoutingHintSchema = z.object({
  fast: ProviderPresetModelRoleSchema.optional(),
  balanced: ProviderPresetModelRoleSchema.optional(),
  pro: ProviderPresetModelRoleSchema.optional(),
  note: z.string().optional(),
})

const ProviderPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema,
  defaultModels: ModelMappingSchema,
  needsApiKey: z.boolean(),
  websiteUrl: z.string(),
  category: ProviderPresetCategorySchema.optional(),
  protocol: ProviderPresetProtocolSchema.optional(),
  agentCompatible: z.boolean().optional(),
  routingHint: ProviderPresetRoutingHintSchema.optional(),
  apiKeyUrl: z.string().optional(),
  promoText: z.string().optional(),
  featured: z.boolean().optional(),
  defaultEnv: z.record(z.string(), z.string()).optional(),
})

const ProviderPresetsSchema = z.array(ProviderPresetSchema)

export type ModelMapping = z.infer<typeof ModelMappingSchema>
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>

export const PROVIDER_PRESETS = ProviderPresetsSchema.parse(providerPresetsJson)
