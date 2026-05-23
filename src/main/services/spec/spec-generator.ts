import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { ResearchDepth, SpecProgressEvent } from '../../../shared/types'
import { runStandaloneTurn } from '../standalone-turn'
import { parseMilestones, injectSpecLinks } from './milestone-parser'
import { SPEC_TEMPLATE } from './spec-template'
import { detectProjectName } from '../project-registry'

export type { ResearchDepth }

export interface SpecGenerationOptions {
  projectPath: string
  projectId: string
  depth: ResearchDepth
  milestoneIds?: string[]
  overwriteExisting: boolean
  onProgress: (event: SpecProgressEvent) => void
}

export interface SpecGenerationResult {
  generatedCount: number
  skippedCount: number
  errors: Array<{ milestoneId: string; error: string }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function depthToModel(depth: ResearchDepth): 'claude-sonnet-4-6' | 'claude-opus-4-7' {
  return depth === 'light' ? 'claude-sonnet-4-6' : 'claude-opus-4-7'
}

function getFileTree(projectPath: string, maxDepth = 2): string {
  function walk(dir: string, depth: number, prefix: string): string[] {
    if (depth > maxDepth) return []
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return [] }
    const filtered = entries.filter((e) =>
      !['node_modules', '.git', '.sneebly', 'dist', 'out', 'build', '.next'].includes(e)
    )
    const visible = filtered.slice(0, 40)
    const lines: string[] = []
    for (const entry of visible) {
      const full = join(dir, entry)
      let isDir = false
      try { isDir = statSync(full).isDirectory() } catch { /* permission error — skip */ }
      lines.push(`${prefix}${entry}${isDir ? '/' : ''}`)
      if (isDir) lines.push(...walk(full, depth + 1, prefix + '  '))
    }
    if (filtered.length > 40) lines.push(`${prefix}… (${filtered.length - 40} more)`)
    return lines
  }
  return walk(projectPath, 0, '').join('\n')
}

function buildResearchPrompt(opts: {
  projectName: string
  detectedStack: string
  goalsMdContent: string
  milestoneText: string
  phase: string
  projectFileTree: string
  specTemplate: string
}): string {
  return `You are the Sneebly Spec Architect. Generate a comprehensive implementation spec for ONE feature.

CONTEXT:
- Project: ${opts.projectName}
- Stack: ${opts.detectedStack}
- Full GOALS.md content:
${opts.goalsMdContent}

- This specific milestone:
  "${opts.milestoneText}" (under ${opts.phase})

- Existing project structure:
${opts.projectFileTree}

YOUR PROCESS:
1. Read existing relevant code (use Read/Grep/Glob tools). If similar features exist, study their conventions.
2. Do 15-25 web searches for best-in-class examples of this feature type. Focus on:
   - UI patterns (design systems, real product references)
   - Data models (how Stripe/Linear/Shopify/etc. handle similar features)
   - Edge cases and gotchas (Stack Overflow, GitHub issues, blog posts)
   - Modern best practices (recent documentation, API references)
3. Use WebFetch on 2-3 reference URLs to study the actual content.
4. Synthesize EVERYTHING you learned into a single comprehensive SPEC document.

OUTPUT FORMAT:
Output a single markdown document following exactly this template:

${opts.specTemplate}

RULES:
- Be specific. "User can log in" is not a spec. "User enters email + password, clicks Sign in, server validates against bcrypt hash, sets HttpOnly secure cookie, redirects to /dashboard" is a spec.
- Database schemas must be COMPLETE with all fields, types, indexes, and foreign keys.
- Endpoint specs must include exact request/response JSON shapes and all error codes.
- UI states must list every possible state: empty, loading, success, validation error, network error.
- Include ASCII wireframes for non-trivial UI layouts.
- Reference at least 5 URLs in the References section with one-line annotations.
- If the feature is infrastructure with no UI, set "UI Specification" to "N/A — infrastructure feature" and expand the Backend and Data Model sections.
- Generate the COMPLETE spec in one response — do not split or truncate.
- Output ONLY the spec markdown — no preamble, no explanation, just the document starting with "# SPEC:".

Begin.`
}

