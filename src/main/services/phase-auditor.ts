import { join, relative } from 'path'
import { execSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { loadPhasePlan, syncCheckedState, markMilestoneComplete } from './phase-tracker'
import { sendToProjectWindows } from './window-registry'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { MilestoneAuditResult, OrderedMilestone } from '../../shared/types'

const BATCH_SIZE = 6
const MAX_TURNS = 50

// Per-project abort controller: set to true to cancel the running audit loop
const abortFlags = new Map<string, boolean>()
// The currently running subprocess for a project (so we can kill it immediately)
const activeProcs = new Map<string, ChildProcess>()

export function stopAudit(projectId: string): void {
  abortFlags.set(projectId, true)
  const proc = activeProcs.get(projectId)
  if (proc) {
    try { proc.kill() } catch { /* already dead */ }
    activeProcs.delete(projectId)
  }
}

const AUDITOR_SYSTEM_PROMPT = `You are auditing a software project codebase to determine which features from a milestone checklist are already implemented.

You will be given:
1. A list of source files in the project (pre-collected for you)
2. A small batch of milestones to audit

For each milestone, use your Read and Bash tools to investigate:
- Read specific files that look relevant based on the file list
- Use Bash to grep for keywords, function names, or route patterns
- Focus on implementation depth: scaffolded/stubbed UI does NOT count as "complete"

Status definitions:
- "complete": Feature is fully implemented end-to-end with real logic (not just UI shell or placeholder)
- "partial": Some real implementation exists but key parts are missing (e.g. UI exists but no API, or stub functions)
- "not-started": No meaningful implementation found

Confidence:
- "high": You read the actual implementation files and confirmed the feature works end-to-end
- "medium": You found relevant files and code but did not trace every path
- "low": You are inferring from file names or partial reads only

After checking ALL milestones in the batch, output ONLY a JSON array — no prose, no markdown fences:
[
  { "id": "...", "status": "complete|partial|not-started", "confidence": "high|medium|low", "evidence": "one sentence" },
  ...
]
One entry per milestone, in the same order as the input.`

function collectFileTree(projectPath: string): string {
  try {
    const out = execSync(
      `find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.sql" \\) | grep -v "node_modules\\|\\.next\\|dist\\|\\.vite\\|\\.git\\|__pycache__" | sort | head -300`,
      { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return out.trim()
  } catch {
    return '(could not collect file tree)'
  }
}

function buildAuditPrompt(
  projectPath: string,
  milestones: OrderedMilestone[],
  fileTree: string
): string {
  const rel = (p: string) => relative(projectPath, p)
  const milestoneList = milestones
    .map((m, i) =>
      `${i + 1}. id="${m.id}" — ${m.text}${m.specPath ? ` (spec: ${rel(join(projectPath, m.specPath))})` : ''}`
    )
    .join('\n')

  return `Audit these ${milestones.length} milestones against the codebase at: ${projectPath}

PROJECT SOURCE FILES:
${fileTree}

MILESTONES TO AUDIT:
${milestoneList}

Use Read and Bash to investigate each milestone. The file list above is your map — read files that look relevant.
When done with ALL ${milestones.length} milestones, output ONLY the JSON array.`
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

  // Collect file tree once for all batches
  const fileTree = collectFileTree(projectPath)

  abortFlags.set(projectId, false)

  const allResults: MilestoneAuditResult[] = []
  let appliedCount = 0
  const batches = chunk(unchecked, BATCH_SIZE)

  for (let i = 0; i < batches.length; i++) {
    if (abortFlags.get(projectId)) break

    const batch = batches[i]!
    const checkedSoFar = i * BATCH_SIZE

    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'running',
      checked: checkedSoFar,
      total,
      currentMilestone: batch[0]!.text,
    })

    const prompt = buildAuditPrompt(projectPath, batch, fileTree)
    const result = await runStandaloneTurn({
      cwd: projectPath,
      projectId,
      prompt,
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      allowedTools: ['Read', 'Bash'],
      appendSystemPrompt: AUDITOR_SYSTEM_PROMPT,
      maxTurns: MAX_TURNS,
      onProcess: (proc) => { activeProcs.set(projectId, proc) },
    })

    const batchResults = extractJson<MilestoneAuditResult[]>(result.assistantText) ?? []

    const validIds = new Set(batch.map((m) => m.id))
    const validated = batchResults.filter(
      (r) =>
        validIds.has(r.id) &&
        ['complete', 'partial', 'not-started'].includes(r.status) &&
        ['high', 'medium', 'low'].includes(r.confidence)
    )

    // Fill in any milestones Claude didn't return
    const returnedIds = new Set(validated.map((r) => r.id))
    for (const m of batch) {
      if (!returnedIds.has(m.id)) {
        validated.push({
          id: m.id,
          status: 'not-started',
          confidence: 'low',
          evidence: result.error
            ? `Auditor error: ${result.error}`
            : 'No result returned — auditor may have hit turn limit',
        })
      }
    }

    activeProcs.delete(projectId)

    allResults.push(...validated)

    // Auto-check milestones Claude confirmed complete with high or medium confidence
    for (const r of validated) {
      if (r.status === 'complete' && r.confidence !== 'low') {
        markMilestoneComplete(projectPath, r.id)
        appliedCount++
      }
    }
  }

  abortFlags.delete(projectId)

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'done',
    results: allResults,
    appliedCount,
  })

  return allResults
}
