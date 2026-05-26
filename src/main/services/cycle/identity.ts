import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { GoalsMd, GoalsMilestone, GoalsPhase } from '../../../shared/types'

export type IdentityFiles = {
  soul: string
  agents: string
  goals: string
  heartbeat: string
  identity: string
}

export type HeartbeatConfig = {
  maxTurns: number
  maxThinkingTokens: number
  maxFilesPerCycle: number
  maxLinesPerCycle: number
  cycleTimeoutMs: number
  executionRetries: number
  planRetries: number
  specRetries: number
  minCooldownMs: number
  softCapPerDay: number
  hardCapPerDay: number
  deployedHealthTimeoutMs: number
  autoDiscardAfterDays: number
  notifyOnQueueDepth: number
}

export type IdentityConfig = {
  projectName: string
  tagline: string
  owner: string
  repository: string
  productionUrl: string
  healthEndpoint: string
}

export function readIdentityFiles(projectRoot: string): IdentityFiles {
  const read = (name: string) => {
    const p = join(projectRoot, name)
    if (!existsSync(p)) throw new Error(`Missing identity file: ${name}`)
    return readFileSync(p, 'utf8')
  }
  return {
    soul: read('SOUL.md'),
    agents: read('AGENTS.md'),
    goals: read('GOALS.md'),
    heartbeat: read('HEARTBEAT.md'),
    identity: read('IDENTITY.md'),
  }
}

export function computeChecksums(projectRoot: string): Record<string, string> {
  const files = ['SOUL.md', 'AGENTS.md', 'GOALS.md', 'HEARTBEAT.md', 'IDENTITY.md']
  const result: Record<string, string> = {}
  for (const f of files) {
    const p = join(projectRoot, f)
    if (!existsSync(p)) continue
    const content = readFileSync(p)
    result[f] = createHash('sha256').update(content).digest('hex')
  }
  return result
}

export function verifyChecksums(projectRoot: string): { ok: boolean; tampered: string[] } {
  const checksumPath = join(projectRoot, '.sneebly', 'checksums.json')
  if (!existsSync(checksumPath)) return { ok: true, tampered: [] }
  const stored = JSON.parse(readFileSync(checksumPath, 'utf8')) as Record<string, string>
  const current = computeChecksums(projectRoot)
  const tampered = Object.keys(stored).filter(f => stored[f] !== current[f])
  return { ok: tampered.length === 0, tampered }
}

export function saveChecksums(projectRoot: string): void {
  const sneeblyDir = join(projectRoot, '.sneebly')
  mkdirSync(sneeblyDir, { recursive: true })
  const checksums = computeChecksums(projectRoot)
  writeFileSync(join(sneeblyDir, 'checksums.json'), JSON.stringify(checksums, null, 2))
}

export function parseHeartbeat(content: string): HeartbeatConfig {
  const num = (pattern: RegExp, def: number): number => {
    const m = content.match(pattern)
    return m ? parseInt(m[1]!, 10) : def
  }
  return {
    maxTurns: num(/Max turns per Claude Code call\*\*:\s*(\d+)/, 30),
    maxThinkingTokens: num(/Max thinking tokens.*?\*\*:\s*(\d+)/, 8000),
    maxFilesPerCycle: num(/Max files modified per cycle\*\*:\s*(\d+)/, 10),
    maxLinesPerCycle: num(/Max lines changed per cycle\*\*:\s*(\d+)/, 500),
    cycleTimeoutMs: num(/Cycle timeout\*\*:\s*(\d+)/, 15) * 60 * 1000,
    executionRetries: num(/Execution failures\*\*:\s*(\d+)/, 1),
    planRetries: 0,
    specRetries: 0,
    minCooldownMs: num(/Min cooldown between cycles.*?:\s*(\d+)/, 15) * 60 * 1000,
    softCapPerDay: num(/Soft cap per project per day\*\*:\s*(\d+)/, 20),
    hardCapPerDay: num(/Hard cap per project per day\*\*:\s*(\d+)/, 40),
    deployedHealthTimeoutMs: num(/Deployed health timeout\*\*:\s*(\d+)/, 90) * 1000,
    autoDiscardAfterDays: num(/Auto-discard queued items after\*\*:\s*(\d+)/, 14),
    notifyOnQueueDepth: num(/Notify on queue depth\*\*:\s*(\d+)/, 5),
  }
}

