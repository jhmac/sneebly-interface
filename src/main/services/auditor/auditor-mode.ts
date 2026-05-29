import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditableFile, AuditMode } from '../../../shared/types'
import { getLastCompletedAudit } from './auditor-store'

export interface ModeResolution {
  effectiveMode: AuditMode
  filesToAudit: AuditableFile[]
  carriedForwardFiles: AuditableFile[]
  baseAuditId?: string
  changedFiles?: string[]
  fallbackReason?: string
}

export function resolveMode(
  requestedMode: AuditMode,
  allFiles: AuditableFile[],
  projectPath: string,
  subsetPaths?: string[],
): ModeResolution {
  switch (requestedMode) {
    case 'subset':
      return resolveSubset(allFiles, subsetPaths ?? [])
    case 'incremental':
      return resolveIncremental(allFiles, projectPath)
    case 'dry-run':
      return { effectiveMode: 'dry-run', filesToAudit: allFiles, carriedForwardFiles: [] }
    default:
      return { effectiveMode: 'full', filesToAudit: allFiles, carriedForwardFiles: [] }
  }
}

function resolveSubset(allFiles: AuditableFile[], subsetPaths: string[]): ModeResolution {
  if (subsetPaths.length === 0) {
    return { effectiveMode: 'full', filesToAudit: allFiles, carriedForwardFiles: [] }
  }

  const matching = allFiles.filter((f) =>
    subsetPaths.some((p) => f.relativePath.startsWith(p) || f.relativePath === p),
  )

  return {
    effectiveMode: 'subset',
    filesToAudit: matching,
    carriedForwardFiles: [],
  }
}

function resolveIncremental(allFiles: AuditableFile[], projectPath: string): ModeResolution {
  const lastAudit = getLastCompletedAudit(projectPath)

  if (!lastAudit) {
    return {
      effectiveMode: 'full',
      filesToAudit: allFiles,
      carriedForwardFiles: [],
      fallbackReason: 'No previous audit found — running full scan.',
    }
  }

  // Try to get changed files since last audit via git
  let changedFiles: string[] = []
  try {
    const gitOut = execSync(
      'git diff --name-only HEAD~1..HEAD 2>/dev/null; git diff --name-only HEAD 2>/dev/null',
      { cwd: projectPath, encoding: 'utf-8', timeout: 10_000 },
    )
    changedFiles = gitOut.trim().split('\n').filter(Boolean)
  } catch {
    // Not a git repo or git not available — fall back to full
    return {
      effectiveMode: 'full',
      filesToAudit: allFiles,
      carriedForwardFiles: [],
      fallbackReason: 'Could not determine changed files (not a git repo) — running full scan.',
    }
  }

  const changedSet = new Set(changedFiles)
  const toAudit = allFiles.filter((f) => changedSet.has(f.relativePath))
  const carried = allFiles.filter((f) => !changedSet.has(f.relativePath))

  return {
    effectiveMode: 'incremental',
    filesToAudit: toAudit.length > 0 ? toAudit : allFiles,
    carriedForwardFiles: carried,
    baseAuditId: lastAudit.id,
    changedFiles,
    fallbackReason: toAudit.length === 0 ? 'No changed files detected — running full scan.' : undefined,
  }
}
