import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectContext {
  contextMd?: string
  dependencies?: string
  tailwindConfig?: string
}

// Cap tailwind config at 4 KB — large generated configs would consume too much
// of the context budget without adding proportional value to generation quality.
const TAILWIND_MAX_CHARS = 4_000

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
 * Returns a formatted string suitable for prepending to a system prompt.
 * Returns '' if no context is available (caller should filter before appending).
 */
export function formatProjectContext(projectPath: string): string {
  const ctx = loadProjectContext(projectPath)
  const parts: string[] = []

  if (ctx.contextMd) {
    parts.push(`## Project context\n${ctx.contextMd}`)
  }
  if (ctx.dependencies) {
    parts.push(`## Installed packages\nUse only packages from this list where appropriate:\n${ctx.dependencies}`)
  }
  if (ctx.tailwindConfig) {
    parts.push(`## Tailwind configuration\nMatch this theme exactly (colors, fonts, spacing):\n\`\`\`\n${ctx.tailwindConfig}\n\`\`\``)
  }

  return parts.join('\n\n')
}
