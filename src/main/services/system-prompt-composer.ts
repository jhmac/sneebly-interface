import { buildLearningsAddendum, type LearningsResult } from './learnings'
import { readPromotedMd } from './learning-store'
import { readConventionsMd } from './conventions-md-updater'
import { loadPhasePlan, syncCheckedState, getNextMilestone, getPhaseSummaries } from './phase-tracker'

const TOTAL_WORD_CAP = 2_500
const CONVENTIONS_WORD_CAP = 600
const PHASE_CONTEXT_WORD_CAP = 200

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

  // Slot 0: current phase + next milestones (orientation for every session)
  try {
    const rawPlan = loadPhasePlan(projectPath)
    if (rawPlan) {
      const plan = syncCheckedState(projectPath, rawPlan)
      const next = getNextMilestone(plan)
      const summaries = getPhaseSummaries(plan)
      const activeSummary = summaries.find((s) => s.active)
      if (next && activeSummary) {
        const upcomingInPhase = plan.milestones
          .filter((m) => m.phaseNumber === activeSummary.phaseNumber && !m.checked)
          .slice(0, 5)
        const lines = [
          `## Current build context`,
          `Phase ${activeSummary.phaseNumber}: ${activeSummary.phaseName} — ${activeSummary.completed}/${activeSummary.total} complete`,
          ``,
          `Next milestones:`,
          ...upcomingInPhase.map((m, i) =>
            `${i === 0 ? '→' : ' '} ${m.text}${m.specPath ? ` (spec: ${m.specPath})` : ''}`
          ),
        ]
        const phaseContext = lines.join('\n')
        if (wordCount(phaseContext) <= PHASE_CONTEXT_WORD_CAP) {
          parts.push(phaseContext)
        }
      }
    }
  } catch (e) {
    console.error('[composer] failed to build phase context:', e)
  }

  const skillText = opts.skillPrompt?.trim() ?? ''
  if (skillText) parts.push(skillText)

  let usedWords = wordCount(parts.join(' '))

  // Slot 2: conventions (auto-detected project patterns — capped at 600 words)
  try {
    const conventionsText = readConventionsMd(projectPath)
    if (conventionsText) {
      const wc = Math.min(wordCount(conventionsText), CONVENTIONS_WORD_CAP)
      if (usedWords + wc <= TOTAL_WORD_CAP) {
        const truncated = truncateToWords(conventionsText, CONVENTIONS_WORD_CAP)
        parts.push(truncated)
        usedWords += wordCount(truncated)
      }
    }
  } catch (e) {
    console.error('[composer] failed to read conventions:', e)
  }

  // Slot 3: promoted learnings (user-approved patterns — always injected if present)
  try {
    const promotedText = readPromotedMd(projectPath)
    if (promotedText) {
      const wc = wordCount(promotedText)
      if (usedWords + wc <= TOTAL_WORD_CAP) {
        parts.push(promotedText)
        usedWords += wc
      }
    }
  } catch (e) {
    console.error('[composer] failed to read promoted learnings:', e)
  }

  // Slot 4: reflection learnings (recent session observations — soft budget)
  const remainingBudget = Math.max(0, Math.min(opts.maxWords, TOTAL_WORD_CAP - usedWords))

  if (opts.applyLearnings && remainingBudget > 0) {
    try {
      learnings = buildLearningsAddendum(projectPath, {
        maxAgeDays: opts.maxAgeDays,
        maxWords: remainingBudget,
      })
      if (learnings) parts.push(learnings.text)
    } catch (e) {
      console.error('[composer] failed to build learnings addendum:', e)
    }
  }

  const text = parts.length > 0 ? parts.join('\n\n---\n\n') : null
  return { text, learnings }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function truncateToWords(text: string, maxWords: number): string {
  if (maxWords <= 0) return '…'
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ') + '…'
}