export function parseIdentity(content: string): IdentityConfig {
  const field = (label: string): string => {
    const m = content.match(new RegExp(`## ${label}\\s*\\n\\s*\\n([^\\n]+)`))
    return m ? m[1]!.trim() : ''
  }
  return {
    projectName: field('Project Name'),
    tagline: field('Tagline'),
    owner: field('Owner'),
    repository: field('Repository'),
    productionUrl: field('Production URL'),
    healthEndpoint: field('Health Endpoint'),
  }
}

// Re-export path-safety parsers for callers that import from identity
export { parseSafePaths, parseProtectedPaths } from './path-safety'

// ── GOALS.md parsing → GoalsMd (shared type used by the renderer) ──────────

// A Roadmap line counts as a bullet if it starts with "-", "*", "+", or "1." then
// whitespace. Single source of truth so the parser gate, the behaviors stripper, and
// normalizeRoadmapBullet can never disagree on what a bullet is. Stateless (no /g).
const ROADMAP_BULLET_PREFIX = /^(?:[-*+]|\d+\.)\s+/

export function parseGoals(content: string): GoalsMd {
  const lines = content.split('\n')
  let mission = ''
  const techStack: Record<string, string> = {}
  const phases: GoalsPhase[] = []
  const openQuestions: string[] = []

  type Section = 'none' | 'mission' | 'techStack' | 'roadmap' | 'openQuestions' | 'keyFeatures' | 'other'
  type PhaseSection = 'none' | 'behaviors' | 'milestones'
  let section: Section = 'none'
  let phaseSection: PhaseSection = 'none'
  let currentPhase: GoalsPhase | null = null
  const missionLines: string[] = []
  // "### " entries under "## Key Features" — the import meta-prompt requires a detail
  // entry there ONLY for unfinished features, so this is the reliable done/not-done signal
  // when a bullet lacks a checkbox. Lowercased feature names.
  const keyFeatureNames = new Set<string>()

  function pushCurrentPhase() {
    if (currentPhase) phases.push(currentPhase)
    currentPhase = null
    phaseSection = 'none'
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed.startsWith('<!--')) {
      while (i < lines.length && !lines[i]!.includes('-->')) i++
      continue
    }

    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim().toLowerCase()
      pushCurrentPhase()
      if (heading === 'mission') section = 'mission'
      else if (heading === 'tech stack') section = 'techStack'
      else if (heading === 'roadmap') section = 'roadmap'
      else if (heading === 'key features') section = 'keyFeatures'
      else if (heading === 'open questions') section = 'openQuestions'
      else section = 'other'
      continue
    }

    // Collect "### Feature" names under "## Key Features" (used to mark unfinished
    // features when a Roadmap bullet has no checkbox). Key Features precedes Roadmap
    // in the canonical format, so these are populated before the Roadmap is parsed.
    if (section === 'keyFeatures' && trimmed.startsWith('### ')) {
      const name = trimmed.slice(4).trim().toLowerCase()
      if (name) keyFeatureNames.add(name)
      continue
    }

    if (section === 'roadmap' && trimmed.startsWith('### ')) {
      pushCurrentPhase()
      const phaseHeading = trimmed.slice(4).trim()
      const phaseMatch = phaseHeading.match(/^Phase\s+(\d+)[:\s—–-]+(.+)$/i)
      if (phaseMatch) {
        currentPhase = { number: parseInt(phaseMatch[1]!, 10), name: phaseMatch[2]!.trim(), behaviors: [], milestones: [] }
      } else {
        currentPhase = { number: phases.length + 1, name: phaseHeading, behaviors: [], milestones: [] }
      }
      phaseSection = 'none'
      continue
    }

    if (section === 'roadmap' && currentPhase) {
      if (trimmed.match(/^\*\*Behaviors introduced\*\*:?/i)) { phaseSection = 'behaviors'; continue }
      if (trimmed.match(/^\*\*Milestones\*\*:?/i)) { phaseSection = 'milestones'; continue }
      // Any bullet style: "-", "*", "+", or "1."
      if (ROADMAP_BULLET_PREFIX.test(trimmed)) {
        if (phaseSection === 'behaviors') {
          currentPhase.behaviors.push(trimmed.replace(ROADMAP_BULLET_PREFIX, '').trim())
        } else {
          // Normalize non-canonical bullets ("* Foo", bare "- Foo", "1. Foo") to
          // "- [x]/[ ] Foo" so parseMilestone can read them; canonical lines pass through.
          const norm = normalizeRoadmapBullet(trimmed, keyFeatureNames)
          const m = parseMilestone(norm.replace(/^- /, ''))
          if (m) currentPhase.milestones.push(m)
        }
        continue
      }
      if (trimmed === '') continue
    }

    if (section === 'mission') {
      if (trimmed === '---') continue
      missionLines.push(trimmed)
      continue
    }

    if (section === 'techStack') {
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const bullet = trimmed.slice(2)
        const kvMatch = bullet.match(/^\*\*(.+?)\*\*:?\s*(.*)$/)
        if (kvMatch) {
          const key = kvMatch[1]!.trim()
          let value = kvMatch[2]!.trim()
          const subLines: string[] = []
          while (i + 1 < lines.length) {
            const nextTrimmed = lines[i + 1]!.trim()
            if (nextTrimmed.startsWith('  - ') || nextTrimmed.startsWith('  * ')) {
              subLines.push(nextTrimmed.slice(4).trim())
              i++
            } else break
          }
          if (value === '' && subLines.length > 0) value = subLines.join(', ')
          if (value !== '') techStack[key] = value
        }
      }
      continue
    }

    if (section === 'openQuestions') {
      if (trimmed.startsWith('- ')) {
        const bullet = trimmed.slice(2)
        const m = parseMilestone(bullet)
        if (m) openQuestions.push(m.text)
        else if (bullet.trim()) openQuestions.push(bullet.trim())
      }
      continue
    }
  }

  pushCurrentPhase()
  mission = missionLines.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return { mission, techStack, phases, openQuestions }
}

