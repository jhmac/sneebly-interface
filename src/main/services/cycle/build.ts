import type { AgentEvent } from '../../../shared/types'
import { runStandaloneTurn, extractJson } from '../standalone-turn'
import type { PlanResult } from './plan'
import { BUILD_PROMPT } from './prompts'

export type BuildResult = {
  status: 'complete' | 'blocked'
  filesModified: string[]
  blockedReason?: string
}

export async function runBuild(
  projectRoot: string,
  projectId: string,
  plan: PlanResult,
  retryContext?: string,
  onEvent?: (event: AgentEvent) => void
): Promise<BuildResult> {
  const context = [
    '## Plan to Execute',
    JSON.stringify(plan, null, 2),
    retryContext ? `\n## Retry Context (previous attempt failed)\n${retryContext}` : '',
  ].join('\n\n')

  const prompt = BUILD_PROMPT + '\n\n' + context

  const result = await runStandaloneTurn({
    cwd: projectRoot,
    projectId,
    prompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    maxTurns: 50,
    appendSystemPrompt:
      'If a verification command (typecheck, test, lint) fails due to a toolchain or ' +
      'environment error — such as an esbuild binary mismatch, missing node_modules, or ' +
      'infrastructure not installed by you — immediately output the blocked JSON result ' +
      'with the error details. Do NOT attempt to rebuild, reinstall, or patch build tools.',
    onEvent,
  })

  if (result.error && !result.assistantText) {
    return {
      status: 'blocked',
      filesModified: [],
      blockedReason: `Build phase error: ${result.error}`,
    }
  }

  const parsed = extractJson<BuildResult>(result.assistantText)
  if (!parsed) {
    return {
      status: 'blocked',
      filesModified: [],
      blockedReason: 'Build phase produced no valid JSON output.',
    }
  }
  return parsed
}
