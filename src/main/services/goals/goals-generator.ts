import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { runStandaloneTurn } from '../standalone-turn'
import type { GrillMessage } from '../../../shared/types'

export type { GrillMessage }

const READY_MARKER = '[[READY_TO_GENERATE]]'

// ── Grill system prompt ────────────────────────────────────────────────────────

const GRILL_SYSTEM = `You are the Sneebly App Strategist. Your job is to interview a user about their app idea and help them produce a clear, well-structured brief — enough to write a GOALS.md file and a Replit build prompt.

PROCESS:
- Ask focused follow-up questions one or two at a time — do not overwhelm the user with a list of ten questions.
- Probe for: the core problem being solved, who the target user is, what the key workflows are, what success looks like, any monetization model, and any hard constraints.
- Avoid asking about tech stack — Replit will choose that.
- When you have gathered enough to write a complete GOALS.md and build prompt (usually after 4-8 exchanges), append exactly this marker on its own line at the end of your response: ${READY_MARKER}
- Never append the marker before you have enough information to write a solid spec.
- Keep your messages concise and conversational. No bullet dumps.`

// ── Grill turn ─────────────────────────────────────────────────────────────────

export async function grillTurn(
  messages: GrillMessage[],
  userMessage: string,
): Promise<{ message: string; ready: boolean }> {
  // Build the full conversation history as a single prompt
  const history = messages
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n\n')

  const fullPrompt = history
    ? `${history}\n\nUSER: ${userMessage}\n\nASSISTANT:`
    : `USER: ${userMessage}\n\nASSISTANT:`

  const result = await runStandaloneTurn({
    cwd: homedir(),
    projectId: 'goals-wizard',
    prompt: fullPrompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
    allowedTools: [],
    appendSystemPrompt: GRILL_SYSTEM,
  })

  const raw = result.assistantText.trim()
  const ready = raw.includes(READY_MARKER)
  const message = raw.replace(READY_MARKER, '').trim()

  return { message, ready }
}

// ── Generation prompt ──────────────────────────────────────────────────────────

function buildGenerationPrompt(ideaSeed: string, messages: GrillMessage[]): string {
  // messages[0] is always {role:'user', content: ideaSeed} — skip it to avoid duplication
  const history = messages
    .slice(1)
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n\n')

  return `You are the Sneebly App Strategist. Based on the following interview, produce three documents.

INITIAL IDEA:
${ideaSeed}

INTERVIEW TRANSCRIPT:
${history}

OUTPUT THREE DOCUMENTS in this exact format — no preamble, nothing else:

<GOALS_MD>
# Mission

[One paragraph describing the core problem and solution in plain language]

## Tech Stack

[Leave this section with just: "To be filled after Replit build — paste the Stack Report here."]

## Build Phases

### Phase 1 — [Name]

[3-8 milestone sentences separated by ·]

### Phase 2 — [Name]

[3-8 milestone sentences separated by ·]

[Continue for all phases...]
</GOALS_MD>

<BUILD_PROMPT>
Build [App Name].

[2-3 sentence description of exactly what the app does and who it's for. Focus on what to build, not how.]

Core features:
- [Feature 1]
- [Feature 2]
- [Feature 3]
[...all core features]

User flows:
- [Flow 1: step-by-step user journey]
- [Flow 2]
[...all key flows]

Requirements:
- [Non-functional requirement 1 — performance, security, scale, etc.]
- [Requirement 2]
[...]

When you finish building, output a Stack Report in this exact format so the developer can configure their project management tool:

---STACK REPORT---
Language: [e.g. TypeScript]
Framework: [e.g. Next.js 14]
Database: [e.g. PostgreSQL via Supabase]
ORM: [e.g. Drizzle ORM]
Styling: [e.g. Tailwind CSS]
Auth: [e.g. Supabase Auth]
Deployment: [e.g. Vercel]
Other: [any other significant libraries]
---END STACK REPORT---
</BUILD_PROMPT>

<CONTEXT_MD>
# [App Name]

[One or two sentence description of what this project does and who it serves.]

## Language

[For each important domain term, one entry in this format:]
**[Term]**:
[1-2 sentence definition — what it IS, not what it does]
_Avoid_: [synonyms to not use]

[Include 5-10 terms that are central to this domain: the main entities, key actions, and any non-obvious vocabulary used in the interview.]
</CONTEXT_MD>

Generate all three documents now.`
}

// ── Generate goals + build prompt ──────────────────────────────────────────────

export async function generateGoalsAndPrompt(
  ideaSeed: string,
  messages: GrillMessage[],
): Promise<{ goalsMd: string; buildPrompt: string; contextMd: string }> {
  const prompt = buildGenerationPrompt(ideaSeed, messages)

  const result = await runStandaloneTurn({
    cwd: homedir(),
    projectId: 'goals-wizard',
    prompt,
    model: 'claude-opus-4-7',
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
    allowedTools: [],
    appendSystemPrompt: `You are the Sneebly App Strategist. Output only the three XML-tagged documents. No preamble.`,
  })

  const text = result.assistantText

  const goalsMatch = text.match(/<GOALS_MD>([\s\S]*?)<\/GOALS_MD>/)
  const buildMatch = text.match(/<BUILD_PROMPT>([\s\S]*?)<\/BUILD_PROMPT>/)
  const contextMatch = text.match(/<CONTEXT_MD>([\s\S]*?)<\/CONTEXT_MD>/)

  const goalsMd = goalsMatch ? goalsMatch[1]!.trim() : text.trim()
  const buildPrompt = buildMatch ? buildMatch[1]!.trim() : ''
  const contextMd = contextMatch ? contextMatch[1]!.trim() : ''

  return { goalsMd, buildPrompt, contextMd }
}

// ── Update stack section ───────────────────────────────────────────────────────

export async function updateStackSection(
  goalsMd: string,
  stackReport: string,
): Promise<string> {
  const prompt = `You are editing a GOALS.md file. The user has pasted a Stack Report from Replit.
Replace the Tech Stack section placeholder with the actual stack information from the report.

CURRENT GOALS.MD:
${goalsMd}

STACK REPORT FROM REPLIT:
${stackReport}

OUTPUT: The complete updated GOALS.md with the Tech Stack section filled in. Nothing else.`

  const result = await runStandaloneTurn({
    cwd: homedir(),
    projectId: 'goals-wizard',
    prompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
    allowedTools: [],
    appendSystemPrompt: `Output only the updated GOALS.md content. No preamble, no explanation.`,
  })

  return result.assistantText.trim()
}

// ── Write GOALS.md / CONTEXT.md ───────────────────────────────────────────────

export function writeGoalsMd(projectPath: string, content: string): void {
  writeFileSync(join(projectPath, 'GOALS.md'), content, 'utf-8')
}

export function writeContextMd(projectPath: string, content: string): void {
  writeFileSync(join(projectPath, 'CONTEXT.md'), content, 'utf-8')
}
