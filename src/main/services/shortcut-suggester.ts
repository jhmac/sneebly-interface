import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import type { Shortcut, ShortcutAction, ShortcutsFile, MilestoneRef, SemanticEvent } from '../../shared/types'
import { readEventsForDateRange } from './event-stream'
import { parseMilestones } from './spec/milestone-parser'

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const REJECTION_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000
const DECAY_DAYS = 3
const MAX_SUGGESTED = 2
const MIN_READ_COUNT = 2

function sneeblyDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface')
}

function shortcutsPath(projectPath: string): string {
  return join(sneeblyDir(projectPath), 'shortcuts.json')
}

function emptyFile(): ShortcutsFile {
  return { pinned: [], suggested: [], lastRefreshedAt: 0, rejections: [] }
}

export function loadShortcutsFile(projectPath: string): ShortcutsFile {
  const p = shortcutsPath(projectPath)
  if (!existsSync(p)) return emptyFile()
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ShortcutsFile
  } catch {
    return emptyFile()
  }
}

export function saveShortcutsFile(projectPath: string, file: ShortcutsFile): void {
  const dir = sneeblyDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(shortcutsPath(projectPath), JSON.stringify(file, null, 2), 'utf-8')
}

function actionPatternId(action: ShortcutAction): string {
  switch (action.kind) {
    case 'open-file': return `open-file::${action.path}`
    case 'select-skill': return `select-skill::${action.skillId}`
    case 'refine-spec': return `refine-spec::${action.milestoneId}`
  }
}

function isRejected(file: ShortcutsFile, pid: string): boolean {
  const r = file.rejections.find((rej) => rej.patternId === pid)
  if (!r) return false
  return Date.now() - r.rejectedAt < REJECTION_COOLDOWN_MS
}

function isPinned(file: ShortcutsFile, pid: string): boolean {
  return file.pinned.some((s) => actionPatternId(s.action) === pid)
}

function decayScore(occurrences: number, lastUsedMs: number): number {
  const daysSince = Math.max(0, (Date.now() - lastUsedMs) / (1000 * 60 * 60 * 24))
  return occurrences * Math.exp(-daysSince / DECAY_DAYS)
}

interface Candidate {
  action: ShortcutAction
  label: string
  icon: string
  occurrences: number
  lastUsedMs: number
}

function loadMilestones(projectPath: string): MilestoneRef[] {
  try {
    const goalsPath = join(projectPath, 'GOALS.md')
    if (!existsSync(goalsPath)) return []
    return parseMilestones(readFileSync(goalsPath, 'utf-8'))
  } catch {
    return []
  }
}

function buildCandidates(projectPath: string, events: SemanticEvent[]): Candidate[] {
  const fileReads = new Map<string, { count: number; lastMs: number }>()
  const skillUses = new Map<string, { count: number; lastMs: number }>()
  const specEdits = new Map<string, { count: number; lastMs: number }>()

  const milestones = loadMilestones(projectPath)
  const specBaseToMilestoneId = new Map<string, string>()
  for (const m of milestones) {
    if (m.specPath) specBaseToMilestoneId.set(basename(m.specPath), m.id)
  }

  for (const event of events) {
    if (event.kind === 'tool_call') {
      const toolName = event.payload['toolName'] as string | undefined
      const args = event.payload['args'] as Record<string, unknown> | undefined
      const filePath = String(args?.['file_path'] ?? '')

      if (toolName === 'Read' && filePath) {
        if (!filePath.includes('node_modules') && !filePath.includes('.sneebly-interface')) {
          const cur = fileReads.get(filePath) ?? { count: 0, lastMs: 0 }
          fileReads.set(filePath, { count: cur.count + 1, lastMs: Math.max(cur.lastMs, event.ts) })
        }
      }

      if ((toolName === 'Edit' || toolName === 'Write') && filePath) {
        const name = basename(filePath)
        const milestoneId = specBaseToMilestoneId.get(name)
        if (milestoneId) {
          const cur = specEdits.get(milestoneId) ?? { count: 0, lastMs: 0 }
          specEdits.set(milestoneId, { count: cur.count + 1, lastMs: Math.max(cur.lastMs, event.ts) })
        }
      }
    }

    if (event.kind === 'skill_selected') {
      const skillId = String(event.payload['skillId'] ?? '')
      if (skillId) {
        const cur = skillUses.get(skillId) ?? { count: 0, lastMs: 0 }
        skillUses.set(skillId, { count: cur.count + 1, lastMs: Math.max(cur.lastMs, event.ts) })
      }
    }
  }

  const candidates: Candidate[] = []

  for (const [path, { count, lastMs }] of fileReads) {
    if (count < MIN_READ_COUNT) continue
    candidates.push({
      action: { kind: 'open-file', path },
      label: basename(path),
      icon: 'file',
      occurrences: count,
      lastUsedMs: lastMs,
    })
  }

  for (const [skillId, { count, lastMs }] of skillUses) {
    candidates.push({
      action: { kind: 'select-skill', skillId },
      label: skillId,
      icon: 'zap',
      occurrences: count,
      lastUsedMs: lastMs,
    })
  }

  for (const [milestoneId, { count, lastMs }] of specEdits) {
    const milestone = milestones.find((m) => m.id === milestoneId)
    if (!milestone) continue
    const labelText = milestone.text.length > 30 ? milestone.text.slice(0, 30) + '…' : milestone.text
    candidates.push({
      action: { kind: 'refine-spec', milestoneId },
      label: labelText,
      icon: 'file-code',
      occurrences: count,
      lastUsedMs: lastMs,
    })
  }

  return candidates
}

