import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditFinding, AuditMeta } from '../../../shared/types'
import { auditDir } from './auditor-store'

// ─── Cross-category dedup ─────────────────────────────────────────────────────
// v1: fingerprint-only dedup. Two findings with the same ID (same content hash)
// produced by different phases → keep the one with higher severity.

export function deduplicateFindings(findings: AuditFinding[]): AuditFinding[] {
  const byId = new Map<string, AuditFinding>()

  for (const f of findings) {
    const existing = byId.get(f.id)
    if (!existing) {
      byId.set(f.id, f)
      continue
    }
    // Keep higher severity
    const order = { critical: 0, high: 1, medium: 2, low: 3 }
    if (order[f.severity] < order[existing.severity]) {
      byId.set(f.id, f)
    }
  }

  return Array.from(byId.values())
}

// ─── Prioritisation ───────────────────────────────────────────────────────────

const CATEGORY_ORDER: Record<AuditFinding['category'], number> = {
  security: 0, depsec: 1, schema: 2, correctness: 3, convention: 4, env: 5, todo: 6, smell: 7,
}

const SEVERITY_ORDER: Record<AuditFinding['severity'], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

export function prioritiseFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((a, b) => {
    const sd = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sd !== 0) return sd
    const cd = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    if (cd !== 0) return cd
    return a.startLine - b.startLine
  })
}

// ─── Effort estimate ──────────────────────────────────────────────────────────

function effortHours(findings: AuditFinding[]): number {
  const weights = { critical: 4, high: 2, medium: 1, low: 0.25 }
  return findings.reduce((sum, f) => sum + weights[f.severity], 0)
}

// ─── Report generation ────────────────────────────────────────────────────────

function excerptBlock(f: AuditFinding): string {
  const { lines, startLine } = f.codeExcerpt
  const numbered = lines.map((l, i) => {
    const lineNum = startLine + i
    const isHighlighted =
      lineNum >= f.codeExcerpt.highlightStart && lineNum <= f.codeExcerpt.highlightEnd
    return `${isHighlighted ? '>' : ' '} ${String(lineNum).padStart(4)} │ ${l}`
  }).join('\n')
  return '```\n' + numbered + '\n```'
}

function findingMd(f: AuditFinding, index: number): string {
  let md = `### ${index}. ${f.title}\n\n`
  md += `**File:** \`${f.filePath}:${f.startLine}-${f.endLine}\`  \n`
  md += `**Category:** ${f.category}  **Fingerprint:** \`${f.id}\`\n\n`
  md += `${f.description}\n\n`
  if (f.businessImpact) md += `**Impact:** ${f.businessImpact}\n\n`
  md += `${excerptBlock(f)}\n\n`
  md += `**Suggested fix:** ${f.suggestedFix}\n\n---\n\n`
  return md
}

export function generateReport(meta: AuditMeta, findings: AuditFinding[]): string {
  const active = findings.filter((f) => !f.resolved && !f.falsePositive)
  const bySeverity = {
    critical: active.filter((f) => f.severity === 'critical'),
    high: active.filter((f) => f.severity === 'high'),
    medium: active.filter((f) => f.severity === 'medium'),
    low: active.filter((f) => f.severity === 'low'),
  }
  const byCategory: Record<string, number> = {}
  for (const f of active) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1

  const durationSec = meta.completedAt
    ? Math.ceil((meta.completedAt - meta.startedAt) / 1000)
    : null
  const durationStr = durationSec
    ? durationSec > 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`
    : 'ongoing'

  const effort = effortHours(active)
  const effortStr = effort < 1
    ? `~${Math.ceil(effort * 60)} minutes`
    : `~${effort.toFixed(1)} engineer-hours`

  let md = `# Sneebly Audit Report\n\n`
  md += `**Project:** ${meta.projectPath.split('/').pop() ?? meta.projectPath}  \n`
  md += `**Audit ID:** ${meta.id}  \n`
  md += `**Mode:** ${meta.mode}  \n`
  md += `**Started:** ${new Date(meta.startedAt).toISOString()}  \n`
  if (meta.completedAt) md += `**Completed:** ${new Date(meta.completedAt).toISOString()}  \n`
  md += `**Duration:** ${durationStr}  \n`
  md += `**Cost:** $${meta.costActualUsd.toFixed(4)}  \n`
  md += `**Model:** ${meta.model}  \n\n---\n\n`

  // Executive summary
  md += `## Executive Summary (30-second read)\n\n`
  md += `This audit found **${active.length} issues** across **${meta.totalFiles} files**.\n\n`

  if (bySeverity.critical.length > 0) {
    md += `**Top priority (${bySeverity.critical.length} critical):**\n\n`
    for (const f of bySeverity.critical.slice(0, 3)) {
      md += `- **${f.title}** (\`${f.filePath}:${f.startLine}\`)  \n`
      md += `  ${f.description.split('.')[0]}.\n`
    }
    if (bySeverity.critical.length > 3) {
      md += `\n... and ${bySeverity.critical.length - 3} more critical findings.\n`
    }
    md += '\n'
  } else if (active.length === 0) {
    md += `**Clean audit — zero findings.** Great work.\n\n`
  }

  if (active.length > 0) {
    md += `**Total estimated effort to address all findings:** ${effortStr}\n\n`
  }

  md += `---\n\n## Summary by severity\n\n`
  md += `| Severity | Count |\n|---|---|\n`
  md += `| Critical | ${bySeverity.critical.length} |\n`
  md += `| High | ${bySeverity.high.length} |\n`
  md += `| Medium | ${bySeverity.medium.length} |\n`
  md += `| Low | ${bySeverity.low.length} |\n`
  md += `| **Total** | **${active.length}** |\n\n`

  md += `## Summary by category\n\n| Category | Count |\n|---|---|\n`
  for (const [cat, count] of Object.entries(byCategory)) {
    md += `| ${cat} | ${count} |\n`
  }
  md += '\n'

  // Critical findings
  if (bySeverity.critical.length > 0) {
    md += `## Critical findings (review immediately)\n\n`
    bySeverity.critical.forEach((f, i) => { md += findingMd(f, i + 1) })
  }

  if (bySeverity.high.length > 0) {
    md += `## High-severity findings\n\n`
    bySeverity.high.forEach((f, i) => { md += findingMd(f, i + 1) })
  }

  if (bySeverity.medium.length > 0) {
    md += `## Medium-severity findings\n\n`
    bySeverity.medium.forEach((f, i) => { md += findingMd(f, i + 1) })
  }

  if (bySeverity.low.length > 0) {
    md += `## Low-severity findings\n\n`
    bySeverity.low.forEach((f, i) => { md += findingMd(f, i + 1) })
  }

  md += `## Files audited\n\n`
  md += `${meta.processedFiles} files audited.`
  if (meta.failedFiles > 0) md += ` ${meta.failedFiles} files failed.`
  md += '\n\n'

  if (meta.mode === 'incremental' && meta.carriedForwardCount != null) {
    md += `This was an incremental audit. ${meta.carriedForwardCount} findings carried forward from previous audit. ${meta.newFindingsCount ?? 0} findings are new.\n\n`
  }

  md += `---\n\n*Generated by Sneebly Auditor v1.0*\n`
  return md
}

export function writeReport(projectPath: string, auditId: string, meta: AuditMeta, findings: AuditFinding[]): void {
  const dir = auditDir(projectPath, auditId)
  const report = generateReport(meta, findings)
  writeFileSync(join(dir, 'report.md'), report, 'utf-8')
  writeFileSync(
    join(dir, 'report.json'),
    JSON.stringify({ meta, findings }, null, 2),
    'utf-8',
  )
}
