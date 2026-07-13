import { isEnvTruthy } from '../utils/envUtils.js'

export const AGENT_TASK_RUNTIME_FLAG = 'CC_GUGU_AGENT_TASK_RUNTIME'

export function isAgentTaskRuntimeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env[AGENT_TASK_RUNTIME_FLAG])
}