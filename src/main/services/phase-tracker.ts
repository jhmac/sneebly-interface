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

// Re-reads GOALS.md checkboxes and updates the plan's checked states in place.
export function syncCheckedState(projectPath: string, plan: PhasePlan): PhasePlan {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return plan

  try {
    const goalsMd = readFileSync(goalsPath, 'utf-8')
    const milestones = parseMilestones(goalsMd)

    // Build a lookup: normalized text → checked
    const checkedByText = new Map<string, boolean>()
    for (const m of milestones) {
      checkedByText.set(normalizeText(m.text), m.checked)
    }

    const updated: OrderedMilestone[] = plan.milestones.map((m) => {
      const checked = checkedByText.get(normalizeText(m.text))
      return checked !== undefined ? { ...m, checked } : m
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
      const lineText = normalizeText(m[3]!.replace(/\[.*?\]\(.*?\)/g, '').trim())
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

export function getNextMilestone(plan: PhasePlan): OrderedMilestone | null {
  return plan.milestones.find((m) => !m.checked) ?? null
}

export function getMilestoneById(plan: PhasePlan, id: string): OrderedMilestone | null {
  return plan.milestones.find((m) => m.id === id) ?? null
}

export interface PhaseSummary {
  phaseNumber: number
  phaseName: string
  total: number
  completed: number
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

  const firstIncomplete = plan.milestones.find((m) => !m.checked)?.phaseNumber

  return Array.from(byPhase.entries()).map(([num, { name, milestones }]) => ({
    phaseNumber: num,
    phaseName: name,
    total: milestones.length,
    completed: milestones.filter((m) => m.checked).length,
    active: num === firstIncomplete,
  }))
}
