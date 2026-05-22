import type { AgentEvent } from '../../../shared/types'
import { runStandaloneTurn, extractJson } from '../standalone-turn'
import { readJournal } from './journal'
import { loadFailedApproaches } from './memory'
import type { HeartbeatConfig } from './identity'
import { PLAN_PROMPT } from './prompts'

export type PlanStep = {
  step: number
  action: 'create' | 'modify'
  filePath: string
  description: string
  successCriteria: string[]
}

export type PlanResult = {
  constraint: string
  reason: string
  phase?: string
  milestone?: string
  dependencyChain?: string
  existingContext?: string
  plan?: PlanStep[]
  uncertainties?: string[]
  estimatedComplexity?: 'low' | 'medium' | 'high'
  requiresHumanAction?: string
}

export async function runPlan(
  projectRoot: string,
  projectId: string,
  cycleId: string,
  heartbeat: HeartbeatConfig,
  onEvent?: (event: AgentEvent) => void
): Promise<PlanResult> {
  const recentJournal = readJournal(projectRoot, 20)
  const failedApproaches = loadFailedApproaches(projectRoot)

  const context = JSON.stringify({
    recentJournal,
    failedApproaches,
    instructions: 'Survey the codebase and produce the single next build plan as JSON.',
  }, null, 2)

  const prompt = PLAN_PROMPT + '\n\n---\n\n' + context

  const result = await runStandaloneTurn({
    cwd: projectRoot,
    projectId,
    prompt,
    model: 'claude-opus-4-7',
    permissionMode: 'bypassPermissions',
    maxTurns: 20,
    allowedTools: ['Read', 'Glob', 'Grep', 'LS'],
    appendSystemPrompt: 'You are the Sneebly planning agent. Think deeply before acting.',
    extraArgs: ['--max-turns', '20'],
    onEvent,
  })

  if (result.error && !result.assistantText) {
    return {
      constraint: 'BLOCKED',
      reason: `Plan phase error: ${result.error}`,
      requiresHumanAction: 'Check daemon logs and re-run.',
    }
  }

  const parsed = extractJson<PlanResult>(result.assistantText)
  if (!parsed) {
    return {
      constraint: 'BLOCKED',
      reason: 'Plan phase produced no valid JSON output.',
      requiresHumanAction: 'Check daemon logs and re-run.',
    }
  }
  return parsed
}
