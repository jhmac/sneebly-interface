import { listReflections } from './reflector'
import { readFileSync, existsSync } from 'fs'
import { dateStrToLocalTs } from '../../shared/utils'

// The Reflector prompt asks Claude to answer three questions:
//   1. What got stuck — repeated failures, user corrections, permission denials.
//   2. What got repeated — same patterns run multiple times that could be batched.
//   3. One concrete shortcut that would have saved the most time today.
//
// The model is free to choose its own headings, so we extract by markdown section boundaries
// rather than by heading text. Fallback: first 200 words of the body.

function extractBody(rawContent: string): string {
  // Strip YAML frontmatter (--- ... ---)
  if (!rawContent.startsWith('---')) return rawContent.trim()
  const end = rawContent.indexOf('---', 3)
  if (end === -1) return rawContent.trim()
  return rawContent.slice(end + 3).trimStart()
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text.trim()
  return words.slice(0, maxWords).join(' ') + '…'
}

export interface LearningsResult {
  text: string
  sourceReflections: string[]
  wordCount: number
}

export function buildLearningsAddendum(
  projectPath: string,
  opts: { maxAgeDays: number; maxWords: number }
): LearningsResult | null {
  const entries = listReflections(projectPath)
  if (entries.length === 0) return null

  const cutoff = Date.now() - opts.maxAgeDays * 86_400_000
  const recent = entries
    .filter((e) => dateStrToLocalTs(e.date) >= cutoff)
    .slice(0, 3)

  if (recent.length === 0) return null

  const budgetPerFile = Math.floor(opts.maxWords / recent.length)
  if (budgetPerFile < 1) return null
  const parts: string[] = []
  const used: string[] = []

  for (const entry of recent) {
    if (!existsSync(entry.path)) continue
    try {
      const raw = readFileSync(entry.path, 'utf-8')
      const body = extractBody(raw)
      const excerpt = extractRelevantContent(body, budgetPerFile)
      if (excerpt.trim()) {
        parts.push(`### ${entry.date}\n${excerpt}`)
        used.push(entry.date + '.md')
      }
    } catch {
      // skip unreadable files
    }
  }

  if (parts.length === 0) return null

  const combined = parts.join('\n\n')
  const capped = truncateToWords(combined, opts.maxWords)

  const text = [
    '## Context from prior sessions',
    '',
    'Recent observations from your prior sessions:',
    '',
    capped,
    '',
    "Don't re-litigate these in this session; apply them silently when relevant.",
  ].join('\n')

  const wc = capped.trim().split(/\s+/).filter(Boolean).length
  return { text, sourceReflections: used, wordCount: wc }
}

// Extract the substantive body of a reflection. If markdown headings are present, return all
// section content. If none, fall back to the first 200 words.
function extractRelevantContent(body: string, maxWords: number): string {
  const lines = body.split('\n')
  const hasHeadings = lines.some((l) => /^#{1,3}\s/.test(l))

  if (hasHeadings) {
    // Keep everything under headings (strip the heading lines themselves to save space)
    const content = lines
      .filter((l) => !/^#{1,3}\s/.test(l))
      .join('\n')
      .trim()
    return truncateToWords(content, maxWords)
  }

  // No headings — take first `maxWords` words as-is
  return truncateToWords(body, Math.min(maxWords, 200))
}
