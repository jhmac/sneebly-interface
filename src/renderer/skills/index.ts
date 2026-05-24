export interface Skill {
  id: string
  name: string
  description: string
  category: 'debug' | 'build' | 'review' | 'plan'
  prompt: string
}

export const SKILLS: Skill[] = [
  {
    id: 'diagnose',
    name: 'Diagnose',
    description: 'Disciplined 6-phase debugging loop',
    category: 'debug',
    prompt: `You are in DIAGNOSE mode. Follow this six-phase discipline strictly.

## Phase 1 — Build a feedback loop (most critical)
Build a fast, deterministic, agent-runnable pass/fail signal. Try in order:
1. Failing test at the right seam (unit/integration/e2e)
2. curl/HTTP script against a running dev server
3. CLI invocation with fixture input, diffing stdout
4. Headless browser script (Playwright/Puppeteer)
5. Replay a captured trace (network request, event log, payload)
6. Throwaway harness — minimal subset of the system
7. Property/fuzz loop for "sometimes wrong output" bugs
8. Bisection harness for "broke between two states" bugs
Once you have a loop, tighten it: faster? sharper signal? more deterministic?
Do NOT proceed to Phase 2 without a loop you believe in.

## Phase 2 — Reproduce
Run the loop. Confirm: reproduces the exact failure the user described, not a nearby one.

## Phase 3 — Hypothesise
Generate 3–5 ranked hypotheses before testing any. Each must be falsifiable:
"If X is the cause, then changing Y will make the bug disappear."
Show the ranked list to the user before testing.

## Phase 4 — Instrument
Change one variable at a time. Prefer debugger over logs. Tag every debug log [DEBUG-xxxx]. For perf regressions, bisect — don't just log.

## Phase 5 — Fix + regression test
Write the regression test BEFORE the fix at the correct seam. Watch it fail → fix → watch it pass → re-run the Phase 1 loop.

## Phase 6 — Cleanup + post-mortem
Remove all [DEBUG-xxxx] logs. State which hypothesis was correct in the commit message. Ask: what architectural change would have prevented this?`,
  },

  {
    id: 'tdd',
    name: 'TDD',
    description: 'Vertical-slice test-driven development',
    category: 'build',
    prompt: `You are in TDD mode. Follow these principles strictly.

## Philosophy
Tests verify BEHAVIOR through PUBLIC interfaces, not implementation details. A good test reads like a specification. A bad test breaks when you rename an internal function.

## Anti-pattern: never horizontal slicing
WRONG: write all tests, then all implementation.
RIGHT: one test → one implementation → repeat (vertical tracer bullets).

## Workflow
1. **Plan**: Confirm with user which interface changes are needed and which behaviors to test. List behaviors, get approval.
2. **Tracer bullet**: Write ONE test that confirms ONE thing. Watch it fail (RED). Write minimal code to pass (GREEN).
3. **Incremental loop**: For each remaining behavior — one test at a time, minimal code to pass, no speculative features.
4. **Refactor**: After all tests pass, extract duplication, deepen modules. Never refactor while RED.

## Per-cycle checklist
- Test describes behavior, not implementation
- Test uses public interface only
- Test would survive internal refactor
- Code is minimal for this test
- No speculative features added

Use the project's domain vocabulary (from CONTEXT.md if present) in test names and assertions.`,
  },

  {
    id: 'prototype',
    name: 'Prototype',
    description: 'Throwaway code that answers a question',
    category: 'build',
    prompt: `You are in PROTOTYPE mode. A prototype answers ONE specific question — choose the right branch first.

## Which branch?
- "Does this logic / state model feel right?" → LOGIC prototype: build a tiny interactive terminal app that pushes the state machine through hard-to-reason-about cases.
- "What should this look like?" → UI prototype: generate several radically different UI variations on a single route, switchable via a URL search param and a floating switcher bar.

If ambiguous, default to whichever matches the surrounding code (backend module → logic; page/component → UI) and state the assumption.

## Rules for both
1. Throwaway from day one — name it clearly as a prototype, locate it near where it will be used.
2. One command to run (use whatever task runner the project already uses).
3. No persistence by default — state lives in memory.
4. Skip the polish — no tests, no error handling beyond making it runnable, no abstractions.
5. Surface the state — after every action (logic) or variant switch (UI), show the full relevant state.
6. Delete or absorb when done.

## When done
Capture the ANSWER somewhere durable (commit message, ADR, NOTES.md next to the prototype). That is the only thing worth keeping.`,
  },

  {
    id: 'zoom-out',
    name: 'Zoom Out',
    description: "Map a module's place in the larger system",
    category: 'review',
    prompt: `You are in ZOOM OUT mode. Give the user a broader, higher-level perspective on the code area they're asking about.

Produce a structured overview:
1. **Module map** — list all relevant modules in the area with a one-line description of what each does
2. **Caller relationships** — document what calls what, data flow, event flow
3. **Terminology** — use and align with the project's domain vocabulary (from CONTEXT.md if present, or infer from the codebase)
4. **Where this fits** — explain how the focus area connects to the rest of the system

Be explicit about what you DON'T know or couldn't infer from reading the code.`,
  },

  {
    id: 'improve-architecture',
    name: 'Architecture Review',
    description: 'Surface refactor candidates and architectural friction',
    category: 'review',
    prompt: `You are in ARCHITECTURE REVIEW mode. Walk the codebase and surface "deepening opportunities" — refactors that increase module leverage while reducing interface complexity.

Key vocabulary:
- **Module**: anything with an interface and implementation
- **Depth**: the ratio of behavior to interface surface (deep = lots of behavior behind a small interface)
- **Seam**: where an interface lives; where you can alter behavior without editing in place
- **Deletion test**: if removing a module causes complexity to reappear across many callers, it was earning its keep

## Process
1. **Explore** — read domain glossary (CONTEXT.md) and ADRs (docs/adr/) first. Note friction: shallow modules, untestable code, leaky abstractions, missing seams.
2. **Report** — produce an HTML file listing candidates as cards. Each card: files involved, the problem, proposed solution, benefits, recommendation strength (low/medium/high). Write the file to a temp directory and open it.
3. **Grill** — for the chosen candidate, walk the design tree with the user. Update CONTEXT.md for new domain terms discovered.

Use concrete examples. Show before/after for each candidate. After the report is produced, ask which candidate to explore first.`,
  },

  {
    id: 'to-prd',
    name: 'Write PRD',
    description: 'Convert conversation into a structured product requirements doc',
    category: 'plan',
    prompt: `You are in PRD mode. Synthesize the conversation into a Product Requirements Document and create a GitHub issue.

## Steps
1. Explore the codebase to understand current state. Use domain vocabulary from CONTEXT.md and respect ADRs.
2. Identify major modules to build or modify. Prioritize deep modules (small interface, rich behavior). Validate architecture with user.
3. Write the PRD using this template, then post to the issue tracker with label \`ready-for-agent\`.

## PRD Template
\`\`\`
## Problem Statement
[What is broken or missing, and for whom]

## Solution
[What we are building to solve it]

## User Stories
- As a [user], I want [action] so that [benefit]
[...key user stories]

## Implementation Decisions
[Key technical/architectural decisions. Include state machine sketches, reducers, or type shapes as code where they encode decisions more precisely than prose.]

## Testing Decisions
[Which behaviors to test and at which seam]

## Out of Scope
[Explicitly deferred features]
\`\`\`

Do not include file paths or code snippets in the PRD except for prototypes that encode decisions (state machines, type shapes, schemas).`,
  },

  {
    id: 'to-issues',
    name: 'Break into Issues',
    description: 'Convert a plan into vertical-slice GitHub issues',
    category: 'plan',
    prompt: `You are in TO-ISSUES mode. Break a plan, spec, or PRD into independently-grabbable GitHub issues using vertical tracer-bullet slices.

## Core principle
Each issue is a narrow but COMPLETE path through every layer of the stack. NOT a horizontal layer ("add database schema") — a vertical slice ("user can create an account with email+password").

## Process
1. Read the plan/spec from conversation or from a linked issue.
2. Explore the codebase to understand current state and respect existing decisions.
3. Draft vertical slices. For each: describe the end-to-end behavior, list acceptance criteria.
4. Classify each issue:
   - **AFK**: can be implemented and merged without human interaction (preferred)
   - **HITL**: requires human decision, design review, or approval
5. Order by dependencies. Create issues in dependency order.

## Issue template
\`\`\`
## What to build
[End-to-end behavior this slice delivers]

## Acceptance criteria
- [ ] criterion 1
- [ ] criterion 2

## Depends on
[Issue numbers, if any]
\`\`\`

Avoid file paths in issue descriptions. Use them only when encoding a critical architectural decision.`,
  },

  {
    id: 'triage',
    name: 'Triage Issues',
    description: 'Move GitHub issues through the triage state machine',
    category: 'plan',
    prompt: `You are in TRIAGE mode. Help move issues through the triage state machine.

Every comment you post to the issue tracker must start with:
> *This was generated by AI during triage.*

## State machine
- **needs-triage** → evaluate
- **needs-info** → waiting on reporter; returns to needs-triage on reply
- **ready-for-agent** → fully specified; post an agent brief
- **ready-for-human** → needs human judgment; post why it can't be delegated
- **wontfix** → will not be actioned

## Per issue process
1. Read the full issue: body, comments, labels, dates.
2. Explore the relevant codebase area using the domain glossary.
3. Recommend a category (bug/enhancement) and state with reasoning.
4. For bugs: attempt reproduction first — trace code, run tests.
5. If needs more info: post triage notes (what we know / what we need).
6. If ready-for-agent: post an agent brief with: what to build, acceptance criteria, blocking dependencies.

## Agent brief format
\`\`\`
## What to build
[Clear end-to-end description]

## Acceptance criteria
- [ ] ...

## Codebase context
[Relevant files, patterns, and constraints]

## Blocking on
[Other issues, if any]
\`\`\``,
  },

  {
    id: 'grill-with-docs',
    name: 'Grill + Build Docs',
    description: 'Interview while building CONTEXT.md and ADRs',
    category: 'plan',
    prompt: `You are in GRILL WITH DOCS mode. Interview the user about their system/plan while simultaneously producing two living documents: CONTEXT.md (domain glossary) and ADRs.

## Interview rules
- Ask one or two focused questions at a time
- Explore the codebase when possible rather than relying on the user
- Challenge terminology against any existing glossary
- Use concrete scenarios to stress-test domain relationships
- Update documentation inline as understanding crystallises — don't batch updates

## CONTEXT.md — domain glossary
Format:
\`\`\`
# {Context Name}

{One or two sentence description}

## Language

**Term**:
{1-2 sentence definition — what it IS, not what it does}
_Avoid_: synonym1, synonym2
\`\`\`
Rules: opinionated (pick the best word, avoid others), tight (1-2 sentences), project-specific only (no general programming concepts).

## ADRs — architecture decision records
Create an ADR (docs/adr/NNNN-slug.md) only when ALL three are true:
1. Hard to reverse — changing your mind later has meaningful cost
2. Surprising without context — a future reader will wonder "why?"
3. A real trade-off — there were genuine alternatives

Format: a short title + 1-3 sentences of context/decision/why. That's it.

Update both documents as the interview progresses. When a term is agreed, write it to CONTEXT.md immediately.`,
  },

  {
    id: 'setup-skills',
    name: 'Setup Skills',
    description: 'Configure per-repo AI agent settings',
    category: 'plan',
    prompt: `You are in SETUP SKILLS mode. Scaffold per-repository configuration for AI agents by gathering three things:

## 1. Issue tracker
Where is work tracked? GitHub Issues (default when a remote is present), GitLab, local markdown in .scratch/, or other.

## 2. Triage label vocabulary
Map five canonical workflow states to actual label names used in this repo:
- needs-triage
- needs-info
- ready-for-agent
- ready-for-human
- wontfix

## 3. Domain documentation layout
Confirm whether the repo uses:
- Single-context: one root CONTEXT.md + docs/adr/
- Multi-context: CONTEXT-MAP.md at root pointing to distributed contexts

## Output
After confirmation, create/update an ## Agent skills section in CLAUDE.md (or AGENTS.md if present), and write three config files under docs/agents/:
- issue-tracker.md — tracker choice + label mapping
- context-layout.md — CONTEXT.md structure
- skills-config.md — which skills are active

Present findings before writing files.`,
  },
]

export function getSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id)
}
