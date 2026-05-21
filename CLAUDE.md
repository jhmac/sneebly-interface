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
- @anthropic-ai/claude-agent-sdk (Phase 5+)
- simple-git, keytar, @octokit/rest (Phase 6+)
- Shiki for syntax highlighting; jsdiff for Edit-card diffs

## Architecture conventions

- Main process owns: filesystem, child processes (dev server), Claude Agent SDK, git ops, project registry, GitHub auth
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

## Acceptance tests

Each phase in `ROADMAP.md` has an "Acceptance test" — verify it before committing the phase.
