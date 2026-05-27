import { runStandaloneTurn, extractJson } from './standalone-turn'
import type { Decision, DeciderRunResult, ModelName } from '../../shared/types'
import type { BundledContext } from './decider-context-bundler'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DECISIONS = 20

/** Validated risk levels — defined at module scope to avoid re-allocating on every call. */
const VALID_RISKS = new Set<string>(['low', 'medium', 'high'])

// ─── System prompt ────────────────────────────────────────────────────────────

const DECIDER_SYSTEM_PROMPT = `You are the Autonomous Decider for the Sneebly phase runner.

Your job: read a milestone spec and identify every ambiguity, implicit assumption, or decision point that the build agent (Claude Code) would need to pause and ask a human about. Resolve each one autonomously using the spec text, the codebase context provided, and general software engineering best practices.

Respond ONLY with valid JSON matching this schema (no prose, no markdown, no fences):

{
  "clarified_spec": "<the original spec text, minimally rewritten to embed your decisions inline — keep it concise>",
  "decisions": [
    {
      "id": "<short-kebab-slug>",
      "question": "<the question the build agent would have asked>",
      "answer": "<your resolution>",
      "risk": "low|medium|high",
      "rationale": "<one sentence: why this answer>"
    }
  ]
}

Risk levels:
- low: textbook choice, zero ambiguity, reversible
- medium: non-obvious trade-off or convention choice; document it
- high: architectural impact, security concern, or irreversible — flag prominently

Rules:
- Maximum ${MAX_DECISIONS} decisions. If you find more, take the highest-risk ${MAX_DECISIONS}.
- Never invent requirements not present or implied by the spec.
- Do not add new features. Resolve only what the spec leaves ambiguous.
- Prefer the existing codebase's patterns over introducing new ones.
- If the spec is already unambiguous, return an empty decisions array and the spec unchanged.`

// ─── Output shape ─────────────────────────────────────────────────────────────

interface DeciderOutput {
  clarified_spec: string
  decisions: Array<{
    id: string
    question: string
    answer: string
    risk: string
    rationale: string
  }>
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runDeciderAgent(opts: {
  projectPath: string
  projectId: string
  context: BundledContext
  model: ModelName
}): Promise<DeciderRunResult | null> {
  const { projectPath, projectId, context, model } = opts

  const excerptSection =
    context.excerpts.length > 0
      ? '\n\n## Related code excerpts\n' +
        context.excerpts
          .map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``)
          .join('\n\n')
      : ''

  const prompt = `## Milestone spec\n\n${context.specText}${excerptSection}\n\nAnalyze the spec above and produce the JSON response per your instructions.`

  let result: Awaited<ReturnType<typeof runStandaloneTurn>>
  try {
    result = await runStandaloneTurn({
      cwd: projectPath,
      projectId,
      prompt,
      model,
      permissionMode: 'default',
      // Allow read-only discovery tools.
      // Turn accounting: each assistant message (tool_use OR final answer) consumes
      // one turn. Tool results returned by the harness are not counted. So:
      //   turn 1: assistant → tool_use A
      //   turn 2: assistant → tool_use B   (after seeing result A)
      //   turn 3: assistant → tool_use C   (after seeing result B)
      //   turn 4: assistant → tool_use D   (after seeing result C)
      //   turn 5: assistant → final JSON   (after seeing result D)
      // maxTurns: 5 covers up to 4 sequential tool calls before the answer.
      // Do NOT set 1 — the harness cannot reply to its own tool output in 1 turn.
      allowedTools: ['Read', 'Grep', 'Glob'],
      maxTurns: 5,
      appendSystemPrompt: DECIDER_SYSTEM_PROMPT,
    })
  } catch (e) {
    console.error('[decider-agent] runStandaloneTurn threw:', e)
    return null
  }

  if (result.error) {
    console.warn('[decider-agent] agent returned an error:', result.error)
    return null
  }
  if (!result.assistantText) {
    console.warn('[decider-agent] agent produced no text output (possible tool-only turn or empty response)')
    return null
  }

  const parsed = extractJson<DeciderOutput>(result.assistantText)
  if (!parsed || typeof parsed.clarified_spec !== 'string' || !Array.isArray(parsed.decisions)) {
    console.warn('[decider-agent] failed to parse JSON from agent output')
    return null
  }

  const decisions: Decision[] = parsed.decisions.slice(0, MAX_DECISIONS).map((d) => ({
    id: typeof d.id === 'string' ? d.id : 'unknown',
    question: typeof d.question === 'string' ? d.question : '',
    answer: typeof d.answer === 'string' ? d.answer : '',
    risk: (VALID_RISKS.has(d.risk) ? d.risk : 'low') as Decision['risk'],
    rationale: typeof d.rationale === 'string' ? d.rationale : '',
  }))

  if (parsed.decisions.length > MAX_DECISIONS) {
    console.warn(
      `[decider-agent] truncated ${parsed.decisions.length} decisions to ${MAX_DECISIONS}`,
    )
  }

  const highCount = decisions.filter((d) => d.risk === 'high').length
  const medCount = decisions.filter((d) => d.risk === 'medium').length
  console.log(
    `[decider-agent] done in ${result.durationMs}ms — ` +
    `${decisions.length} decision(s): ${highCount} high, ${medCount} medium, ` +
    `${decisions.length - highCount - medCount} low`,
  )

  return {
    clarifiedSpec: parsed.clarified_spec,
    decisions,
    decisionFilePath: '', // filled in by orchestrator after persisting
  }
}
