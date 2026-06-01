import { createHash } from 'crypto'

import type { ApiFormat } from '../types/provider.js'
import type { ProviderCapabilities } from './providerCapabilities.js'
import type { AnthropicRequest } from './transform/types.js'

type PrefixComponent = 'system' | 'tools' | 'model' | 'providerCapabilities'

export type PrefixStabilitySnapshot = {
  fingerprint: string
  componentHashes: Record<PrefixComponent, string>
  summary: {
    model: string
    providerFamily: string | null
    thinkingRequestParam: string | null
    cacheTelemetryStyle: string | null
    supportsImages: boolean
    toolCount: number
    toolNames: string[]
  }
}

type PrefixStabilityContext = {
  apiFormat: ApiFormat
  baseUrl: string
  capabilities: ProviderCapabilities
}

export type PrefixStabilityObservation =
  | { status: 'disabled' }
  | {
      status: 'baseline' | 'stable'
      scope: string
      fingerprint: string
      summary: PrefixStabilitySnapshot['summary']
    }
  | {
      status: 'drift'
      scope: string
      previousFingerprint: string
      fingerprint: string
      changedComponents: PrefixComponent[]
      summary: PrefixStabilitySnapshot['summary']
    }

const previousSnapshots = new Map<string, PrefixStabilitySnapshot>()

export function observePrefixStability(
  body: AnthropicRequest,
  context: PrefixStabilityContext,
): PrefixStabilityObservation {
  if (process.env.CC_GUGU_PROXY_PREFIX_DEBUG !== '1') {
    return { status: 'disabled' }
  }

  const scope = buildPrefixScope(body, context)
  const snapshot = buildPrefixStabilitySnapshot(body, context.capabilities)
  const previous = previousSnapshots.get(scope)
  previousSnapshots.set(scope, snapshot)

  if (!previous) {
    const observation: PrefixStabilityObservation = {
      status: 'baseline',
      scope,
      fingerprint: snapshot.fingerprint,
      summary: snapshot.summary,
    }
    console.debug('[Proxy] Prefix stability baseline', observation)
    return observation
  }

  const changedComponents = diffPrefixStabilitySnapshots(previous, snapshot)
  if (changedComponents.length === 0) {
    return {
      status: 'stable',
      scope,
      fingerprint: snapshot.fingerprint,
      summary: snapshot.summary,
    }
  }

  const observation: PrefixStabilityObservation = {
    status: 'drift',
    scope,
    previousFingerprint: previous.fingerprint,
    fingerprint: snapshot.fingerprint,
    changedComponents,
    summary: snapshot.summary,
  }
  console.debug('[Proxy] Prefix stability drift', observation)
  return observation
}

export function buildPrefixStabilitySnapshot(
  body: AnthropicRequest,
  capabilities: ProviderCapabilities,
): PrefixStabilitySnapshot {
  const componentInputs = {
    system: normalizeSystem(body.system),
    tools: normalizeTools(body.tools),
    model: body.model,
    providerCapabilities: {
      providerFamily: capabilities.providerFamily,
      supportsImages: capabilities.supportsImages,
      reasoningContentReplay: capabilities.openAIChat.reasoningContentReplay,
      requiresReasoningContentForToolCalls: capabilities.openAIChat.requiresReasoningContentForToolCalls,
      thinkingRequestParam: capabilities.openAIChat.thinkingRequestParam,
      cacheTelemetryStyle: capabilities.openAIChat.cacheTelemetryStyle,
    },
  }
  const componentHashes = {
    system: hashStable(componentInputs.system),
    tools: hashStable(componentInputs.tools),
    model: hashStable(componentInputs.model),
    providerCapabilities: hashStable(componentInputs.providerCapabilities),
  }

  return {
    fingerprint: hashStable(componentHashes),
    componentHashes,
    summary: {
      model: body.model,
      providerFamily: capabilities.providerFamily,
      thinkingRequestParam: capabilities.openAIChat.thinkingRequestParam,
      cacheTelemetryStyle: capabilities.openAIChat.cacheTelemetryStyle,
      supportsImages: capabilities.supportsImages,
      toolCount: body.tools?.length ?? 0,
      toolNames: body.tools?.map((tool) => tool.name) ?? [],
    },
  }
}

export function diffPrefixStabilitySnapshots(
  previous: PrefixStabilitySnapshot,
  current: PrefixStabilitySnapshot,
): PrefixComponent[] {
  return (Object.keys(current.componentHashes) as PrefixComponent[])
    .filter((component) => previous.componentHashes[component] !== current.componentHashes[component])
}

export function resetPrefixStabilityForTests(): void {
  previousSnapshots.clear()
}

function buildPrefixScope(body: AnthropicRequest, context: PrefixStabilityContext): string {
  return [
    context.apiFormat,
    body.model,
    context.capabilities.providerFamily ?? 'generic',
    hashStable(context.baseUrl),
  ].join(':')
}

function normalizeSystem(system: AnthropicRequest['system']): unknown {
  if (!system) return null
  if (typeof system === 'string') return system
  return system.map((block) => ({
    type: block.type,
    text: block.text,
    cache_control: block.cache_control ?? null,
  }))
}

function normalizeTools(tools: AnthropicRequest['tools']): unknown {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    input_schema: tool.input_schema,
  }))
}

function hashStable(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 16)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${entries.join(',')}}`
}
