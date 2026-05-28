import { runStandaloneTurn, extractJson } from './standalone-turn'
import type { ModelName } from '../../shared/types'

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface SpecAcceptorResult {
  pass: boolean
  issues: string[]       // empty when pass === true
  summary: string        // one-sentence verdict
  durationMs: number
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a spec conformance verifier for an autonomous software build pipeline.

Your job: determine whether a software implementation satisfies its milestone specification.

You will be given:
1. The milestone specification (what should be built)
2. File paths changed during the build — use these as starting hints for what to read

Your process:
1. Read the specification and identify the concrete, testable requirements
2. Read the changed files using the Read tool to understand what was actually implemented
3. Use Grep if you need to search for specific functionality across the codebase
4. Output a JSON verdict

Pass criteria (be calibrated, not pedantic):
- The core features described in the spec are present in the implementation
- The primary user-facing functionality exists and appears connected
- Required integration points (APIs, routes, data models) are in place

Fail criteria (only clear, concrete gaps):
- An entire feature section of the spec is completely absent from the implementation
- A required data model, API route, or UI component does not exist anywhere in the changed files
- A critical wiring step explicitly described in the spec (e.g., "connect X to Y") was not done

Do NOT fail for:
- Code style, comments, or refactoring opportunities
- Implementation details that differ from what the spec imagined but achieve the same result
- Tests, unless the spec explicitly requires tests to be written
- Nice-to-haves or "could" / "may" language in the spec
- Missing error handling for edge cases not mentioned in the spec

Output ONLY valid JSON — no prose, no markdown fences:

{
  "pass": true | false,
  "issues": ["specific unmet requirement from the spec", ...],
  "summary": "one sentence explaining the verdict"
}

"issues" must be an empty array when pass is true.
Each issue must name a specific, concrete requirement from the spec — not a general observation.`

// ─── Internal parsed shape ────────────────────────────────────────────────────

interface AcceptorOutput {
  pass: boolean
  issues: unknown[]
  summary: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the spec acceptor agent for a milestone.
 *
 * The agent reads the spec and the changed files, then produces a pass/fail
 * verdict with a list of specific unmet requirements.
 *
 * Returns null on any failure (timeout, parse error, agent error) — callers
 * treat null as pass-through so builds are never blocked by acceptor failures.
 */
export async function runSpecAcceptorAgent(opts: {
  projectPath: string
  projectId: string
  specText: string
  milestoneText: string
  changedFiles: string[]   // project-relative paths, used as Read hints
  model: ModelName
}): Promise<SpecAcceptorResult | null> {
  const { projectPath, projectId, specText, milestoneText, changedFiles, model } = opts

  const fileHints = changedFiles.length > 0
    ? `\n\n## Files changed during this build\n` +
      `Read the relevant ones to understand the implementation:\n` +
      changedFiles.map((f) => `- ${f}`).join('\n')
    : '\n\n## Files changed during this build\nNone tracked — explore the project directory for relevant files.'

  const prompt = [
    `## Milestone`,
    milestoneText,
    ``,
    `## Specification`,
    specText,
    fileHints,
    ``,
    `Verify the implementation against the spec and output the JSON verdict.`,
  ].join('\n')

  let result: Awaited<ReturnType<typeof runStandaloneTurn>>
  try {
    result = await runStandaloneTurn({
      cwd: projectPath,
      projectId,
      prompt,
      model,
      permissionMode: 'default',
      // Read-only: observe but never touch the codebase.
      // Turn accounting (each assistant message = 1 turn, tool results are not counted):
      //   turns 1–6: sequential Read / Grep calls to inspect the implementation
      //   turn 7:    final JSON verdict
      // maxTurns: 7 accommodates up to 6 file reads before the answer.
      allowedTools: ['Read', 'Grep', 'Glob'],
      maxTurns: 7,
      appendSystemPrompt: SYSTEM_PROMPT,
    })
  } catch (e) {
    console.error('[spec-acceptor-agent] runStandaloneTurn threw:', e)
    return null
  }

  if (result.error) {
    console.warn('[spec-acceptor-agent] agent error:', result.error)
    return null
  }
  if (!result.assistantText) {
    console.warn('[spec-acceptor-agent] no text output from agent')
    return null
  }

  const parsed = extractJson<AcceptorOutput>(result.assistantText)
  if (!parsed || typeof parsed.pass !== 'boolean' || !Array.isArray(parsed.issues)) {
    console.warn('[spec-acceptor-agent] could not parse JSON verdict from output')
    return null
  }

  const issues = parsed.issues
    .filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
    .slice(0, 10)

  // A fail verdict with no issues is unactionable — we can't tell the fix turn
  // what to fix. Treat as pass-through rather than triggering a useless fix turn.
  if (!parsed.pass && issues.length === 0) {
    console.warn('[spec-acceptor-agent] agent returned pass=false with no issues — treating as pass-through')
    return null
  }

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : parsed.pass
      ? 'Implementation satisfies spec.'
      : 'Implementation is missing spec requirements.'

  const verdict = parsed.pass ? 'PASS' : `FAIL (${issues.length} issue${issues.length !== 1 ? 's' : ''})`
  console.log(`[spec-acceptor-agent] ${verdict} in ${result.durationMs}ms — ${summary}`)
  if (!parsed.pass && issues.length > 0) {
    console.log(`[spec-acceptor-agent] issues:\n${issues.map((i) => `  · ${i}`).join('\n')}`)
  }

  return { pass: parsed.pass, issues, summary, durationMs: result.durationMs }
}
