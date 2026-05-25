import { buildLearningsAddendum, type LearningsResult } from './learnings'

const TOTAL_WORD_CAP = 2_500

export interface ComposerResult {
  text: string | null
  learnings: LearningsResult | null
}

export function composeSystemPromptAddendum(
  projectPath: string,
  opts: {
    skillPrompt?: string
    applyLearnings: boolean
    maxAgeDays: number
    maxWords: number
  }
): ComposerResult {
  const parts: string[] = []
  let learnings: LearningsResult | null = null

  const skillText = opts.skillPrompt?.trim() ?? ''
  if (skillText) parts.push(skillText)

  const skillWordCount = wordCount(skillText)
  const remainingBudget = Math.max(0, Math.min(opts.maxWords, TOTAL_WORD_CAP - skillWordCount))

  if (opts.applyLearnings && remainingBudget > 0) {
    try {
      learnings = buildLearningsAddendum(projectPath, {
        maxAgeDays: opts.maxAgeDays,
        maxWords: remainingBudget,
      })
      if (learnings) parts.push(learnings.text)
    } catch (e) {
      console.error('[composer] failed to build learnings addendum:', e)
      // Continue without learnings — skill prompt alone is still useful
    }
  }

  const text = parts.length > 0 ? parts.join('\n\n---\n\n') : null
  return { text, learnings }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}
