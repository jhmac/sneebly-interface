import { join, relative } from 'path'
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import type { ChildProcess } from 'child_process'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { loadPhasePlan, syncCheckedState, markMilestoneComplete } from './phase-tracker'
import { sendToProjectWindows } from './window-registry'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { MilestoneAuditResult, OrderedMilestone } from '../../shared/types'

// Max bytes of source content to inject (keeps prompt inside context window)
const MAX_SOURCE_BYTES = 180_000

const AUDITOR_SYSTEM_PROMPT = `You are a codebase auditor. You will receive source code files and a list of milestones. For each milestone, determine its implementation status based solely on the provided source code.

Status definitions:
- "complete": Feature is fully implemented end-to-end (real logic, not just a UI shell, stub, or placeholder)
- "partial": Some real implementation exists but key parts are missing (UI exists but no API wiring, stub functions, mock data only)
- "not-started": No meaningful implementation found

Confidence:
- "high": You found clear, direct code that implements the feature
- "medium": You found related code but could not trace the full feature path
- "low": You are inferring from file names or indirect evidence only

Output ONLY a JSON array — no prose, no markdown fences, nothing else:
[
  { "id": "...", "status": "complete|partial|not-started", "confidence": "high|medium|low", "evidence": "one sentence" },
  ...
]
One entry per milestone, in the same order as the input list.`

// Active process per project for abort support
const activeProcs = new Map<string, ChildProcess>()
const abortFlags = new Map<string, boolean>()

export function stopAudit(projectId: string): void {
  abortFlags.set(projectId, true)
  const proc = activeProcs.get(projectId)
  if (proc) {
    try { proc.kill() } catch { /* already dead */ }
    activeProcs.delete(projectId)
  }
}

function collectSourceContent(projectPath: string): string {
  // Priority order: API routes > feature pages > feature components > libs
  const priorityGlobs = [
    'artifacts/api-server/src/routes',
    'artifacts/api-server/src/lib',
    'artifacts/api-server/src/middlewares',
    'artifacts/nyous/src/pages',
    'artifacts/nyous/src/hooks',
    'artifacts/nyous/src/lib',
    'artifacts/nyous/src/components',
    'src/routes',
    'src/pages',
    'src/lib',
    'src/components',
    'src/hooks',
  ]

  // Collect all candidate files in priority order
  let candidates: string[] = []
  try {
    const raw = execSync(
      `find . -type f \\( -name "*.ts" -o -name "*.tsx" \\) | grep -v "node_modules\\|\\.next\\|dist\\|\\.vite\\|\\.git\\|/ui/\\|__pycache__\\|\\.migration" | sort`,
      { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const allFiles = raw.trim().split('\n').filter(Boolean)

    // Sort by priority
    const scored = allFiles.map((f) => {
      const score = priorityGlobs.findIndex((g) => f.includes(g.replace(/\//g, '/')))
      return { f, score: score === -1 ? 99 : score }
    })
    scored.sort((a, b) => a.score - b.score)
    candidates = scored.map((x) => x.f)
  } catch {
    return ''
  }

  const parts: string[] = []
  let totalBytes = 0

  for (const relPath of candidates) {
    const absPath = join(projectPath, relPath)
    if (!existsSync(absPath)) continue
    try {
      const content = readFileSync(absPath, 'utf-8')
      const entry = `\n\n=== ${relPath} ===\n${content}`
      if (totalBytes + entry.length > MAX_SOURCE_BYTES) {
        parts.push(`\n\n(remaining files omitted — ${candidates.length - parts.length} more)`)
        break
      }
      parts.push(entry)
      totalBytes += entry.length
    } catch { /* skip unreadable */ }
  }

  return parts.join('')
}

function buildAuditPrompt(
  projectPath: string,
  milestones: OrderedMilestone[],
  sourceContent: string
): string {
  const milestoneList = milestones
    .map((m, i) => `${i + 1}. id="${m.id}" — ${m.text}`)
    .join('\n')

  return `Project path: ${projectPath}

SOURCE CODE:
${sourceContent}

---

MILESTONES TO AUDIT (${milestones.length} total):
${milestoneList}

Based on the source code above, determine the implementation status of each milestone.
Output ONLY the JSON array.`
}

export async function auditPhasePlan(
  projectPath: string,
  projectId: string
): Promise<MilestoneAuditResult[]> {
  const rawPlan = loadPhasePlan(projectPath)
  if (!rawPlan) throw new Error('No phase plan found — generate one first')

  const plan = syncCheckedState(projectPath, rawPlan)
  const milestones = plan.milestones
  const total = milestones.length

  abortFlags.set(projectId, false)

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'running',
    checked: 0,
    total,
    currentMilestone: 'Reading source files…',
  })

  // Collect all source content in main process — no Claude tool calls needed
  const sourceContent = collectSourceContent(projectPath)

  if (abortFlags.get(projectId)) {
    abortFlags.delete(projectId)
    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'done',
      results: [],
      appliedCount: 0,
    })
    return []
  }

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'running',
    checked: 0,
    total,
    currentMilestone: `Analyzing ${total} milestones…`,
  })

  const prompt = buildAuditPrompt(projectPath, milestones, sourceContent)

  const result = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    allowedTools: [],   // no tools — source is already in the prompt
    appendSystemPrompt: AUDITOR_SYSTEM_PROMPT,
    maxTurns: 1,
    onProcess: (proc) => { activeProcs.set(projectId, proc) },
  })

  activeProcs.delete(projectId)
  abortFlags.delete(projectId)

  const raw = extractJson<MilestoneAuditResult[]>(result.assistantText) ?? []

  const validIds = new Set(milestones.map((m) => m.id))
  const validated = raw.filter(
    (r) =>
      validIds.has(r.id) &&
      ['complete', 'partial', 'not-started'].includes(r.status) &&
      ['high', 'medium', 'low'].includes(r.confidence)
  )

  // Fill any milestones Claude didn't return
  const returnedIds = new Set(validated.map((r) => r.id))
  for (const m of milestones) {
    if (!returnedIds.has(m.id)) {
      validated.push({
        id: m.id,
        status: 'not-started',
        confidence: 'low',
        evidence: result.error ? `Auditor error: ${result.error}` : 'Not returned by auditor',
      })
    }
  }

  let appliedCount = 0
  for (const r of validated) {
    if (r.status === 'complete' && r.confidence !== 'low') {
      markMilestoneComplete(projectPath, r.id)
      appliedCount++
    }
  }

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'done',
    results: validated,
    appliedCount,
  })

  return validated
}
