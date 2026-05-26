import { join } from 'path'
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import type { ChildProcess } from 'child_process'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { loadPhasePlan, syncCheckedState, markMilestoneComplete } from './phase-tracker'
import { sendToProjectWindows } from './window-registry'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { MilestoneAuditResult, OrderedMilestone } from '../../shared/types'

const MAX_SOURCE_BYTES = 180_000

// Wrapped object format so extractJson (which hunts for '{') reliably finds
// a top-level object rather than the first array element.
interface AuditResponse {
  milestones: MilestoneAuditResult[]
}

const AUDITOR_SYSTEM_PROMPT = `You are a codebase auditor. You will receive source code files and a list of milestones. For each milestone, determine its implementation status based solely on the provided source code.

Status definitions:
- "complete": Feature is fully implemented end-to-end with real logic (not just a UI shell, stub, or mock data)
- "partial": Some real implementation exists but key parts are missing (e.g. UI exists but no API wiring, stub functions only)
- "not-started": No meaningful implementation found

Confidence:
- "high": You found clear, direct code implementing the feature
- "medium": You found related code but could not trace the full feature path
- "low": You are inferring from file names or indirect evidence only

Output ONLY a JSON object — no prose, no markdown fences, nothing else:
{
  "milestones": [
    { "id": "...", "status": "complete|partial|not-started", "confidence": "high|medium|low", "evidence": "one sentence" },
    ...
  ]
}
One entry per milestone, in the same order as the input list.`

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

// Score a file path by how informative it is for auditing.
// Lower score = higher priority.
function fileScore(relPath: string): number {
  const p = relPath.toLowerCase()
  if (p.includes('/routes/')) return 0
  if (p.includes('/pages/')) return 1
  if (p.includes('/hooks/')) return 2
  if (p.includes('/lib/')) return 3
  if (p.includes('/middleware') || p.includes('/middlewares/')) return 4
  if (p.includes('/components/')) return 5
  if (p.includes('/services/')) return 6
  if (p.includes('/utils/')) return 7
  return 10
}

function collectSourceContent(projectPath: string): { content: string; fileCount: number } {
  let allFiles: string[] = []
  try {
    const raw = execSync(
      // Exclude: node_modules, build output, shadcn ui barrel, git, migration backups
      `find . -type f \\( -name "*.ts" -o -name "*.tsx" \\) ` +
      `| grep -v "node_modules\\|\\.next\\|/dist/\\|\\.vite\\|\\.git\\|/components/ui/\\|__pycache__\\|\\.migration\\|migration-backup"` +
      `| sort`,
      { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    allFiles = raw.trim().split('\n').filter(Boolean)
  } catch {
    return { content: '', fileCount: 0 }
  }

  // Sort by informativeness
  allFiles.sort((a, b) => fileScore(a) - fileScore(b))

  const parts: string[] = []
  let totalBytes = 0

  for (const relPath of allFiles) {
    const absPath = join(projectPath, relPath)
    if (!existsSync(absPath)) continue
    try {
      const content = readFileSync(absPath, 'utf-8')
      const entry = `\n\n=== ${relPath} ===\n${content}`
      if (totalBytes + entry.length > MAX_SOURCE_BYTES) {
        parts.push(`\n\n(${allFiles.length - parts.length} more files omitted due to size limit)`)
        break
      }
      parts.push(entry)
      totalBytes += entry.length
    } catch { /* skip unreadable */ }
  }

  return { content: parts.join(''), fileCount: parts.length }
}

function buildAuditPrompt(
  milestones: OrderedMilestone[],
  sourceContent: string
): string {
  const milestoneList = milestones
    .map((m, i) => `${i + 1}. id="${m.id}" — ${m.text}`)
    .join('\n')

  return `SOURCE CODE:
${sourceContent}

---

MILESTONES TO AUDIT (${milestones.length} total):
${milestoneList}

Based on the source code above, output ONLY the JSON object with a "milestones" array.`
}

export async function auditPhasePlan(
  projectPath: string,
  projectId: string
): Promise<MilestoneAuditResult[]> {
  const rawPlan = loadPhasePlan(projectPath)
  if (!rawPlan) throw new Error('No phase plan found — generate one first')

  const plan = syncCheckedState(projectPath, rawPlan)
  // Only audit milestones that aren't already checked
  const unchecked = plan.milestones.filter((m) => !m.checked)
  const total = plan.milestones.length

  abortFlags.set(projectId, false)

  if (unchecked.length === 0) {
    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'done', results: [], appliedCount: 0,
    })
    return []
  }

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'running', checked: 0, total, currentMilestone: 'Reading source files…',
  })

  const { content: sourceContent, fileCount } = collectSourceContent(projectPath)

  if (!sourceContent) {
    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'done', results: [], appliedCount: 0,
    })
    throw new Error('Could not collect source files from project')
  }

  if (abortFlags.get(projectId)) {
    abortFlags.delete(projectId)
    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'done', results: [], appliedCount: 0,
    })
    return []
  }

  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
    stage: 'running',
    checked: 0,
    total,
    currentMilestone: `Analyzing ${unchecked.length} milestones across ${fileCount} files…`,
  })

  const prompt = buildAuditPrompt(unchecked, sourceContent)

  const result = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    // Explicitly disable all tools — source is injected; tool calls would
    // waste the single turn budget before Claude can output the JSON.
    extraArgs: ['--tools', ''],
    appendSystemPrompt: AUDITOR_SYSTEM_PROMPT,
    maxTurns: 1,
    onProcess: (proc) => { activeProcs.set(projectId, proc) },
  })

  activeProcs.delete(projectId)
  abortFlags.delete(projectId)

  if (result.error && !result.assistantText) {
    sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_AUDIT_PROGRESS, {
      stage: 'done', results: [], appliedCount: 0,
    })
    throw new Error(`Auditor subprocess failed: ${result.error}`)
  }

  // Parse the wrapped object: { "milestones": [...] }
  // extractJson uses brace-counting so it reliably finds the top-level object
  // even when surrounded by prose or other text.
  let rawResults: MilestoneAuditResult[] = []
  const text = result.assistantText
  const wrapper = extractJson<AuditResponse>(text)
  if (wrapper && !Array.isArray(wrapper) && Array.isArray(wrapper.milestones)) {
    rawResults = wrapper.milestones
  } else {
    // Fallback: bare array (in case Claude ignored the wrapper instruction)
    const arrMatch = text.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try {
        const parsed = JSON.parse(arrMatch[0])
        if (Array.isArray(parsed)) rawResults = parsed as MilestoneAuditResult[]
      } catch { /* ignore */ }
    }
  }

  const validIds = new Set(unchecked.map((m) => m.id))
  const validated = rawResults.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      validIds.has(r.id) &&
      ['complete', 'partial', 'not-started'].includes(r.status) &&
      ['high', 'medium', 'low'].includes(r.confidence)
  )

  // Fill any milestones Claude didn't return
  const returnedIds = new Set(validated.map((r) => r.id))
  for (const m of unchecked) {
    if (!returnedIds.has(m.id)) {
      validated.push({
        id: m.id,
        status: 'not-started',
        confidence: 'low',
        evidence: rawResults.length === 0
          ? 'Auditor returned no parseable JSON'
          : 'Not included in auditor response',
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
    parseError: rawResults.length === 0,
  })

  return validated
}