export function refreshShortcuts(projectPath: string): ShortcutsFile {
  const file = loadShortcutsFile(projectPath)
  const fromTs = Date.now() - LOOKBACK_MS
  const events = readEventsForDateRange(projectPath, fromTs, Date.now())

  const candidates = buildCandidates(projectPath, events)

  const eligible = candidates.filter((c) => {
    const pid = actionPatternId(c.action)
    return !isRejected(file, pid) && !isPinned(file, pid)
  })

  const scored = eligible
    .map((c) => ({ ...c, score: decayScore(c.occurrences, c.lastUsedMs) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTED)

  const suggested: Shortcut[] = scored.map((c) => ({
    id: crypto.randomUUID(),
    label: c.label,
    icon: c.icon,
    action: c.action,
    reason: `Used ${c.occurrences} time${c.occurrences !== 1 ? 's' : ''} recently`,
    pinned: false,
    createdAt: Date.now(),
    lastSuggestedAt: Date.now(),
  }))

  const updated: ShortcutsFile = { ...file, suggested, lastRefreshedAt: Date.now() }
  saveShortcutsFile(projectPath, updated)
  return updated
}

export function refreshIfStale(projectPath: string): ShortcutsFile {
  const file = loadShortcutsFile(projectPath)
  if (Date.now() - file.lastRefreshedAt < REFRESH_INTERVAL_MS) return file
  return refreshShortcuts(projectPath)
}

export function pinShortcut(projectPath: string, id: string): ShortcutsFile {
  const file = loadShortcutsFile(projectPath)
  const shortcut = file.suggested.find((s) => s.id === id)
  if (!shortcut) return file

  const updated: ShortcutsFile = {
    ...file,
    pinned: [...file.pinned, { ...shortcut, pinned: true }],
    suggested: file.suggested.filter((s) => s.id !== id),
  }
  saveShortcutsFile(projectPath, updated)
  return updated
}

export function unpinShortcut(projectPath: string, id: string): ShortcutsFile {
  const file = loadShortcutsFile(projectPath)
  // Search both collections — the same operation (remove + add to rejections) applies
  // whether the user removes a pinned shortcut or dismisses a suggested one.
  const shortcut = file.pinned.find((s) => s.id === id) ?? file.suggested.find((s) => s.id === id)
  if (!shortcut) return file

  const pid = actionPatternId(shortcut.action)
  const updated: ShortcutsFile = {
    ...file,
    pinned: file.pinned.filter((s) => s.id !== id),
    suggested: file.suggested.filter((s) => s.id !== id),
    rejections: [
      ...file.rejections.filter((r) => r.patternId !== pid),
      { patternId: pid, rejectedAt: Date.now() },
    ],
  }
  saveShortcutsFile(projectPath, updated)
  return updated
}
