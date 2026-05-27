import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max bytes read from each referenced source file. */
const MAX_EXCERPT_BYTES = 2048
/** Max number of source excerpts included in the context bundle. */
const MAX_EXCERPTS = 3

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract backtick-quoted file paths from spec text.
 * The regex requires a dot + 1–6 alpha chars (the file extension) and uses a
 * capture group so matchAll() yields the inner path directly — no manual slice.
 * A heuristic filter then drops bare identifiers with no slash
 * (e.g. `FooComponent.tsx` used as a type name rather than a path).
 */
function extractFilePaths(specText: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const match of specText.matchAll(/`([^`]+\.[a-zA-Z]{1,6})`/g)) {
    const raw = match[1]!
    // Filter out obvious non-paths: must contain a slash or start with '.' to be a real path.
    if (!raw.includes('/') && !raw.startsWith('.')) continue
    if (!seen.has(raw)) {
      seen.add(raw)
      result.push(raw)
    }
  }
  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BundledContext {
  specText: string
  excerpts: Array<{ path: string; content: string }>
}

/**
 * Bundle a spec text with up to MAX_EXCERPTS code excerpts from the project.
 * Referenced file paths are extracted from the spec using backtick heuristics.
 *
 * Security: only files inside projectPath are loaded. join() does not prevent
 * `../` traversal, so we resolve() the absolute path and verify it stays within
 * the project root before reading. This prevents a spec mentioning
 * `../../.ssh/config` from leaking files outside the project.
 */
export function bundleContext(projectPath: string, specText: string): BundledContext {
  const resolvedRoot = resolve(projectPath)
  const mentionedPaths = extractFilePaths(specText)
  const excerpts: Array<{ path: string; content: string }> = []

  for (const relPath of mentionedPaths) {
    if (excerpts.length >= MAX_EXCERPTS) break
    const absPath = resolve(join(resolvedRoot, relPath))
    // Containment check: drop any path that escapes the project root.
    if (!absPath.startsWith(resolvedRoot + '/') && absPath !== resolvedRoot) continue
    if (!existsSync(absPath)) continue
    try {
      const raw = readFileSync(absPath, 'utf-8')
      const content = raw.length > MAX_EXCERPT_BYTES
        ? `${raw.slice(0, MAX_EXCERPT_BYTES)}\n… (truncated)`
        : raw
      excerpts.push({ path: relPath, content })
    } catch { /* skip unreadable */ }
  }

  return { specText, excerpts }
}
