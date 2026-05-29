import { join } from 'node:path'
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync,
  readdirSync, renameSync, unlinkSync, rmSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import type { AuditMeta, AuditFinding, AuditId, AuditListEntry } from '../../../shared/types'

// ─── Paths ────────────────────────────────────────────────────────────────────

function auditsRoot(projectPath: string): string {
  return join(projectPath, '.sneebly-interface', 'audits')
}

export function auditDir(projectPath: string, auditId: AuditId): string {
  return join(auditsRoot(projectPath), auditId)
}

function metaPath(dir: string): string { return join(dir, 'meta.json') }
function findingsDir(dir: string): string { return join(dir, 'findings') }
function progressPath(dir: string): string { return join(dir, 'progress.json') }
function pidPath(dir: string): string { return join(dir, '_pid') }
function logPath(dir: string): string { return join(dir, 'log.jsonl') }

// ─── Atomic write helper ──────────────────────────────────────────────────────

function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, filePath)
}

// ─── Audit ID generation ──────────────────────────────────────────────────────

export function generateAuditId(projectPath: string): AuditId {
  const iso = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
  const slug = projectPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20) ?? 'project'
  return `${iso}-${slug}`
}

// ─── Initialise audit directory ───────────────────────────────────────────────

export function initAuditDir(projectPath: string, auditId: AuditId, meta: AuditMeta): void {
  const dir = auditDir(projectPath, auditId)
  mkdirSync(join(dir, 'findings'), { recursive: true })

  // Write PID file
  writeFileSync(pidPath(dir), String(process.pid), 'utf-8')

  // Write initial meta
  atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2))

  // Write README
  const readme = `# Sneebly Audit Report

**Project:** ${projectPath.split('/').pop() ?? projectPath}
**Audit ID:** ${auditId}
**Started:** ${new Date(meta.startedAt).toISOString()}
**Mode:** ${meta.mode}
**Status:** Running

## How to use this directory

- See \`report.md\` for the human-readable report (generated when audit completes)
- See \`findings/\` for individual finding JSON files
- See \`meta.json\` for audit metadata and status

To re-open in Sneebly: Open project → Audit → History → click this date.

This directory is excluded from git. It is private to this machine.
`
  writeFileSync(join(dir, 'README.md'), readme, 'utf-8')
}

// ─── Meta I/O ─────────────────────────────────────────────────────────────────

export function writeMeta(projectPath: string, auditId: AuditId, meta: AuditMeta): void {
  const dir = auditDir(projectPath, auditId)
  atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2))
}

export function readMeta(projectPath: string, auditId: AuditId): AuditMeta | null {
  const dir = auditDir(projectPath, auditId)
  try {
    return JSON.parse(readFileSync(metaPath(dir), 'utf-8')) as AuditMeta
  } catch { return null }
}

// ─── Finding I/O ──────────────────────────────────────────────────────────────

export function writeFinding(projectPath: string, auditId: AuditId, finding: AuditFinding): void {
  const dir = auditDir(projectPath, auditId)
  const fd = findingsDir(dir)
  const index = String(Date.now()).slice(-6)
  const fname = `${index}-${finding.id}.json`
  atomicWrite(join(fd, fname), JSON.stringify(finding, null, 2))
}

export function readAllFindings(projectPath: string, auditId: AuditId): AuditFinding[] {
  const dir = auditDir(projectPath, auditId)
  const fd = findingsDir(dir)
  if (!existsSync(fd)) return []

  const findings: AuditFinding[] = []
  for (const fname of readdirSync(fd)) {
    if (!fname.endsWith('.json')) continue
    try {
      const f = JSON.parse(readFileSync(join(fd, fname), 'utf-8')) as AuditFinding
      findings.push(f)
    } catch { /* skip malformed */ }
  }
  return findings.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.severity] - order[b.severity]
  })
}

