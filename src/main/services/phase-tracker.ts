import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { parseMilestones } from './spec/milestone-parser'
import type { PhasePlan, OrderedMilestone } from '../../shared/types'

function sneeblyDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface')
}

function planPath(projectPath: string): string {
  return join(sneeblyDir(projectPath), 'phase-plan.json')
}

export function loadPhasePlan(projectPath: string): PhasePlan | null {
  const p = planPath(projectPath)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PhasePlan
  } catch {
    return null
  }
}

export function savePhasePlan(projectPath: string, plan: PhasePlan): void {
  const dir = sneeblyDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(planPath(projectPath), JSON.stringify(plan, null, 2), 'utf-8')
}

// Matches "(skipped)" or "(skipped: reason)" — used for GOALS.md line-level edits.
const SKIP_ANNOTATION_RE = /\s*\(skipped(?::\s*([^)]*))?\)/i

// Re-reads GOALS.md checkboxes and updates the plan's checked + skipped states.
export function syncCheckedState(projectPath: string, plan: PhasePlan): PhasePlan {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return plan

  try {
    const goalsMd = readFileSync(goalsPath, 'utf-8')
    const milestones = parseMilestones(goalsMd)

    // Build a lookup: normalized text → { checked, skipped, skipReason }
    type MilestoneState = { checked: boolean; skipped: boolean; skipReason?: string }
    const stateByText = new Map<string, MilestoneState>()
    for (const m of milestones) {
      stateByText.set(normalizeText(m.text), {
        checked: m.checked,
        skipped: m.skipped,
        skipReason: m.skipReason,
      })
    }

    const updated: OrderedMilestone[] = plan.milestones.map((m) => {
      const state = stateByText.get(normalizeText(m.text))
      if (state === undefined) return m
      return { ...m, checked: state.checked, skipped: state.skipped, skipReason: state.skipReason }
    })

    return { ...plan, milestones: updated }
  } catch {
    return plan
  }
}

