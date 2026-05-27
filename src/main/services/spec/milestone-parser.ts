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

// ── Standard parser (requires ## Roadmap + - [ ] checkboxes) ──────────────────

function parseMilestonesStandard(goalsMd: string): MilestoneRef[] {
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
        skipped: m.skipped,
        skipReason: m.skipReason,
        specPath,
        specSlug: toUpperSnakeSlug(cleanText),
      })
    }
  }
  return refs
}

// ── Flexible parser (handles ## Build Phases + middle-dot separated text) ─────
//
// Handles GOALS.md files that use a different structure:
//   ## Build Phases (or any ## *phase* heading)
//   ### Phase N — Name
//   Feature one · Feature two · **Bold feature** · ...

function parseMilestonesFlexible(goalsMd: string): MilestoneRef[] {
  const refs: MilestoneRef[] = []
  const seen = new Set<string>()
  let inPhaseSection = false
  let currentPhaseLabel = ''

  // Matches "(skipped)" or "(skipped: reason)" — same regex as identity.ts
  const FLEX_SKIP_RE = /\s*\(skipped(?::\s*([^)]*))?\)/i

  function push(
    rawText: string,
    checked = false,
    specPath: string | null = null,
    skipped = false,
    skipReason: string | undefined = undefined,
  ) {
    // Strip bold markers and short parenthetical asides; normalize whitespace
    const clean = rawText
      .replace(/\*\*/g, '')
      .replace(/\([^)]{1,80}\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.:]+$/, '')
      .trim()
    if (!clean || clean.length < 4 || clean.length > 80) return
    // Skip prose-starter patterns that are clearly not feature names
    if (/^(ship the ai|plus the|done when|seed a|note:|also:|add to |a working|it's |these |and the )/i.test(clean)) return
    if (clean.endsWith(':')) return

    const id = toKebabSlug(clean)
    if (seen.has(id)) return
    seen.add(id)

    const { cleanText, specPath: sp } = extractSpecLink(clean)
    refs.push({
      id: toKebabSlug(cleanText),
      text: cleanText,
      phase: currentPhaseLabel,
      checked,
      skipped,
      skipReason,
      specPath: specPath ?? sp,
      specSlug: toUpperSnakeSlug(cleanText),
    })
  }

  // Process one middle-dot segment, which may be short (direct feature name)
  // or long (preamble with bold items inside it).
  function extractFromSegment(seg: string) {
    const s = seg.trim()
    if (!s) return

    // "**Label:** feature text" — the bold part is a section label, the text after is the feature
    const afterLabelMatch = s.match(/^\*\*[^*]+:\s*\*\*\s+(.+)$/)
    if (afterLabelMatch) {
      // The remainder may itself be comma/arrow separated (e.g. "Scoop Bounty, Tip Relay")
      for (const item of afterLabelMatch[1]!.split(/[→,]/)) {
        push(item.trim())
      }
      return
    }

    // Compute the "plain" length (no bold markers, no short parens)
    const plainLen = s.replace(/\*\*/g, '').replace(/\([^)]{1,80}\)/g, '').trim().length

    if (plainLen <= 80) {
      // Short enough to use directly
      push(s)
    } else {
      // Long segment: extract **bold** names (up to 120 chars in bold content)
      for (const m of s.matchAll(/\*\*([^*]{4,120})\*\*/g)) {
        const name = m[1]!.replace(/:\s*$/, '').trim()
        if (name) push(name)
      }
      // Also try the final word-run after the last bold block (catches plain items
      // like "Scoop Bounty" that trail after "**Viral mechanics:** Scoop Bounty" segments
      // when "**Viral mechanics:**" is its own bold block followed by plain text)
      const afterLastBold = s.replace(/.*\*\*[^*]+\*\*/, '').trim()
      if (afterLastBold && !afterLastBold.startsWith('(') && afterLastBold.length <= 50) {
        push(afterLastBold)
      }
    }
  }

  for (const rawLine of goalsMd.split('\n')) {
    const trimmed = rawLine.trim()

    // Section detection: ## Roadmap or ## Build Phases or any ## *phase(s)* heading
    if (trimmed.startsWith('## ')) {
      const h = trimmed.slice(3).trim().toLowerCase()
      inPhaseSection = h === 'roadmap' || /\bphases?\b/.test(h)
      if (!inPhaseSection) currentPhaseLabel = ''
      continue
    }

    if (!inPhaseSection) continue

    // Phase subheading: ### Phase N — Name  or  ### Phase N: Name
    if (trimmed.startsWith('### ')) {
      const heading = trimmed.slice(4).trim()
      // em-dash (—), en-dash (–), colon, or hyphen as separators
      const m = heading.match(/^Phase\s+(\d+)\s*[—–:–-]+\s*(.+)$/i)
      if (m) {
        // Strip trailing markers like "◀ CURRENT"
        const name = m[2]!.replace(/[◀◁←<▶►][^\n]*/u, '').trim()
        currentPhaseLabel = `Phase ${m[1]}: ${name}`
      } else {
        currentPhaseLabel = heading
      }
      continue
    }

    if (!currentPhaseLabel || !trimmed) continue
    if (trimmed.startsWith('#') || trimmed.startsWith('|') || trimmed.startsWith('>')) continue

    // Standard checkbox format: - [ ] text  or  - [x] text
    const chk = trimmed.match(/^-\s+\[([x ])\]\s+(.+)$/i)
    if (chk) {
      const isChecked = chk[1]!.toLowerCase() === 'x'
      const rawChkText = chk[2]!
      const skipMatch = rawChkText.match(FLEX_SKIP_RE)
      const isSkipped = skipMatch !== null
      const skipReason = skipMatch?.[1]?.trim() || undefined
      const cleanRaw = rawChkText.replace(FLEX_SKIP_RE, '').trim()
      const { cleanText, specPath } = extractSpecLink(cleanRaw)
      push(cleanText, isChecked, specPath, isSkipped, skipReason)
      continue
    }

    // Middle-dot (·) separated feature lists
    if (trimmed.includes('·')) {
      // Cut before "Done when:" prose that trails feature lists
      const cutIdx = trimmed.search(/\bDone when\b/i)
      const src = cutIdx >= 0 ? trimmed.slice(0, cutIdx) : trimmed

      // Normalize ". **" → " · **" so bold blocks that start after a period
      // become their own segments (e.g. "...AI Beat Builder. **Viral mechanics:**")
      const normalized = src.replace(/\.\s+(\*\*)/g, ' · $1')

      for (const seg of normalized.split('·')) {
        extractFromSegment(seg)
      }
    }
  }

  return refs
}

// ── Main export ────────────────────────────────────────────────────────────────

export function parseMilestones(goalsMd: string): MilestoneRef[] {
  // Try the standard parser first (## Roadmap + checkbox bullets)
  const standard = parseMilestonesStandard(goalsMd)
  if (standard.length > 0) return standard

  // Fall back to the flexible parser for narrative GOALS.md formats
  return parseMilestonesFlexible(goalsMd)
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
