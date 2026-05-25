# CLAUDE.md — sneebly-interface

Persistent context for Claude Code across sessions on this project.

## What this project is

A macOS desktop app (Electron + React + TypeScript) that replaces the awkward Claude UI + Claude Code CLI copy/paste workflow with one integrated three-panel workspace: live preview on top, Claude-style chat on bottom-left, graphical Claude Code activity view on bottom-right. Read `SPEC.md` and `ROADMAP.md` for the full design.

## Where we are

Use `git log --oneline` to figure out the current phase. Each phase is committed with a "Phase N: <name>" message. Always work on the lowest unfinished phase from `ROADMAP.md`. Don't bleed scope across phases.

## Stack

- Electron + electron-vite (electron-forge added in Phase 7)
- React 19 + TypeScript 5 strict
- Tailwind v4
- Zustand (renderer state), Zod (IPC validation), electron-store (small KV persistence)
- simple-git, keytar, @octokit/rest (Phase 6+)
- Shiki for syntax highlighting; jsdiff for Edit-card diffs

## Architecture conventions

- Engine: the right-panel agent spawns the local `claude` CLI as a subprocess (`claude -p --output-format stream-json --resume <id>`). Auth is the user's Claude Code login (Max subscription). Do NOT use @anthropic-ai/claude-agent-sdk or set ANTHROPIC_API_KEY in this project.
- Main process owns: filesystem, child processes (dev server, claude CLI), git ops, project registry, GitHub auth
- Renderer owns: all UI
- All IPC payloads are Zod-validated on both sides
- Renderer NEVER touches `fs` directly — everything goes through main via IPC
- Shared types in `src/shared/types.ts`
- IPC channel names in `src/shared/ipc-channels.ts`
- One Zustand store per concern; no global Redux
- Dark theme using Tailwind zinc/neutral palette

## Don't

- Don't run `npm run dev` yourself in Bash — it times out at 30s and you can't see the result. Ask the user to run it in their own terminal and report back.
- Don't add features outside the current phase's deliverables in `ROADMAP.md`.
- Don't add new top-level dependencies without naming them in your plan first.
- Don't write documentation files unless requested.
- Don't use emoji in code or commit messages.

## Available MCP tools

- `browser_check` — Load a URL in headless Chromium and return rendered DOM, console messages, network requests, CSP violations, and a screenshot. USE THIS instead of installing Playwright in user projects. When you need to verify a webpage renders, debug a blank page, check console errors, or inspect network failures, call `browser_check` with the URL. Output includes `#root` children count (useful for confirming React mounted), body background, console errors, failed requests, CSP violations, and screenshot path. The tool is registered via `--mcp-config` on every agent turn — no install step needed.

## Available skills

All project-scoped, in `.claude/skills/`. Canonical source: Matt Pocock's skills repo. These are now the single source of truth for the in-app Skills dropdown (see `src/renderer/skills/index.ts`).

**Plan / strategy:**

- `grill-with-docs` — Socratic-style grilling: one question at a time with a recommended answer, cross-referenced against the codebase, updates `CONTEXT.md` and `docs/adr/` inline as terms resolve. Use before non-trivial changes to stress-test against the project's language.
- `to-prd` — synthesise the current conversation into a structured PRD (problem, solution, user stories, implementation/testing decisions, out-of-scope). Use when ready to lock down a plan.
- `to-issues` — break a PRD into vertical-slice GitHub Issues, classified AFK-safe vs HITL.
- `triage` — issue state machine: unlabeled → needs-triage → needs-info / ready-for-agent / ready-for-human / wontfix.
- `setup-matt-pocock-skills` — bootstraps per-repo AI config (issue tracker, triage label vocab, domain doc layout). Prerequisite for to-prd / to-issues / triage if they need configured tracker info.

**Build / change:**

- `tdd` — vertical-slice TDD with red-green-refactor; one test → one impl at a time; behaviour-only assertions through public interfaces. See sibling `tests.md`, `mocking.md`, `deep-modules.md`, `interface-design.md`, `refactoring.md`.
- `prototype` — throwaway prototypes for the question being asked. Two branches: state/logic → terminal harness (`LOGIC.md`), UI → multiple URL-toggleable variants (`UI.md`).

**Review / diagnose:**

- `diagnose` — disciplined 6-phase debugging loop: build feedback loop → reproduce → 3-5 ranked hypotheses → instrument → fix + regression test → cleanup + post-mortem. Reach for this on hard bugs and perf regressions before pattern-matching a fix.
- `zoom-out` — map modules + callers + domain vocabulary for an unfamiliar area before diving in. Manual-invoke (the skill has `disable-model-invocation: true`).
- `improve-codebase-architecture` — surfaces architectural friction, generates an HTML report of "deepening" candidates (Ousterhout vocabulary: module/interface/seam/adapter/depth/leverage/locality). Run **between phases**, not mid-phase. Sibling `LANGUAGE.md`, `DEEPENING.md`, `HTML-REPORT.md`, `INTERFACE-DESIGN.md`.

**Note on GoalsWizard overlap:** Sneebly's GoalsWizard `grill` stage handles *project creation* (idea → `GOALS.md` + build prompt + `CONTEXT.md`). That's distinct from `grill-with-docs`, which grills *existing* projects against their docs. A future phase may upgrade `GoalsWizardModal/GrillStage` to apply the same one-question-at-a-time, recommended-answer discipline.

## Acceptance tests

Each phase in `ROADMAP.md` has an "Acceptance test" — verify it before committing the phase.
