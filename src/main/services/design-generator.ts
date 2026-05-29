import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { runStandaloneTurn } from './standalone-turn'
import type { ArtifactKind } from '../../shared/types'

// ─── Process registry ─────────────────────────────────────────────────────────

// Maps generationId → child process so individual variants can be cancelled.
const processes = new Map<string, ChildProcess>()

// ─── Skill loader ─────────────────────────────────────────────────────────────

const SKILL_FILENAME = join('.claude', 'skills', 'design-generator', 'SKILL.md')

const FALLBACK_SKILL = `You are a UI designer. Output ONLY a single fenced code block of html, jsx, svg, or mermaid. No explanation or commentary.`

function loadSkillPrompt(projectPath: string): string {
  const p = join(projectPath, SKILL_FILENAME)
  if (existsSync(p)) {
    try { return readFileSync(p, 'utf-8').trim() } catch { /* fall through */ }
  }
  // Try the Sneebly interface's own skill (for dogfooding the tool on itself)
  const own = join(process.cwd(), SKILL_FILENAME)
  if (existsSync(own)) {
    try { return readFileSync(own, 'utf-8').trim() } catch { /* fall through */ }
  }
  return FALLBACK_SKILL
}

// ─── extractCodeBlock ─────────────────────────────────────────────────────────

export function extractCodeBlock(text: string): { code: string; kind: ArtifactKind } | null {
  const LANG_MAP: Record<string, ArtifactKind> = {
    html: 'html',
    jsx: 'react',
    tsx: 'react',
    svg: 'svg',
    mermaid: 'mermaid',
  }
  // \w* (not \w+) — tolerates bare ``` blocks; \r?\n handles both Unix and Windows line endings
  const match = /```(\w*)\s*\r?\n([\s\S]*?)\r?\n```/.exec(text)
  if (!match) return null
  const lang = match[1]!.toLowerCase()
  const code = match[2]!.trim()
  if (!code) return null
  const kind = LANG_MAP[lang]
  if (kind) return { code, kind }
  // Unknown/missing language tag — infer from content, fall back to html
  if (code.startsWith('<svg')) return { code, kind: 'svg' }
  if (/<html|<!DOCTYPE/i.test(code)) return { code, kind: 'html' }
  return { code, kind: 'html' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateResult {
  generationId: string
  code: string
  kind: ArtifactKind
}

interface GenerateCallbacks {
  onResult: (result: GenerateResult) => void
  onError: (generationId: string, error: string) => void
}

// Style hints for variant diversity
const VARIANT_STYLES = [
  'minimalist and clean, lots of white space',
  'bold and expressive, strong typography',
  'playful and colorful, rounded shapes',
  'professional and corporate, structured grid',
  'dark and moody, high contrast',
  'warm and friendly, soft colors',
  'futuristic and technical, data-driven',
  'elegant and refined, subtle details',
]

// ─── Single generation ────────────────────────────────────────────────────────

async function runGeneration(
  generationId: string,
  opts: {
    projectId: string
    projectPath: string
    prompt: string
    projectContext?: string
  },
  callbacks: GenerateCallbacks
): Promise<void> {
  const skillPrompt = loadSkillPrompt(opts.projectPath)
  const systemParts = [skillPrompt, opts.projectContext].filter(Boolean)
  try {
    const result = await runStandaloneTurn({
      cwd: opts.projectPath,
      projectId: opts.projectId,
      prompt: opts.prompt,
      model: 'claude-sonnet-4-6',
      appendSystemPrompt: systemParts.join('\n\n---\n\n'),
      // Disable all tools — design generation is text-in/text-out. Without this,
      // claude runs with bypassPermissions (the default) and reads the project's
      // CLAUDE.md + any files it references (CONTEXT.md, GOALS.md), which floods
      // the context with domain detail and overrides the user's design intent.
      extraArgs: ['--tools', ''],
      // Turn accounting: each assistant message (text OR tool_use) consumes one turn.
      // maxTurns: 1 fails when the model takes any sequential thinking/output steps.
      // maxTurns: 5 covers extended thinking + a follow-up text turn. Matches the
      // fix applied to decider-agent.ts in pass 1 self-review.
      maxTurns: 5,
      onProcess: (proc) => { processes.set(generationId, proc) },
    })
    processes.delete(generationId)

    if (result.error && !result.assistantText) {
      callbacks.onError(generationId, result.error)
      return
    }

    const parsed = extractCodeBlock(result.assistantText)
    if (!parsed) {
      callbacks.onError(generationId, 'No fenced code block found in response')
      return
    }

    callbacks.onResult({ generationId, code: parsed.code, kind: parsed.kind })
  } catch (err) {
    processes.delete(generationId)
    callbacks.onError(generationId, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Start a single design generation. Returns the generationId immediately;
 * result arrives via callbacks asynchronously.
 */
export function startDesignGeneration(
  opts: {
    projectId: string
    projectPath: string
    prompt: string
    parentFrameCode?: string
    parentFramePrompt?: string
    projectContext?: string
  },
  callbacks: GenerateCallbacks
): string {
  const generationId = `dg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  let prompt = opts.prompt
  if (opts.parentFrameCode && opts.parentFramePrompt) {
    prompt = [
      `Original design prompt: ${opts.parentFramePrompt}`,
      ``,
      `Original code:`,
      `\`\`\``,
      opts.parentFrameCode,
      `\`\`\``,
      ``,
      `Iteration request: ${opts.prompt}`,
      ``,
      `Produce a variation of the above that precisely applies the iteration request.`,
    ].join('\n')
  }

  setImmediate(() => {
    runGeneration(generationId, { ...opts, prompt }, callbacks).catch((err: unknown) => {
      callbacks.onError(generationId, err instanceof Error ? err.message : String(err))
    })
  })

  return generationId
}

/**
 * Start N parallel design generations (variant mode). Returns all generationIds
 * immediately; results arrive via callbacks as each subprocess completes.
 */
export function startVariantGeneration(
  opts: {
    projectId: string
    projectPath: string
    prompt: string
    count: number
    projectContext?: string
  },
  callbacks: GenerateCallbacks
): string[] {
  const count = Math.min(Math.max(opts.count, 1), 8)
  const generationIds: string[] = []

  for (let i = 0; i < count; i++) {
    const generationId = `dg-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
    generationIds.push(generationId)
    const styleHint = VARIANT_STYLES[i % VARIANT_STYLES.length]!
    const variantPrompt = `${opts.prompt}\n\nVariant ${i + 1} of ${count}: focus on a ${styleHint} aesthetic.`

    setImmediate(() => {
      runGeneration(
        generationId,
        { projectId: opts.projectId, projectPath: opts.projectPath, prompt: variantPrompt, projectContext: opts.projectContext },
        callbacks
      ).catch((err: unknown) => {
        callbacks.onError(generationId, err instanceof Error ? err.message : String(err))
      })
    })
  }

  return generationIds
}

/**
 * Kill the subprocess for a single generationId. If the subprocess has already
 * finished, this is a no-op.
 */
export function cancelDesignGeneration(generationId: string): void {
  const proc = processes.get(generationId)
  if (proc) {
    proc.kill()
    processes.delete(generationId)
  }
}