export function patchFinding(
  projectPath: string,
  auditId: AuditId,
  findingId: string,
  patch: Partial<AuditFinding>,
): void {
  const dir = auditDir(projectPath, auditId)
  const fd = findingsDir(dir)
  if (!existsSync(fd)) return

  for (const fname of readdirSync(fd)) {
    if (!fname.includes(findingId)) continue
    const fpath = join(fd, fname)
    try {
      const existing = JSON.parse(readFileSync(fpath, 'utf-8')) as AuditFinding
      atomicWrite(fpath, JSON.stringify({ ...existing, ...patch }, null, 2))
      return
    } catch { /* skip */ }
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

export function appendLog(projectPath: string, auditId: AuditId, entry: Record<string, unknown>): void {
  const dir = auditDir(projectPath, auditId)
  const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n'
  try { appendFileSync(logPath(dir), line, 'utf-8') } catch { /* non-fatal */ }
}

// ─── PID cleanup ──────────────────────────────────────────────────────────────

export function removePid(projectPath: string, auditId: AuditId): void {
  const dir = auditDir(projectPath, auditId)
  try { unlinkSync(pidPath(dir)) } catch { /* already gone */ }
}

// ─── Listing ──────────────────────────────────────────────────────────────────

export function listAudits(projectPath: string): AuditListEntry[] {
  const root = auditsRoot(projectPath)
  if (!existsSync(root)) return []

  const entries: AuditListEntry[] = []
  for (const auditId of readdirSync(root)) {
    const meta = readMeta(projectPath, auditId)
    if (!meta) continue

    const findings = readAllFindings(projectPath, auditId)
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const f of findings) {
      if (!f.resolved && !f.falsePositive) bySeverity[f.severity]++
    }

    entries.push({
      id: auditId,
      startedAt: meta.startedAt,
      completedAt: meta.completedAt,
      status: meta.status,
      mode: meta.mode,
      totalFiles: meta.totalFiles,
      findingCount: findings.filter((f) => !f.resolved && !f.falsePositive).length,
      bySeverity,
      costActualUsd: meta.costActualUsd,
    })
  }

  return entries.sort((a, b) => b.startedAt - a.startedAt)
}

export function getLastCompletedAudit(projectPath: string): AuditMeta | null {
  const entries = listAudits(projectPath)
  const completed = entries.find((e) => e.status === 'completed')
  if (!completed) return null
  return readMeta(projectPath, completed.id)
}

export function deleteAudit(projectPath: string, auditId: AuditId): void {
  const dir = auditDir(projectPath, auditId)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

// ─── Orphan recovery ──────────────────────────────────────────────────────────

export function recoverOrphanedAudits(projectPath: string): void {
  const root = auditsRoot(projectPath)
  if (!existsSync(root)) return

  for (const auditId of readdirSync(root)) {
    const dir = auditDir(projectPath, auditId)
    const pidFile = pidPath(dir)
    if (!existsSync(pidFile)) continue

    const meta = readMeta(projectPath, auditId)
    if (!meta || meta.status !== 'running') continue

    // Check if the PID is still alive
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8'), 10)
      if (!isNaN(pid)) process.kill(pid, 0) // throws if not running
      // If we get here, process is still running — leave it alone
    } catch {
      // Process is gone — mark as canceled
      const updated: AuditMeta = {
        ...meta,
        status: 'canceled',
        completedAt: Date.now(),
        error: 'Audit interrupted by unexpected shutdown',
      }
      writeMeta(projectPath, auditId, updated)
      try { unlinkSync(pidFile) } catch { /* already gone */ }
    }
  }
}

// ─── Retention ────────────────────────────────────────────────────────────────

export function enforceRetention(projectPath: string, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 86_400_000
  const entries = listAudits(projectPath)
  for (const entry of entries) {
    if (entry.startedAt < cutoff) {
      deleteAudit(projectPath, entry.id)
    }
  }
}

// ─── Reveal in Finder ────────────────────────────────────────────────────────

export function revealAuditDir(projectPath: string, auditId: AuditId): void {
  const dir = auditDir(projectPath, auditId)
  if (existsSync(dir)) {
    spawn('open', [dir], { detached: true })
  }
}
