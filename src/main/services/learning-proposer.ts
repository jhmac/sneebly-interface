import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { addPending, listPending } from './learning-store'
import { runShadowSession } from './shadow-session'

const PROPOSER_SYSTEM_PROMPT = `You are a learning proposer for an AI coding assistant. You receive a friction report written by the AI after a session. Extract 1-3 concrete, actionable system-prompt additions that would prevent the friction patterns described.

Output a JSON array — no other text, no markdown fences. Each element must have:
- "title": short noun phrase, max 8 words
- "rationale": one sentence explaining which friction this fixes
- "proposedChange": the exact text to inject into the system prompt (1-3 sentences, imperative mood, specific)`

interface ProposalRaw {
  title: string
  rationale: string
  proposedChange: string
}

interface OpenQuestionRaw {
  question: string
}

export async function proposeLearnings(
  projectPath: string,
  projectId: string,
  reflectionBody: string,
  frictionCount: number,
  sourceReflectionDate: string,
  opts: { runShadowSessions?: boolean } = {}
): Promise<void> {
  const result = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt: `Friction report:\n\n${reflectionBody}`,
    model: 'claude-haiku-4-5',
    permissionMode: 'bypassPermissions',
    appendSystemPrompt: PROPOSER_SYSTEM_PROMPT,
    maxTurns: 1,
  })

  if (result.error || !result.assistantText.trim()) return

  const proposals = extractJson<ProposalRaw[]>(result.assistantText)
  if (!Array.isArray(proposals)) return

  for (const p of proposals.slice(0, 3)) {
    if (typeof p.title !== 'string' || typeof p.proposedChange !== 'string') continue
    const title = p.title.trim()
    const proposedChange = p.proposedChange.trim()
    if (!title || !proposedChange) continue
    const entry = addPending(projectPath, {
      sourceReflectionDate,
      title,
      rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '',
      proposedChange,
      frictionCount,
    })
    if (opts.runShadowSessions) {
      runShadowSession(projectPath, projectId, entry.id).catch((err) => {
        console.error('[proposer] shadow session failed:', err)
      })
    }
  }
}

const OPEN_QUESTION_SYSTEM_PROMPT = `You are an open-question proposer for an AI coding assistant. You receive a friction report from a session and the current GOALS.md open-questions section. Your job is to identify one concrete, unresolved question that keeps blocking progress and is NOT already listed in GOALS.md.

Output a JSON object — no other text, no markdown fences. The object must have:
- "question": one clear question (one sentence, ending with "?") that, if answered, would prevent the described friction

If there is no meaningful new question to add, output: null`

export async function proposeOpenQuestion(
  projectPath: string,
  projectId: string,
  reflectionBody: string,
  sourceReflectionDate: string
): Promise<void> {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return

  const goalsMd = readFileSync(goalsPath, 'utf-8')

  // Don't propose if there's already a pending goals-md learning
  const alreadyPending = listPending(projectPath).some(
    (p) => p.targetScope === 'goals-md'
  )
  if (alreadyPending) return

  const prompt = [
    'Friction report:',
    '',
    reflectionBody,
    '',
    '---',
    '',
    'Current GOALS.md open questions section:',
    '',
    extractOpenQuestionsSection(goalsMd),
  ].join('\n')

  const result = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt,
    model: 'claude-haiku-4-5',
    permissionMode: 'bypassPermissions',
    appendSystemPrompt: OPEN_QUESTION_SYSTEM_PROMPT,
    maxTurns: 1,
  })

  if (result.error || !result.assistantText.trim()) return

  const raw = result.assistantText.trim()
  if (raw === 'null') return

  const parsed = extractJson<OpenQuestionRaw | null>(raw)
  if (!parsed || typeof parsed.question !== 'string') return

  const question = parsed.question.trim()
  if (!question) return

  addPending(projectPath, {
    sourceReflectionDate,
    title: question.length > 60 ? question.slice(0, 57) + '…' : question,
    rationale: 'Proposed from session friction as a recurring unresolved question.',
    proposedChange: question,
    frictionCount: 0,
    targetScope: 'goals-md',
  })
}

function extractOpenQuestionsSection(goalsMd: string): string {
  const match = goalsMd.match(/## Open Questions[\s\S]*?(?=\n## |\n*$)/)
  return match ? match[0].slice(0, 1000) : '(none yet)'
}
