import type { AgentEvent } from '../../../shared/types'
import { runStandaloneTurn, extractJson } from '../standalone-turn'
import type { PlanResult } from './plan'
import type { VerifyResult } from './verify'
import type { HeartbeatConfig } from './identity'
import { readJournal } from './journal'
import { REFLECT_PROMPT } from './prompts'

export type ReflectResult = {
  failureType: 'execution' | 'plan' | 'spec'
  reasoning: string
  recommendedAction: string
  specificQuestion?: string
}

export async function runReflect(
  projectRoot: string,
  projectId: string,
  plan: PlanResult,
  verifyResult: VerifyResult,
  diff: string,
  _heartbeat: HeartbeatConfig,
  onEvent?: (event: AgentEvent) => void
): Promise<ReflectResult> {
  const recentJournal = readJournal(projectRoot, 10)

  const context = JSON.stringify({ plan, verifierFindings: verifyResult, diff, recentJournal }, null, 2)
  const prompt = REFLECT_PROMPT + '\n\n---\n\n' + context

  const result = await runStandaloneTurn({
    cwd: projectRoot,
    projectId,
    prompt,
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    maxTurns: 10,
    allowedTools: ['Read'],
    appendSystemPrompt: 'You are the Sneebly reflection agent. Your job is classification only, not fixing.',
    onEvent,
  })

  const parsed = extractJson<ReflectResult>(result.assistantText)
  if (!parsed) {
    return {
      failureType: 'plan',
      reasoning: 'Reflect phase produced no valid JSON output.',
      recommendedAction: 'Queue for human review.',
    }
  }
  return parsed
}
