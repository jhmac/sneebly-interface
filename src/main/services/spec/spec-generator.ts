import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { RefineMode, ResearchDepth, SpecProgressEvent } from '../../../shared/types'
import { runStandaloneTurn } from '../standalone-turn'
import { parseMilestones, injectSpecLinks } from './milestone-parser'
import { detectProjectName } from '../project-registry'

export type { RefineMode, ResearchDepth }

export interface SpecGenerationOptions {
  projectPath: string
  projectId: string
  depth: ResearchDepth
  milestoneIds?: string[]
  // When no explicit milestoneIds are given, default to speccing only unchecked
  // milestones (the ones still to build). Set true to also spec done ones —
  // useful for backfilling descriptive docs of existing code.
  includeDone?: boolean
  overwriteExisting: boolean
  onProgress: (event: SpecProgressEvent) => void
}

export interface SpecGenerationResult {
  generatedCount: number
  skippedCount: number
  errors: Array<{ milestoneId: string; error: string }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function depthToModel(depth: ResearchDepth): 'claude-sonnet-4-6' | 'claude-opus-4-8' {
  return depth === 'light' ? 'claude-sonnet-4-6' : 'claude-opus-4-8'
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

function buildSpecPrompt(opts: {
  projectName: string
  detectedStack: string
  goalsMdContent: string
  milestoneText: string
  phase: string
  goalsMarker: boolean
  projectFileTree: string
}): string {
  return `You are the Sneebly Spec Architect. For ONE milestone, run a verdict-first, code-aware pass: DISCOVER the related code, ASSESS its actual state from that code, then WRITE a spec whose shape matches the assessed state.

CONTEXT:
- Project: ${opts.projectName}
- Stack: ${opts.detectedStack}
- This specific milestone:
  "${opts.milestoneText}" (under ${opts.phase})
- GOALS.md marks this milestone as: ${opts.goalsMarker ? 'DONE [x]' : 'NOT DONE [ ]'} — treat this as a CLAIM to verify against the code, NOT as ground truth.
- Full GOALS.md content:
${opts.goalsMdContent}

- Existing project structure:
${opts.projectFileTree}

APPROACH — three phases, in order:

1. DISCOVERY — find the code related to this milestone using Glob, Grep, Read, LS.
   - Start with /docs, /specs, README, CLAUDE.md if they exist — they often name the relevant files directly.
   - Then obvious locations: src/, app/, server/, lib/, components/, routes/, pages/.
   - Glob broad, then narrow: e.g. milestone "Authentication and RBAC" -> glob **/auth*, **/users*, **/session*, **/roles* first; if a directory matches, read its index/entry file to find related modules.
   - Grep for symbols named in the milestone (function names, exported types, route paths, table names). If a grep returns >20 hits, narrow with a more specific term rather than reading all of them.
   - Tests that exist are STRONG evidence of implementation. Tests that don't exist are WEAK evidence (the code could simply be untested).
   - BUDGET: read about 8 files (~30k tokens). Prioritize by relevance: direct symbol matches > directory matches > README mentions. If 8 files clearly aren't enough, say so in the rationale rather than reading 20.

2. ASSESSMENT — from the CODE (not the GOALS.md marker), assign exactly one state:
   - done: end-to-end implementation present; the code path is traceable from the entry point (UI/route/CLI) through to persistence or whatever the boundary is; no critical TODOs or \`throw new Error("not implemented")\` in that path. You MUST point to the specific files/symbols that ARE the implementation.
   - partial: started but incomplete. Common shapes: UI exists but backend stubbed, backend exists but UI not wired, happy path works but key error/edge paths missing, or a function exists but its body is a placeholder. You MUST name what exists vs what is missing.
   - not_started: no meaningful code for this milestone. Confirm via grep that the expected symbols/files don't exist.
   Bias toward \`partial\` when uncertain. NEVER silently default to \`done\`.

3. SPEC WRITING — output a single markdown document. Its shape depends on the assessed state.

   If \`done\` — a DESCRIPTIVE doc (NOT a build spec):
   ----------------------------------------
   # SPEC: <feature name>

   **Milestone**: ${opts.milestoneText}
   **Assessed state**: done
   **Assessment rationale**: <one paragraph naming the specific files/symbols that implement this feature>

   ## What's implemented

   - <bullet list of the implementation's notable parts, with file:line references>

   ## Acceptance criteria (currently met)

   - <bullet list of testable conditions that ARE met by the current implementation>

   ## Files

   - <list of files that comprise this feature>

   ## Notes

   - <caveats: known limitations, edge cases unhandled, places future work might touch>
   ----------------------------------------

   If \`partial\` — a GAP-CLOSURE spec:
   ----------------------------------------
   # SPEC: <feature name>

   **Milestone**: ${opts.milestoneText}
   **Assessed state**: partial
   **Assessment rationale**: <one paragraph naming what exists in the code vs what is missing>

   ## Current state (in code)

   - <what exists, with file:line references>

   ## Gap

   - <what's missing, specifically>

   ## Acceptance criteria to close the gap

   - <bullet list of testable conditions; ONLY the ones not currently met>

   ## Suggested implementation

   - <files to add/modify, in suggested order>

   ## Out of scope

   - <anything explicitly NOT part of this milestone (deferred to later phases or other milestones)>
   ----------------------------------------

   If \`not_started\` — a BUILD-FROM-SCRATCH spec:
   ----------------------------------------
   # SPEC: <feature name>

   **Milestone**: ${opts.milestoneText}
   **Assessed state**: not_started
   **Assessment rationale**: <one paragraph confirming via grep that no implementation exists>

   ## Purpose

   <2-3 sentence description of what this feature accomplishes and for which user role>

   ## Acceptance criteria

   - <testable conditions, all of which need to be met>

   ## Suggested implementation

   - <files/components/routes/schemas to add, in suggested order>
   - <reference the project's existing conventions: stack, validation style, auth, etc. — discovered from code + CLAUDE.md>

   ## Out of scope

   - <anything explicitly NOT part of this milestone>
   ----------------------------------------

CRITICAL DISCIPLINE:
- Every claim about what's implemented or missing MUST point to specific files/symbols (file:line where you can). No hand-waving.
- "It compiles" is not "done." "There's a button" is not "done." Done means the feature works end-to-end and would survive a real user.
- The spec reflects REALITY, not GOALS.md's claim. If GOALS.md says [x] but the code shows the feature is stubbed, you assess \`partial\` and write accordingly.
- Use the project's existing conventions (stack, validation style, auth, error handling, naming) discovered from the code and CLAUDE.md. Don't invent new patterns when the project has an established one.
- Be specific in build/gap specs. "User can log in" is not a spec; "User enters email + password, server validates against bcrypt hash, sets HttpOnly secure cookie, redirects to /dashboard" is.
- For \`not_started\` and \`partial\` specs you MAY do a handful of targeted web searches (and optional WebFetch) for best-in-class patterns relevant to the gap — focused, not exhaustive. For \`done\` specs, skip web research: you are documenting what already exists.

OUTPUT: only the spec markdown, starting with "# SPEC:". No preamble, no explanation.

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

  // Filter to requested milestones. Explicit IDs always win (one-click backfill
  // of a specific spec stays one-click). Otherwise default to unchecked, non-skipped
  // milestones — the ones still to build. Set includeDone to also spec done ones
  // (useful for backfilling docs of existing code). Skipped milestones are always
  // excluded from automatic generation; pass explicit milestoneIds to override.
  const targets = opts.milestoneIds
    ? allMilestones.filter((m) => opts.milestoneIds!.includes(m.id))
    : opts.includeDone
      ? allMilestones.filter((m) => !m.skipped)
      : allMilestones.filter((m) => !m.checked && !m.skipped)

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

    const prompt = buildSpecPrompt({
      projectName,
      detectedStack,
      goalsMdContent,
      milestoneText: milestone.text,
      phase: milestone.phase,
      goalsMarker: milestone.checked,
      projectFileTree,
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
        appendSystemPrompt: `You are the Sneebly Spec Architect. Discover the related code first, assess the milestone's ACTUAL state from that code (done/partial/not_started) — never trust the GOALS.md marker — then write a spec whose shape matches the assessed state. Back every claim with specific file:line evidence; bias toward "partial" when uncertain. Output the complete spec document starting with "# SPEC:" — nothing else.`,
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

// ── Spec refinement ───────────────────────────────────────────────────────────

export interface SpecRefineOptions {
  projectPath: string
  projectId: string
  milestoneId: string
  refinementPrompt: string
  mode: RefineMode
  onProgress: (event: SpecProgressEvent) => void
}

export interface SpecRefineResult {
  success: boolean
  error?: string
  specPath?: string
}

function buildEditOnlyPrompt(opts: {
  projectName: string
  milestoneText: string
  phase: string
  existingSpecContent: string
  refinementPrompt: string
}): string {
  return `You are the Sneebly Spec Architect refining an existing implementation spec.

CONTEXT:
- Project: ${opts.projectName}
- Milestone: "${opts.milestoneText}" (under ${opts.phase})

EXISTING SPEC (do not throw away — refine it):
---
${opts.existingSpecContent}
---

USER'S REFINEMENT INSTRUCTIONS:
"${opts.refinementPrompt}"

YOUR TASK:
- Edit the spec to address the user's specific concerns
- Preserve what's already good — do NOT throw away well-researched sections
- Do NOT do new web searches — work from existing content and the user's notes
- Maintain the same markdown template structure (headings, hierarchy)
- If the user's request requires removing sections, do so cleanly
- If the user's request adds new requirements, add them in the appropriate sections
- Output the COMPLETE revised spec — not a diff, not a summary

Begin.`
}

function buildResearchRefinementPrompt(opts: {
  projectName: string
  detectedStack: string
  goalsMdContent: string
  milestoneText: string
  phase: string
  projectFileTree: string
  existingSpecContent: string
  refinementPrompt: string
}): string {
  return `You are the Sneebly Spec Architect refining an existing implementation spec with NEW research.

CONTEXT:
- Project: ${opts.projectName}
- Stack: ${opts.detectedStack}
- Milestone: "${opts.milestoneText}" (under ${opts.phase})
- Full GOALS.md content:
${opts.goalsMdContent}

- Existing project structure:
${opts.projectFileTree}

EXISTING SPEC (the user wants this changed):
---
${opts.existingSpecContent}
---

USER'S REFINEMENT INSTRUCTIONS:
"${opts.refinementPrompt}"

YOUR PROCESS:
1. Identify what specifically the user wants changed
2. Do 10-20 web searches targeted at the user's concerns
3. Optionally use WebFetch on 1-2 reference URLs if needed
4. Synthesize an improved spec that:
   - Addresses the user's specific concerns with new research
   - Preserves valid sections from the existing spec
   - Adds new information where the user's request demands it
   - Maintains the same markdown template structure
5. Output the COMPLETE revised spec — starting with "# SPEC:"

Begin.`
}

export async function refineSpec(opts: SpecRefineOptions): Promise<SpecRefineResult> {
  const { projectPath, projectId, milestoneId, refinementPrompt, mode, onProgress } = opts

  onProgress({ type: 'start' })

  // Find milestone
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) {
    const err = 'GOALS.md not found in project root.'
    onProgress({ type: 'error', error: err })
    return { success: false, error: err }
  }
  const goalsMdContent = readFileSync(goalsPath, 'utf-8')
  const milestone = parseMilestones(goalsMdContent).find((m) => m.id === milestoneId)
  if (!milestone) {
    const err = `Milestone not found in GOALS.md: ${milestoneId}`
    onProgress({ type: 'error', error: err })
    return { success: false, error: err }
  }

  // Find existing spec
  const specFileName = `SPEC_${milestone.specSlug}.md`
  const specFilePath = join(projectPath, 'specs', specFileName)
  if (!existsSync(specFilePath)) {
    const err = `Spec file "${specFileName}" does not exist. Generate it first.`
    onProgress({ type: 'error', error: err })
    return { success: false, error: err }
  }
  const existingSpecContent = readFileSync(specFilePath, 'utf-8')

  const model: 'claude-sonnet-4-6' | 'claude-opus-4-8' = mode === 'edit-only' ? 'claude-sonnet-4-6' : 'claude-opus-4-8'
  const allowedTools: string[] = mode === 'edit-only'
    ? ['Read', 'Glob', 'Grep']
    : ['Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch']

  const projectName = detectProjectName(projectPath)
  const prompt = mode === 'edit-only'
    ? buildEditOnlyPrompt({ projectName, milestoneText: milestone.text, phase: milestone.phase, existingSpecContent, refinementPrompt })
    : buildResearchRefinementPrompt({
        projectName,
        detectedStack: detectStack(projectPath),
        goalsMdContent,
        milestoneText: milestone.text,
        phase: milestone.phase,
        projectFileTree: getFileTree(projectPath),
        existingSpecContent,
        refinementPrompt,
      })

  onProgress({ type: 'milestone-start', milestoneId: milestone.id, milestoneText: milestone.text })

  try {
    const turnResult = await runStandaloneTurn({
      cwd: projectPath,
      projectId,
      prompt,
      model,
      permissionMode: 'bypassPermissions',
      maxTurns: mode === 'edit-only' ? 5 : 30,
      allowedTools,
      appendSystemPrompt: `You are the Sneebly Spec Architect. Output the complete revised spec document — nothing else. Start with "# SPEC:".`,
      onEvent: (event) => {
        onProgress({ type: 'milestone-event', milestoneId: milestone.id, agentEvent: event })
      },
    })

    let specMd = turnResult.assistantText.trim()
    if (!specMd.startsWith('# SPEC:')) {
      const match = specMd.match(/# SPEC:[\s\S]+/)
      specMd = match ? match[0].trim() : specMd
    }

    writeFileSync(specFilePath, specMd, 'utf-8')
    onProgress({ type: 'milestone-done', milestoneId: milestone.id, milestoneText: milestone.text })
    onProgress({ type: 'complete', generatedCount: 1, skippedCount: 0 })
    return { success: true, specPath: specFilePath }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onProgress({ type: 'error', milestoneId: milestone.id, error: errMsg })
    return { success: false, error: errMsg }
  }
}