export function parseGoalsFile(projectPath: string): GoalsMd | null {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return null
  try { return parseGoals(readFileSync(goalsPath, 'utf8')) } catch { return null }
}

function parseMilestone(bullet: string): GoalsMilestone | null {
  const checked = bullet.match(/^\[x\]\s+(.+)$/i)
  if (checked) return { text: checked[1]!.trim(), checked: true }
  const unchecked = bullet.match(/^\[ \]\s+(.+)$/)
  if (unchecked) return { text: unchecked[1]!.trim(), checked: false }
  return null
}

/**
 * Tolerate non-canonical Roadmap bullet styles from external AI tools (Replit Agent,
 * Cursor, Lovable). Sneebly's canonical form is "- [x] Feature" / "- [ ] Feature", but
 * tools frequently emit "* Feature", bare "- Feature", "+ Feature", or "1. Feature" even
 * when the prompt forbids it. This rewrites those to canonical so parseMilestone reads
 * them; already-canonical lines and non-bullet lines pass through unchanged. The on-disk
 * GOALS.md is never modified — this is in-parse normalization only.
 *
 * done vs not-done, in priority order:
 *   1. line says "(partial:" or "(not started)" -> unchecked
 *   2. feature name has a "### " entry under "## Key Features" -> unchecked
 *      (the import meta-prompt requires a detail entry ONLY for unfinished features)
 *   3. otherwise -> checked (done) — a feature with no incompleteness signal is treated
 *      as shipped, matching the meta-prompt where done features are terse one-liners.
 */
export function normalizeRoadmapBullet(line: string, keyFeatureNames: Set<string>): string {
  if (/^- \[[ xX]\]\s+/.test(line)) return line // already canonical
  if (!ROADMAP_BULLET_PREFIX.test(line)) return line // not a bullet — leave alone
  const content = line.replace(ROADMAP_BULLET_PREFIX, '')
  if (!content) return line // bullet marker with no text — leave alone
  const featureName = content.split(/\s[—–-]\s/)[0]!.trim().toLowerCase()
  const unfinished =
    /\(partial:|\(not started\)/i.test(content) || keyFeatureNames.has(featureName)
  return `- ${unfinished ? '[ ]' : '[x]'} ${content}`
}
