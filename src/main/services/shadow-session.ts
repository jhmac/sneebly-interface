import { runStandaloneTurn } from './standalone-turn'
import { appendShadowRun, listPending } from './learning-store'

const SHADOW_PROBE = 'I am about to start a coding session on this project. Based on your instructions, describe how you will approach the work today.'

// One shadow run in-flight at a time across all pending learnings
let shadowInFlight = false

export async function runShadowSession(
  projectPath: string,
  projectId: string,
  learningId: string
): Promise<void> {
  if (shadowInFlight) return

  const pending = listPending(projectPath)
  const entry = pending.find((e) => e.id === learningId)
  if (!entry || entry.shadowRuns.length >= 3) return

  shadowInFlight = true
  try {
    const result = await runStandaloneTurn({
      cwd: projectPath,
      projectId,
      prompt: SHADOW_PROBE,
      model: 'claude-haiku-4-5',
      permissionMode: 'bypassPermissions',
      appendSystemPrompt: entry.proposedChange,
      maxTurns: 1,
    })

    appendShadowRun(projectPath, learningId, {
      ranAt: Date.now(),
      durationMs: result.durationMs,
      // Cap stored text to keep JSON files small
      assistantText: result.assistantText.trim().slice(0, 1500),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    })
  } finally {
    shadowInFlight = false
  }
}
