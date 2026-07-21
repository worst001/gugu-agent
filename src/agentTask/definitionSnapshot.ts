import type { AgentTaskRolePack } from './rolePacks.js'
import type {
  AgentTaskAssistantOverlaySnapshot,
  AgentTaskDefinitionRef,
  AgentTaskDefinitionSnapshot,
} from './types.js'
import type { AgentTaskCapabilityId } from './capabilities.js'

export function buildAgentTaskDefinitionSnapshot(
  rolePack: AgentTaskRolePack,
  options: {
    assistant?: AgentTaskAssistantOverlaySnapshot
    team?: AgentTaskDefinitionRef
    taskTemplate?: AgentTaskDefinitionRef
    capabilities?: {
      required?: readonly AgentTaskCapabilityId[]
      optional?: readonly AgentTaskCapabilityId[]
    }
  } = {},
): AgentTaskDefinitionSnapshot {
  return {
    schemaVersion: 1,
    ...(options.team ? { team: { ...options.team } } : {}),
    ...(options.taskTemplate
      ? { taskTemplate: { ...options.taskTemplate } }
      : {}),
    workflow: { ...rolePack.workflow },
    roles: [{
      slotId: 'primary',
      kind: 'primary',
      role: rolePack.id,
      roleVersion: rolePack.version,
      ...(options.assistant ? { assistant: { ...options.assistant } } : {}),
    }],
    capabilities: {
      required: [...new Set([
        ...rolePack.capabilities.required,
        ...(options.capabilities?.required ?? []),
      ])],
      optional: [...new Set([
        ...rolePack.capabilities.optional,
        ...(options.capabilities?.optional ?? []),
      ])],
    },
    completionContract: {
      definitionOfDone: [...rolePack.definitionOfDone],
      outputContracts: [...rolePack.outputContracts],
    },
  }
}
