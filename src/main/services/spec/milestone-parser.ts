import { parseGoals } from '../cycle/identity'
import type { MilestoneRef } from '../../../shared/types'

export type { MilestoneRef }

// ── Slug helpers ───────────────────────────────────────────────────────────────

export function toKebabSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function toUpperSnakeSlug(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
}

// ── Spec link detection / stripping ───────────────────────────────────────────

const SPEC_LINK_RE = /\s*→\s*\[.*?\]\((\.\/specs\/[^)]+)\)/

function extractSpecLink(text: string): { cleanText: string; specPath: string | null } {
  const m = text.match(SPEC_LINK_RE)
  if (!m) return { cleanText: text.trim(), specPath: null }
  return {
    cleanText: text.replace(SPEC_LINK_RE, '').trim(),
    specPath: m[1] ?? null,
  }
}

// ── Main parser ────────────────────────────────────────────────────────────────

export function parseMilestones(goalsMd: string): MilestoneRef[] {
  const parsed = parseGoals(goalsMd)
  const refs: MilestoneRef[] = []

  for (const phase of parsed.phases) {
    const phaseLabel = `Phase ${phase.number}: ${phase.name}`
    for (const m of phase.milestones) {
      const { cleanText, specPath } = extractSpecLink(m.text)
      refs.push({
        id: toKebabSlug(cleanText),
        text: cleanText,
        phase: phaseLabel,
        checked: m.checked,
        specPath,
        specSlug: toUpperSnakeSlug(cleanText),
      })
    }
  }

  return refs
}

// ── GOALS.md spec-link updater ─────────────────────────────────────────────────

/**
 * Given the raw GOALS.md content and a map of milestoneId → specSlug,
 * appends spec links to milestone lines that don't already have one.
 * Idempotent: lines already containing '→' are left untouched.
 */
export function injectSpecLinks(
  goalsMd: string,
  links: Map<string, string>,  // milestoneId → specSlug
): string {
  const lines = goalsMd.split('\n')
  return lines.map((line) => {
    // Only operate on unchecked or checked milestone lines
    const milestoneMatch = line.match(/^(-\s+\[[ xX]\]\s+)(.+)$/)
    if (!milestoneMatch) return line
    const prefix = milestoneMatch[1]!
    const rest = milestoneMatch[2]!

    // Already has a spec link — leave it alone
    if (rest.includes('→')) return line

    // Strip any trailing whitespace from rest to get the raw text
    const { cleanText } = extractSpecLink(rest)
    const id = toKebabSlug(cleanText)
    const slug = links.get(id)
    if (!slug) return line

    return `${prefix}${cleanText} → [Detailed spec](./specs/SPEC_${slug}.md)`
  }).join('\n')
}
