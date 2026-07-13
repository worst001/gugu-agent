import { AgentTaskOrchestrator } from './orchestrator.js'
import { AgentTaskService } from './service.js'

export type AgentTaskRuntime = {
  service: AgentTaskService
  orchestrator: AgentTaskOrchestrator
}

let runtime: AgentTaskRuntime | undefined
let recoveryPromise: Promise<unknown> | undefined

export async function getAgentTaskRuntime(): Promise<AgentTaskRuntime> {
  if (!runtime) {
    const service = new AgentTaskService()
    runtime = {
      service,
      orchestrator: new AgentTaskOrchestrator(service),
    }
    recoveryPromise = service.recoverInterruptedTasks()
  }

  const current = runtime
  await recoveryPromise
  return current
}

export function setAgentTaskRuntimeForTests(
  service: AgentTaskService | null,
): void {
  runtime = service
    ? {
        service,
        orchestrator: new AgentTaskOrchestrator(service),
      }
    : undefined
  recoveryPromise = service ? Promise.resolve() : undefined
}
