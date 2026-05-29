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
    maxTurns: 5, // extended thinking or sequential output can consume >1 turn
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

## CRITICAL FORMAT RULE (read this first, twice)

In the GOALS.md "## Roadmap" section, every feature bullet MUST start with "- [ ] " — a dash, a space, an open bracket, a SPACE, a close bracket, a space. Sneebly's parser silently drops any line that doesn't match this exact pattern, and an empty roadmap means the whole build is wasted. This is a brand-new project: nothing is built yet, so EVERY feature is "- [ ] " (not started) — never "- [x] ".

Do NOT use "* Feature", "- Feature" (no checkbox), "1. Feature" (numbered), "### Phase 1 — Foundation" (em-dash), or prose paragraphs with "·" separators. Only "### Phase N: Title" headings and "- [ ] " bullets.

OUTPUT THREE DOCUMENTS in this exact format — no preamble, nothing else:

<GOALS_MD>
# [App name]

## Mission

[3-5 sentences: lead with the core user value, then the user roles, then the problem it solves. Plain language for a coding assistant — no marketing fluff.]

## Tech Stack

To be filled after Replit build — paste the Stack Report here.

## Key Features

### [Feature name]

[A full paragraph giving a downstream coding assistant enough to build this feature without re-deriving the product vision: purpose (what it accomplishes, for which user role), primary flow (the main steps the user takes and what the system does), key data/entities (the main records, fields, relationships), and rules/edge cases (validation, permissions, important states, failure handling). One "###" entry per discrete feature.]

### [Next feature]

[...]

[... one "### <Feature name>" entry per discrete feature across all phases ...]

## Roadmap

Phases ship MVP first, then advanced features.

### Phase 1: [Title]

- [ ] [Feature name] — [one-line description]
- [ ] [Feature name] — [one-line description]

### Phase 2: [Title]

- [ ] [Feature name] — [one-line description]

[... one "### Phase N: Title" per phase, one "- [ ] " bullet per feature ...]
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

## Format rules for GOALS.md (critical)

- The first line is "# [App name]" — the app's actual name, NOT the word "Mission". The product description lives under a "## Mission" heading; Sneebly parses the mission from there.
- EVERY feature in the Roadmap MUST have a matching "### [Feature name]" entry under "## Key Features", using the same feature name in both places. The Key Features paragraph is what Sneebly builds real specs from — make it a full description, never a one-liner.
- The Roadmap MUST live under a "## Roadmap" heading, with each phase as "### Phase N: [Title]" (a COLON after the number — never an em-dash) and "- [ ] Feature — description" bullets directly under it.
- Every Roadmap feature is "- [ ] " (not started) — this is a new build, nothing exists yet.
  - GOOD: "- [ ] User authentication — email/password with owner and staff roles"
  - BAD:  "* User authentication — ..."        (asterisk bullet; parser ignores it)
  - BAD:  "- User authentication — ..."        (no [ ] checkbox; parser ignores it)
  - BAD:  "### Phase 1 — Foundation"           (em-dash; use "### Phase 1: Foundation")
  - BAD:  a prose paragraph with "·" separators instead of "- [ ] " bullets
- Feature names short (3-6 words); roadmap descriptions one line. No emoji.
- Before you close the </GOALS_MD> tag, re-read the Roadmap: every feature line must begin with "- [ ] ", and the number of "- [ ] " bullets must equal the number of "### " entries under "## Key Features". If they don't match, fix it before output.

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
    model: 'claude-opus-4-8',
    permissionMode: 'bypassPermissions',
    maxTurns: 5, // extended thinking or sequential output can consume >1 turn
    allowedTools: [],
    appendSystemPrompt: `You are the Sneebly App Strategist. Output only the three XML-tagged documents, no preamble. In GOALS.md, every Roadmap feature MUST be a "- [ ] " checkbox bullet under a "### Phase N: Title" heading inside the "## Roadmap" section — never "*", a bare "-", a numbered list, an em-dash phase heading, or prose. All features are unchecked "- [ ] " (new build).`,
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
    maxTurns: 5, // extended thinking or sequential output can consume >1 turn
    allowedTools: [],
    appendSystemPrompt: `Output only the updated GOALS.md content. No preamble, no explanation.`,
  })

  return result.assistantText.trim()
}
