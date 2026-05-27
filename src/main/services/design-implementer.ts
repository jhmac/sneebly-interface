import type { ChildProcess } from 'node:child_process'
import { runStandaloneTurn } from './standalone-turn'
import type { AgentEvent, ArtifactKind } from '../../shared/types'

// ─── Process registry ─────────────────────────────────────────────────────────

const processes = new Map<string, ChildProcess>()

// ─── System prompt ────────────────────────────────────────────────────────────

const IMPLEMENT_SYSTEM_PROMPT = `You are an expert web developer. Your task is to implement a UI design into an existing project.

Guidelines:
- Read the project structure first to understand existing conventions
- Identify the right files to change (entry point, main component, layout, etc.)
- Respect the project's tech stack — do not add new dependencies
- Preserve existing functionality; only update the visual layer
- Make the design real: write actual file changes, not placeholders
- Be surgical — touch only what is necessary to implement the design`

// ─── Callbacks ────────────────────────────────────────────────────────────────

export interface ImplementCallbacks {
  onEvent: (implementId: string, event: AgentEvent) => void
  onComplete: (implementId: string) => void
  onError: (implementId: string, error: string) => void
}

// ─── startImplementation ─────────────────────────────────────────────────────

/**
 * Spawns an isolated standalone-turn to implement a design frame into the
 * project. Returns an implementId immediately; progress arrives via callbacks.
 *
 * Uses bypassPermissions (same as design-generator) — caller must validate
 * projectPath is a legitimate registered project before calling.
 */
export function startImplementation(
  opts: {
    projectId: string
    projectPath: string
    frameCode: string
    frameKind: ArtifactKind
    framePrompt: string
  },
  callbacks: ImplementCallbacks,
): string {
  const implementId = `impl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const codeFence = opts.frameKind === 'react' ? 'jsx' : opts.frameKind

  const prompt = [
    `Implement this UI design into the project.`,
    ``,
    `Design description: ${opts.framePrompt}`,
    ``,
    `Design code (${opts.frameKind}):`,
    `\`\`\`${codeFence}`,
    opts.frameCode,
    `\`\`\``,
    ``,
    `Steps:`,
    `1. Read the project structure (package.json, src/ layout, entry points).`,
    `2. Identify which files to edit to apply this design.`,
    `3. Make the changes. Write real code — no TODOs or placeholders.`,
    `4. Do not install packages or modify package.json.`,
  ].join('\n')

  setImmediate(() => {
    runStandaloneTurn({
      cwd: opts.projectPath,
      projectId: opts.projectId,
      prompt,
      model: 'claude-sonnet-4-6',
      appendSystemPrompt: IMPLEMENT_SYSTEM_PROMPT,
      permissionMode: 'bypassPermissions',
      onProcess: (proc) => { processes.set(implementId, proc) },
      onEvent: (event) => { callbacks.onEvent(implementId, event) },
    }).then((result) => {
      processes.delete(implementId)
      if (result.error && !result.assistantText) {
        callbacks.onError(implementId, result.error)
      } else {
        callbacks.onComplete(implementId)
      }
    }).catch((err: unknown) => {
      processes.delete(implementId)
      callbacks.onError(implementId, err instanceof Error ? err.message : String(err))
    })
  })

  return implementId
}

// ─── cancelImplementation ─────────────────────────────────────────────────────

export function cancelImplementation(implementId: string): void {
  const proc = processes.get(implementId)
  if (proc) {
    proc.kill()
    processes.delete(implementId)
  }
}
