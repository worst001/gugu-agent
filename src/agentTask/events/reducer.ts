import { assertAgentTaskTransition } from '../stateMachine.js'
import type {
  AgentTask,
  AgentTaskEvent,
  AgentTaskPlan,
  AgentTaskReview,
  AgentTaskStatus,
} from '../types.js'

function readString(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key]
  if (typeof value !== 'string') {
    throw new Error(`Invalid AgentTask event payload: ${key}`)
  }
  return value
}

function applyStatus(
  task: AgentTask,
  status: AgentTaskStatus,
  timestamp: string,
): AgentTask {
  assertAgentTaskTransition(task.status, status, task.resumeStatus)
  return {
    ...task,
    status,
    resumeStatus:
      status === 'blocked'
        ? task.status as AgentTask['resumeStatus']
        : undefined,
    recoverable: status === 'interrupted',
    updatedAt: timestamp,
  }
}

export function reduceAgentTaskEvents(events: AgentTaskEvent[]): AgentTask {
  if (events.length === 0) {
    throw new Error('Cannot reduce an empty AgentTask event stream')
  }

  const first = events[0]
  if (first?.type !== 'task_created') {
    throw new Error('AgentTask event stream must start with task_created')
  }

  const created = first.payload.task
  if (!created || typeof created !== 'object') {
    throw new Error('task_created event is missing task payload')
  }

  let task = created as AgentTask
  if (
    task.id !== first.taskId ||
    task.runId !== first.runId ||
    task.attempt !== first.attempt
  ) {
    throw new Error('task_created identity does not match event envelope')
  }

  task = {
    ...task,
    updatedAt: first.timestamp,
    revision: first.sequence,
  }

  for (const event of events.slice(1)) {
    if (event.taskId !== task.id) {
      throw new Error('AgentTask event stream contains another task identity')
    }

    switch (event.type) {
      case 'status_changed': {
        const from = readString(event.payload, 'from') as AgentTaskStatus
        const to = readString(event.payload, 'to') as AgentTaskStatus
        if (from !== task.status) {
          throw new Error(
            `AgentTask status event expected ${from}, found ${task.status}`,
          )
        }
        task = applyStatus(task, to, event.timestamp)
        break
      }

      case 'scout_recorded':
        task = {
          ...task,
          scoutSummary: readString(event.payload, 'summary'),
        }
        break

      case 'plan_recorded':
        task = {
          ...task,
          plan: event.payload.plan as AgentTaskPlan,
        }
        break

      case 'execution_recorded':
        task = {
          ...task,
          executionSummary: readString(event.payload, 'summary'),
        }
        break

      case 'permission_blocked': {
        const reason = readString(event.payload, 'reason')
        task = {
          ...task,
          warnings: task.warnings.includes(reason)
            ? task.warnings
            : [...task.warnings, reason],
        }
        break
      }

      case 'evidence_persisted':
        task = {
          ...task,
          evidencePackId: readString(event.payload, 'evidencePackId'),
        }
        break

      case 'review_finished':
        task = {
          ...task,
          review: event.payload.review as AgentTaskReview,
        }
        break

      case 'task_interrupted':
        task = applyStatus(task, 'interrupted', event.timestamp)
        break

      case 'task_resumed':
        assertAgentTaskTransition(task.status, 'intake', task.resumeStatus)
        task = {
          ...task,
          runId: event.runId,
          attempt: event.attempt,
          status: 'intake',
          resumeStatus: undefined,
          scoutSummary: undefined,
          plan: undefined,
          executionSummary: undefined,
          evidencePackId: undefined,
          review: undefined,
          warnings: [],
          recoverable: false,
          updatedAt: event.timestamp,
        }
        break

      case 'task_completed':
        task = applyStatus(task, 'completed', event.timestamp)
        break

      case 'task_failed':
        task = applyStatus(task, 'failed', event.timestamp)
        break

      case 'task_cancelled':
        task = applyStatus(task, 'cancelled', event.timestamp)
        break

      case 'task_created':
        throw new Error('AgentTask event stream contains duplicate task_created')

      case 'verification_finished':
        break
    }

    task = {
      ...task,
      updatedAt: event.timestamp,
      revision: event.sequence,
    }
  }

  return task
}