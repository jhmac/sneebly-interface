import { join, relative } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { loadPhasePlan, syncCheckedState, markMilestoneComplete } from './phase-tracker'
import { sendToProjectWindows } from './window-registry'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { MilestoneAuditResult, OrderedMilestone } from '../../shared/types'

const BATCH_SIZE = 18

const AUDITOR_SYSTEM_PROMPT = `You are auditing a software project codebase to determine which features from a milestone checklist are already implemented.

For each milestone in the input, use your Read and Bash tools to investigate the codebase. Be systematic but efficient:

1. Start with a quick directory scan (Bash: find . -type f -name "*.ts" -o -name "*.tsx" | head -80) to understand the file structure
2. For each milestone, search for relevant keywords, components, routes, API endpoints, or database schemas
3. Read specific files only when needed to confirm or deny implementation

Status definitions:
- "complete": Feature is fully implemented with working code (not just scaffolded/stubbed)
- "partial": Some implementation exists but it is incomplete, stubbed out, or missing critical parts
- "not-started": No meaningful implementation found

Confidence:
- "high": You found clear, direct evidence (read the actual implementation)
- "medium": You found indirect evidence (imports, test files, related code) without reading the full impl
- "low": You are making an educated guess

After checking ALL milestones, output ONLY a JSON array with no surrounding text, no markdown fences:
[
  { "id": "...", "status": "complete|partial|not-started", "confidence": "high|medium|low", "evidence": "one sentence describing what you found" },
  ...
]
The array must contain exactly one entry per milestone in the input list, in the same order.`

function buildAuditPrompt(projectPath: string, milestones: OrderedMilestone[]): string {
  const rel = (p: string) => relative(projectPath, p)
  const srcDir = join(projectPath, 'src')
  const artifactsDir = join(projectPath, 'artifacts')

  const rootPaths: string[] = [projectPath]
  if (existsSync(srcDir)) rootPaths.push(srcDir)
  if (existsSync(artifactsDir)) {
    try {
      for (const entry of readdirSync(artifactsDir)) {
        const full = join(artifactsDir, entry)
        if (statSync(full).isDirectory()) rootPaths.push(full)
      }
    } catch { /* ignore */ }
  }

  const milestoneList = milestones.map((m, i) =>
    `${i + 1}. id="${m.id}" phase="${m.phase}" — ${m.text}${m.specPath ? ` (spec: ${rel(join(projectPath, m.specPath))})` : ''}`
  ).join('\n')

  return `Audit the following milestones against the codebase at: ${projectPath}

Key directories to explore: ${rootPaths.map(rel).join(', ')}

Milestones to audit (${milestones.length} total):
${milestoneList}

Use your Read and Bash tools to check each milestone. When done, output ONLY the JSON results array.`
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

export async function auditPhasePlan(
  projectPath: string,
  projectId: string
): Promise<MilestoneAuditResult[]> {
  const rawPlan = loadPhasePlan(projectPath)
  if (!rawPlan) throw new Error('No phase plan found — generate one first')

  const plan = syncCheckedState(projectPath, rawPlan)
  const unchecked = plan.milestones.filter((m) => !m.checked)
  const total = unchecked.length

  if (total === 0) {
    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'done',
      results: [],
      appliedCount: 0,
    })
    return []
  }

  const allResults: MilestoneAuditResult[] = []
  let appliedCount = 0
  const batches = chunk(unchecked, BATCH_SIZE)

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    const checkedSoFar = i * BATCH_SIZE

    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'running',
      checked: checkedSoFar,
      total,
      currentMilestone: batch[0]!.text,
    })

    const prompt = buildAuditPrompt(projectPath, batch)
    const result = await runStandaloneTurn({
      cwd: projectPath,
      projectId,
      prompt,
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      allowedTools: ['Read', 'Bash'],
      appendSystemPrompt: AUDITOR_SYSTEM_PROMPT,
      maxTurns: 30,
    })

    const batchResults = extractJson<MilestoneAuditResult[]>(result.assistantText) ?? []

    // Validate and filter to only results that match input milestone IDs
    const validIds = new Set(batch.map((m) => m.id))
    const validated = batchResults.filter(
      (r) =>
        validIds.has(r.id) &&
        ['complete', 'partial', 'not-started'].includes(r.status) &&
        ['high', 'medium', 'low'].includes(r.confidence)
    )

    // For any milestones Claude didn't return, emit not-started with low confidence
    const returnedIds = new Set(validated.map((r) => r.id))
    for (const m of batch) {
      if (!returnedIds.has(m.id)) {
        validated.push({ id: m.id, status: 'not-started', confidence: 'low', evidence: 'No result returned by auditor' })
      }
    }

    allResults.push(...validated)

    // Apply completed milestones to GOALS.md + phase-plan.json immediately
    for (const r of validated) {
      if (r.status === 'complete' && r.confidence !== 'low') {
        markMilestoneComplete(projectPath, r.id)
        appliedCount++
      }
    }
  }

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'done',
    results: allResults,
    appliedCount,
  })

  return allResults
}