function detectStack(projectPath: string): string {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const hints: string[] = []
    if (deps['next']) hints.push('Next.js')
    if (deps['react']) hints.push('React')
    if (deps['vue']) hints.push('Vue')
    if (deps['svelte']) hints.push('Svelte')
    if (deps['express'] || deps['fastify'] || deps['hono']) hints.push('Node API')
    if (deps['drizzle-orm'] || deps['@drizzle-orm/core']) hints.push('Drizzle ORM')
    if (deps['prisma'] || deps['@prisma/client']) hints.push('Prisma')
    if (deps['tailwindcss']) hints.push('Tailwind CSS')
    if (deps['@capacitor/core']) hints.push('Capacitor (iOS/Android)')
    if (deps['typescript']) hints.push('TypeScript')
    return hints.length > 0 ? hints.join(', ') : 'JavaScript'
  } catch { return 'unknown' }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateSpecs(opts: SpecGenerationOptions): Promise<SpecGenerationResult> {
  const { projectPath, projectId, depth, overwriteExisting, onProgress } = opts
  const result: SpecGenerationResult = { generatedCount: 0, skippedCount: 0, errors: [] }

  onProgress({ type: 'start' })

  // Read GOALS.md
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) {
    onProgress({ type: 'error', error: 'GOALS.md not found in project root.' })
    return result
  }
  const goalsMdContent = readFileSync(goalsPath, 'utf-8')
  const allMilestones = parseMilestones(goalsMdContent)

  // Filter to requested milestones
  const targets = opts.milestoneIds
    ? allMilestones.filter((m) => opts.milestoneIds!.includes(m.id))
    : allMilestones

  // Ensure specs/ directory exists
  const specsDir = join(projectPath, 'specs')
  mkdirSync(specsDir, { recursive: true })

  const projectName = detectProjectName(projectPath)
  const detectedStack = detectStack(projectPath)
  const projectFileTree = getFileTree(projectPath)
  const model = depthToModel(depth)

  // Track which milestones we generated specs for (for GOALS.md update)
  const generatedLinks = new Map<string, string>()

  for (const milestone of targets) {
    const specFileName = `SPEC_${milestone.specSlug}.md`
    const specFilePath = join(specsDir, specFileName)

    // Skip if exists and not overwriting
    if (existsSync(specFilePath) && !overwriteExisting) {
      result.skippedCount++
      onProgress({ type: 'milestone-skipped', milestoneId: milestone.id, milestoneText: milestone.text })
      continue
    }

    onProgress({ type: 'milestone-start', milestoneId: milestone.id, milestoneText: milestone.text })

    const prompt = buildResearchPrompt({
      projectName,
      detectedStack,
      goalsMdContent,
      milestoneText: milestone.text,
      phase: milestone.phase,
      projectFileTree,
      specTemplate: SPEC_TEMPLATE,
    })

    try {
      const turnResult = await runStandaloneTurn({
        cwd: projectPath,
        projectId,
        prompt,
        model,
        permissionMode: 'bypassPermissions',
        maxTurns: 30,
        allowedTools: ['Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch'],
        appendSystemPrompt: `You are the Sneebly Spec Architect. Think deeply. Research broadly. Output the complete spec document — nothing else.`,
        onEvent: (event) => {
          onProgress({ type: 'milestone-event', milestoneId: milestone.id, agentEvent: event })
        },
      })

      // Extract the spec markdown from the assistant output
      let specMd = turnResult.assistantText.trim()
      if (!specMd.startsWith('# SPEC:')) {
        // Try to find the spec block inside the output
        const match = specMd.match(/# SPEC:[\s\S]+/)
        specMd = match ? match[0].trim() : specMd
      }

      writeFileSync(specFilePath, specMd, 'utf-8')
      result.generatedCount++
      generatedLinks.set(milestone.id, milestone.specSlug)
      onProgress({ type: 'milestone-done', milestoneId: milestone.id, milestoneText: milestone.text })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      result.errors.push({ milestoneId: milestone.id, error: errMsg })
      onProgress({ type: 'error', milestoneId: milestone.id, error: errMsg })
    }
  }

  // Update GOALS.md with spec links for all newly generated specs
  if (generatedLinks.size > 0) {
    const updatedGoalsMd = injectSpecLinks(goalsMdContent, generatedLinks)
    writeFileSync(goalsPath, updatedGoalsMd, 'utf-8')
  }

  onProgress({ type: 'complete', generatedCount: result.generatedCount, skippedCount: result.skippedCount })
  return result
}

// ── List existing specs ────────────────────────────────────────────────────────

export function listExistingSpecs(projectPath: string): string[] {
  const specsDir = join(projectPath, 'specs')
  if (!existsSync(specsDir)) return []
  try {
    return readdirSync(specsDir)
      .filter((f) => f.startsWith('SPEC_') && f.endsWith('.md'))
      .map((f) => basename(f))
  } catch { return [] }
}

export function specsNeedGeneration(projectPath: string): boolean {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return false
  if (listExistingSpecs(projectPath).length > 0) return false
  try {
    const content = readFileSync(goalsPath, 'utf-8')
    return parseMilestones(content).length > 0
  } catch { return false }
}
