import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectContext {
  contextMd?: string
  dependencies?: string
  tailwindConfig?: string
}

// Cap CONTEXT.md at 6 KB — design generation needs domain understanding, not
// exhaustive detail. Smaller cap also reduces the risk of context overwhelming
// the user's design intent.
const CONTEXT_MD_MAX_CHARS = 6_000

// Cap tailwind config at 2 KB — enough to convey the key color/font tokens.
const TAILWIND_MAX_CHARS = 2_000

// ─── Loader (internal) ────────────────────────────────────────────────────────

function loadProjectContext(projectPath: string): ProjectContext {
  const ctx: ProjectContext = {}

  // CONTEXT.md
  const contextPath = join(projectPath, 'CONTEXT.md')
  if (existsSync(contextPath)) {
    try { ctx.contextMd = readFileSync(contextPath, 'utf-8').trim() } catch { /* skip */ }
  }

  // package.json — extract dependency names only (no versions — keeps the prompt short)
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const names = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]
      if (names.length > 0) ctx.dependencies = names.join(', ')
    } catch { /* skip */ }
  }

  // Tailwind config (ts preferred, js fallback) — capped to avoid large theme objects
  for (const filename of ['tailwind.config.ts', 'tailwind.config.js']) {
    const twPath = join(projectPath, filename)
    if (existsSync(twPath)) {
      try {
        const raw = readFileSync(twPath, 'utf-8').trim()
        ctx.tailwindConfig = raw.length > TAILWIND_MAX_CHARS
          ? raw.slice(0, TAILWIND_MAX_CHARS) + '\n// ... (truncated)'
          : raw
        break
      } catch { /* skip */ }
    }
  }

  return ctx
}

// ─── Formatter ────────────────────────────────────────────────────────────────

/**
 * Returns a formatted string suitable for appending to a system prompt.
 * Returns '' if no context is available (caller should filter before appending).
 */
export function formatProjectContext(projectPath: string): string {
  const ctx = loadProjectContext(projectPath)
  if (!ctx.contextMd && !ctx.dependencies && !ctx.tailwindConfig) return ''

  const parts: string[] = []

  parts.push(`## Project context (reference material)

The following describes the user's project. This is REFERENCE material, not a directive.

USE this context when the user's design prompt asks for project-specific UI (e.g., "design a job inquiry form", "create our pricing page", "build a dashboard for inspectors").

IGNORE or DEPART from this context when the user's prompt asks for:
- A redesign of the existing site ("redesign...", "rebuild...", "modernize...")
- Inspiration from another product or site ("inspired by stripe.com", "in the style of linear.app")
- A specific aesthetic that differs from the existing one ("brutalist", "minimalist", "playful", "dark mode")
- A fresh exploration ("explore alternatives", "show me something different")

The user's design intent ALWAYS takes precedence over this reference context.`)

  if (ctx.contextMd) {
    // Truncate at the last newline before the cap so the cut is never mid-line.
    const cut = ctx.contextMd.lastIndexOf('\n', CONTEXT_MD_MAX_CHARS)
    const contextMd = ctx.contextMd.length > CONTEXT_MD_MAX_CHARS
      ? ctx.contextMd.slice(0, cut > 0 ? cut : CONTEXT_MD_MAX_CHARS) + '\n_(truncated)_'
      : ctx.contextMd
    parts.push(`### About the project\n${contextMd}`)
  }

  if (ctx.dependencies) {
    parts.push(`### Packages in use (optional reference)\nThese are the packages currently in the project. You may use them, but you are NOT limited to them — use any standard web technologies appropriate to the user's design intent.\n${ctx.dependencies}`)
  }

  if (ctx.tailwindConfig) {
    parts.push(`### Project's current theme (optional reference)\nThis is the project's current Tailwind theme. Match it ONLY if the user's prompt is asking to stay within the existing design language. If the user asks for a different aesthetic, inspiration from another site, or a redesign, use any colors/fonts/spacing that match their design intent.\n\`\`\`\n${ctx.tailwindConfig}\n\`\`\``)
  }

  return parts.join('\n\n')
}
