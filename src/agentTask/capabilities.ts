export type AgentTaskCapabilityDefinition = {
  id: string
  toolNames: readonly string[]
  skillNames?: readonly string[]
  acceptsMcpTools?: boolean
}

// ponytail: providers stay code-owned until Skills and MCP publish semantic
// capability metadata that can replace this mapping.
export const AGENT_TASK_CAPABILITIES = [
  {
    id: 'repository_read',
    toolNames: ['Read', 'Glob', 'Grep', 'Bash', 'PowerShell'],
  },
  {
    id: 'repository_write',
    toolNames: ['Edit', 'Write', 'Bash', 'PowerShell'],
  },
  { id: 'shell', toolNames: ['Bash', 'PowerShell'] },
  {
    id: 'source_retrieval',
    toolNames: [
      'Read',
      'WebSearch',
      'WebFetch',
      'ListMcpResourcesTool',
      'ReadMcpResourceTool',
    ],
  },
  { id: 'artifact_read', toolNames: ['Read', 'OfficeFile'] },
  { id: 'artifact_write', toolNames: ['Write', 'Edit', 'OfficeFile'] },
  {
    id: 'browser',
    toolNames: ['WebBrowser'],
    skillNames: ['claude-in-chrome'],
  },
  { id: 'external_connectors', toolNames: [], acceptsMcpTools: true },
  { id: 'document', toolNames: ['OfficeFile'] },
  { id: 'spreadsheet', toolNames: ['OfficeFile'] },
  { id: 'presentation', toolNames: ['OfficeFile'] },
  { id: 'data_processing', toolNames: ['Bash', 'PowerShell', 'OfficeFile'] },
  {
    id: 'video_composition',
    toolNames: [],
    skillNames: ['hyperframes', 'website-to-hyperframes'],
  },
  {
    id: 'video_rendering',
    toolNames: [],
    skillNames: ['hyperframes-cli'],
  },
] as const satisfies readonly AgentTaskCapabilityDefinition[]

export type AgentTaskCapabilityId =
  (typeof AGENT_TASK_CAPABILITIES)[number]['id']

export type AgentTaskCapabilityInventory = {
  tools: readonly { name: string; isMcp?: boolean }[]
  skills: readonly string[]
}

export type AgentTaskCapabilityResolution = {
  id: AgentTaskCapabilityId
  providers: Array<{
    kind: 'tool' | 'skill' | 'mcp'
    name: string
  }>
}

export type AgentTaskCapabilityResolutionSet = {
  capabilities: AgentTaskCapabilityResolution[]
  missingRequired: AgentTaskCapabilityId[]
  unavailableOptional: AgentTaskCapabilityId[]
}

export function resolveAgentTaskCapabilities(
  required: readonly AgentTaskCapabilityId[],
  optional: readonly AgentTaskCapabilityId[],
  inventory: AgentTaskCapabilityInventory,
): AgentTaskCapabilityResolutionSet {
  const tools = new Map(inventory.tools.map((tool) => [tool.name, tool]))
  const skills = new Set(inventory.skills)
  const resolve = (
    id: AgentTaskCapabilityId,
  ): AgentTaskCapabilityResolution => {
    const definition = AGENT_TASK_CAPABILITIES.find(
      (capability) => capability.id === id,
    )
    if (!definition) return { id, providers: [] }

    const providers: AgentTaskCapabilityResolution['providers'] = []
    for (const name of definition.toolNames) {
      const tool = tools.get(name)
      if (tool) providers.push({ kind: tool.isMcp ? 'mcp' : 'tool', name })
    }
    for (const name of 'skillNames' in definition
      ? definition.skillNames
      : []) {
      const provider = [...skills].find(
        (skillName) => skillName === name || skillName.endsWith(`:${name}`),
      )
      if (provider) providers.push({ kind: 'skill', name: provider })
    }
    if (
      'acceptsMcpTools' in definition && definition.acceptsMcpTools
    ) {
      for (const tool of inventory.tools) {
        if (tool.isMcp) providers.push({ kind: 'mcp', name: tool.name })
      }
    }
    return { id, providers }
  }

  const capabilities = [...required, ...optional].map(resolve)
  const available = new Set(
    capabilities
      .filter((capability) => capability.providers.length > 0)
      .map((capability) => capability.id),
  )
  return {
    capabilities,
    missingRequired: required.filter((id) => !available.has(id)),
    unavailableOptional: optional.filter((id) => !available.has(id)),
  }
}
