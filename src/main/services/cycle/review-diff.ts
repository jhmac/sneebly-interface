import type { AgentEvent } from '../../../shared/types'
import { runStandaloneTurn, extractJson } from '../standalone-turn'
import type { PlanResult } from './plan'
import { REVIEW_DIFF_PROMPT } from './prompts'

export type DiffReviewResult = {
  implements: 'yes' | 'no' | 'partial'
  missing: string[]
  extra: string[]
  reasoning: string
}

export async function reviewDiff(
  projectRoot: string,
  projectId: string,
  plan: PlanResult,
  diff: string,
  onEvent?: (event: AgentEvent) => void
): Promise<DiffReviewResult> {
  const context = JSON.stringify({ plan, diff }, null, 2)
  const prompt = REVIEW_DIFF_PROMPT + '\n\n---\n\n' + context

  const result = await runStandaloneTurn({
    cwd: projectRoot,
    projectId,
    prompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'default',
    maxTurns: 5,
    allowedTools: [],
    onEvent,
  })

  const parsed = extractJson<DiffReviewResult>(result.assistantText)
  if (!parsed) {
    return {
      implements: 'no',
      missing: ['Could not parse review output'],
      extra: [],
      reasoning: 'Review phase produced no valid JSON.',
    }
  }
  return parsed
}
