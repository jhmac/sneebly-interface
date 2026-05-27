import { join } from 'node:path'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  readdirSync,
} from 'node:fs'
import type { DecisionsFile } from '../../shared/types'

// ─── Paths ────────────────────────────────────────────────────────────────────

const DECIDER_DIR = join('.sneebly-interface', 'decider')

function deciderDir(projectPath: string): string {
  return join(projectPath, DECIDER_DIR)
}

function ensureDir(projectPath: string): void {
  mkdirSync(deciderDir(projectPath), { recursive: true })
}

/**
 * Pre-flight: <milestoneId>.decisions.json
 * Audit:      <milestoneId>.audit.decisions.json
 */
function decisionsFilePath(projectPath: string, milestoneId: string, isAudit: boolean): string {
  const suffix = isAudit ? '.audit.decisions.json' : '.decisions.json'
  return join(deciderDir(projectPath), `${milestoneId}${suffix}`)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Atomically write a decisions file. Returns the absolute path on disk. */
export function saveDecisions(projectPath: string, file: DecisionsFile): string {
  ensureDir(projectPath)
  const filePath = decisionsFilePath(projectPath, file.milestoneId, file.isAudit)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
  return filePath
}

export function loadDecisions(
  projectPath: string,
  milestoneId: string,
  isAudit = false,
): DecisionsFile | null {
  const filePath = decisionsFilePath(projectPath, milestoneId, isAudit)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as DecisionsFile
  } catch {
    return null
  }
}

/** Count medium + high risk decisions across all decision files in the project.
 *
 * Only pre-flight files (*.decisions.json) are counted — audit files
 * (*.audit.decisions.json) are excluded to avoid double-counting decisions
 * that appear in both passes for the same milestone.
 */
export function countFlaggedDecisions(projectPath: string): number {
  const dir = deciderDir(projectPath)
  if (!existsSync(dir)) return 0
  let count = 0
  try {
    for (const f of readdirSync(dir)) {
      // Exclude audit files: they end with .audit.decisions.json which also
      // satisfies .decisions.json — test the longer suffix first.
      if (f.endsWith('.audit.decisions.json')) continue
      if (!f.endsWith('.decisions.json')) continue
      try {
        const data = JSON.parse(
          readFileSync(join(dir, f), 'utf-8'),
        ) as DecisionsFile
        count += data.decisions.filter(
          (d) => d.risk === 'high' || d.risk === 'medium',
        ).length
      } catch { /* skip malformed */ }
    }
  } catch { /* dir unreadable */ }
  return count
}

/** Absolute paths to all decisions files that exist for a milestone. */
export function getDecisionsFilePaths(
  projectPath: string,
  milestoneId: string,
): string[] {
  const paths: string[] = []
  const preFlight = decisionsFilePath(projectPath, milestoneId, false)
  const audit = decisionsFilePath(projectPath, milestoneId, true)
  if (existsSync(preFlight)) paths.push(preFlight)
  if (existsSync(audit)) paths.push(audit)
  return paths
}
