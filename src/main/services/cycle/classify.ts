// PlanResult is defined here to keep classify.ts compilable before plan.ts
// is created in Phase 8a-4. Once plan.ts exists, update to import from there.
export type PlanResult = {
  constraint: string
  reason: string
  phase?: string
  milestone?: string
  dependencyChain?: string
  existingContext?: string
  plan?: Array<{
    step: number
    action: 'create' | 'modify'
    filePath: string
    description: string
    successCriteria: string[]
  }>
  uncertainties?: string[]
  estimatedComplexity?: 'low' | 'medium' | 'high'
  requiresHumanAction?: string
}

export type ClassifyResult = {
  decision: 'auto-commit' | 'queue-for-approval'
  reason: string
}

const APPROVAL_REQUIRED_PATTERNS = [
  '**/auth*', '**/payment*', '**/billing*',
  'shared/schema.ts', 'package.json', '.env*',
]

const APPROVAL_REQUIRED_KEYWORDS = [
  'new table', 'new column', 'type change', 'index removal',
  'new external api', 'cron job', 'background worker',
]

const NEGATION_PREFIXES = [
  'not a ', 'not an ', "isn't a ", "isn't an ",
  'is not a ', 'is not an ', 'no ',
  'rather than ', 'instead of ',
]
const NEGATION_WINDOW = 40

const PLAN_SAFE_MARKERS = ['auto-commit territory']

export function keywordAppearsUnnegated(text: string, keyword: string): boolean {
  let pos = 0
  while (true) {
    const idx = text.indexOf(keyword, pos)
    if (idx === -1) return false
    const window = text.slice(Math.max(0, idx - NEGATION_WINDOW), idx)
    const negated = NEGATION_PREFIXES.some(p => window.includes(p))
    if (!negated) return true
    pos = idx + keyword.length
  }
}

function requiresApprovalByPath(filePath: string): boolean {
  return APPROVAL_REQUIRED_PATTERNS.some(pattern => {
    const cleaned = pattern.replace(/\*\*\//, '').replace(/\*$/, '')
    return filePath.includes(cleaned)
  })
}

export function classifyChanges(
  plan: PlanResult,
  modifiedFiles: string[],
  _agentsContent: string
): ClassifyResult {
  for (const f of modifiedFiles) {
    if (requiresApprovalByPath(f)) {
      return { decision: 'queue-for-approval', reason: `Modified file requires approval: ${f}` }
    }
  }

  const planText = JSON.stringify(plan).toLowerCase()
  const plannerAssertsSafe = PLAN_SAFE_MARKERS.some(m => planText.includes(m))

  if (!plannerAssertsSafe) {
    for (const keyword of APPROVAL_REQUIRED_KEYWORDS) {
      if (keywordAppearsUnnegated(planText, keyword)) {
        return { decision: 'queue-for-approval', reason: `Plan mentions approval-required operation: "${keyword}"` }
      }
    }
  }

  if (plan.dependencyChain === 'schema') {
    return { decision: 'queue-for-approval', reason: 'Schema changes always require approval.' }
  }

  return {
    decision: 'auto-commit',
    reason: 'All modified files are in safe paths and no approval-required operations detected.',
  }
}