function normalizeText(text: string): string {
  // Strip markdown links [text](url) first, then bare [text] brackets
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[.*?\]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// Mark a milestone complete in both GOALS.md and the plan file.
export function markMilestoneComplete(projectPath: string, milestoneId: string): PhasePlan | null {
  const plan = loadPhasePlan(projectPath)
  if (!plan) return null

  const milestone = plan.milestones.find((m) => m.id === milestoneId)
  if (!milestone) return plan

  // Update GOALS.md checkbox
  updateGoalsCheckbox(projectPath, milestone.text, true)

  // Update plan
  const updated: PhasePlan = {
    ...plan,
    milestones: plan.milestones.map((m) =>
      m.id === milestoneId ? { ...m, checked: true } : m
    ),
  }
  savePhasePlan(projectPath, updated)
  return updated
}

function updateGoalsCheckbox(projectPath: string, milestoneText: string, checked: boolean): void {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return
  try {
    const content = readFileSync(goalsPath, 'utf-8')
    const cleanText = normalizeText(milestoneText)
    const lines = content.split('\n')
    let updated = false
    const newLines = lines.map((line) => {
      const m = line.match(/^(\s*-\s*)\[([ xX])\]\s+(.*)$/)
      if (!m) return line
      const lineText = normalizeText(m[3]!.replace(/\[.*?\]\(.*?\)/g, '').replace(SKIP_ANNOTATION_RE, '').trim())
      if (lineText === cleanText) {
        updated = true
        return `${m[1]}[${checked ? 'x' : ' '}] ${m[3]}`
      }
      return line
    })
    if (updated) {
      writeFileSync(goalsPath, newLines.join('\n'), 'utf-8')
    }
  } catch (e) {
    console.error('[phase-tracker] failed to update GOALS.md checkbox:', e)
  }
}

// Line-level edit: add or remove "(skipped)" / "(skipped: reason)" annotation.
// Preserves the rest of the file exactly — does not re-serialize through the parser.
function updateGoalsSkipped(
  projectPath: string,
  milestoneText: string,
  skipped: boolean,
  skipReason?: string,
): void {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return
  try {
    const content = readFileSync(goalsPath, 'utf-8')
    const cleanText = normalizeText(milestoneText)
    const lines = content.split('\n')
    let updated = false
    const newLines = lines.map((line) => {
      const m = line.match(/^(\s*-\s*\[[ xX]\]\s+)(.+)$/)
      if (!m) return line
      // Strip any existing skip annotation before matching text
      const lineRaw = m[2]!
      const lineNormalized = normalizeText(lineRaw.replace(SKIP_ANNOTATION_RE, '').trim())
      if (lineNormalized !== cleanText) return line
      updated = true
      const lineWithoutSkip = lineRaw.replace(SKIP_ANNOTATION_RE, '').trim()
      if (!skipped) return `${m[1]}${lineWithoutSkip}`
      const annotation = skipReason ? ` (skipped: ${skipReason})` : ` (skipped)`
      return `${m[1]}${lineWithoutSkip}${annotation}`
    })
    if (updated) {
      writeFileSync(goalsPath, newLines.join('\n'), 'utf-8')
    }
  } catch (e) {
    console.error('[phase-tracker] failed to update GOALS.md skip annotation:', e)
  }
}

// Mark a milestone as skipped in GOALS.md and the phase plan.
export function markMilestoneSkipped(
  projectPath: string,
  milestoneId: string,
  reason?: string,
): PhasePlan | null {
  const plan = loadPhasePlan(projectPath)
  if (!plan) return null

  const milestone = plan.milestones.find((m) => m.id === milestoneId)
  if (!milestone) return plan

  updateGoalsSkipped(projectPath, milestone.text, true, reason)

  const updated: PhasePlan = {
    ...plan,
    milestones: plan.milestones.map((m) =>
      m.id === milestoneId ? { ...m, skipped: true, skipReason: reason } : m
    ),
  }
  savePhasePlan(projectPath, updated)
  return updated
}

// Remove the "(skipped)" annotation from GOALS.md and the phase plan.
export function unmarkMilestoneSkipped(
  projectPath: string,
  milestoneId: string,
): PhasePlan | null {
  const plan = loadPhasePlan(projectPath)
  if (!plan) return null

  const milestone = plan.milestones.find((m) => m.id === milestoneId)
  if (!milestone) return plan

  updateGoalsSkipped(projectPath, milestone.text, false)

  const updated: PhasePlan = {
    ...plan,
    milestones: plan.milestones.map((m) => {
      if (m.id !== milestoneId) return m
      const { skipReason: _, ...rest } = m
      void _
      return { ...rest, skipped: false }
    }),
  }
  savePhasePlan(projectPath, updated)
  return updated
}

export function getNextMilestone(plan: PhasePlan): OrderedMilestone | null {
  return plan.milestones.find((m) => !m.checked && !m.skipped) ?? null
}

export function getMilestoneById(plan: PhasePlan, id: string): OrderedMilestone | null {
  return plan.milestones.find((m) => m.id === id) ?? null
}

export interface PhaseSummary {
  phaseNumber: number
  phaseName: string
  total: number
  completed: number
  skipped: number
  active: boolean
}

export function getPhaseSummaries(plan: PhasePlan): PhaseSummary[] {
  const byPhase = new Map<number, { name: string; milestones: OrderedMilestone[] }>()

  // Sort milestones by phase number to ensure consistent ordering
  const sorted = [...plan.milestones].sort(
    (a, b) => a.phaseNumber !== b.phaseNumber
      ? a.phaseNumber - b.phaseNumber
      : a.buildOrder - b.buildOrder
  )

  for (const m of sorted) {
    if (!byPhase.has(m.phaseNumber)) {
      const namePart = m.phase.replace(/^Phase\s+\d+:?\s*/i, '').trim()
      byPhase.set(m.phaseNumber, { name: namePart, milestones: [] })
    }
    byPhase.get(m.phaseNumber)!.milestones.push(m)
  }

  const firstIncomplete = plan.milestones.find((m) => !m.checked && !m.skipped)?.phaseNumber

  return Array.from(byPhase.entries()).map(([num, { name, milestones }]) => ({
    phaseNumber: num,
    phaseName: name,
    total: milestones.length,
    completed: milestones.filter((m) => m.checked).length,
    skipped: milestones.filter((m) => m.skipped).length,
    active: num === firstIncomplete,
  }))
}
