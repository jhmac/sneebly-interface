# Sneebly Interface — Phased Roadmap

Each phase is sized to roughly one focused week of Claude Code work. Each phase ends with something demoable. Don't skip phases — Phase 1 is unglamorous but everything else assumes the foundations exist.

For each phase you'll find:
- **Goal** — the one-sentence purpose
- **Deliverables** — what should exist when the phase is done
- **Acceptance test** — how you'll prove it works
- **Claude Code kickoff prompt** — copy/paste this into Sneebly Interface (or Claude Code CLI for the bootstrap) to start the phase

---

## Phase 0 — Bootstrap (Day 1, ~2 hours)

**Goal:** repo exists, dev environment runs an empty Electron window.

**Deliverables:**
- New empty repo `sneebly-interface` on GitHub, cloned locally
- `package.json` with electron-vite scaffolding
- `npm run dev` opens an empty Electron window with "Hello, Sneebly" text
- TypeScript + Tailwind v4 wired up
- `.gitignore` covers `node_modules`, `dist`, `.DS_Store`, `out`

**Acceptance test:** `npm run dev` opens a window, edit `App.tsx`, hot-reload works.

**Claude Code kickoff prompt:**
> Scaffold a new Electron + React + TypeScript desktop app called "sneebly-interface" using `electron-vite`. Use Tailwind v4 for styling. Set up a clean main/renderer/shared directory structure under `src/`. Renderer should be one React component showing "Hello, Sneebly" centered. Add a typed IPC channel example (`ping` → `pong`) using a preload script and contextBridge. Confirm `npm run dev` works and hot-reload is functional. Don't add any other features yet.

---

## Phase 1 — Three-Panel Shell (Week 1)

**Goal:** the visual skeleton — three resizable panels, no real functionality yet.

**Deliverables:**
- `App.tsx` renders three panels in the layout from `SPEC.md` §2
- Top panel: full-width, fixed ~55% height, placeholder "Preview goes here"
- Bottom split: 50/50, left = "Chat", right = "Activity"
- Draggable resize handles between all three panels (use `react-resizable-panels`)
- Panel sizes persist across reloads (electron-store)
- Dark theme baseline (zinc/neutral palette)
- Window title shows "Sneebly Interface"

**Acceptance test:** open the app, drag panel borders, close & reopen — sizes preserved.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §2 and §5. Build the three-panel layout described there. Use `react-resizable-panels` for the splitter. All panels are placeholder content for now (just labeled divs with the panel name centered). Persist panel sizes to electron-store keyed by `layout.workspace.sizes`. Dark theme using Tailwind, palette = neutral/zinc 900/800/100. Window minimum size: 1200×800.

---

## Phase 2 — Project Onboarding & Registry (Week 2)

**Goal:** open an existing local project from disk; project state survives restarts.

**Deliverables:**
- "Welcome" screen if no projects registered
- "Open folder…" picker → registers project in `~/Library/Application Support/sneebly-interface/projects.json`
- Reads `package.json` to detect project name, dev command, framework
- Reads `GOALS.md` if present, parses it (Mission, Tech Stack, current Phase, milestones)
- Sidebar lists registered projects; clicking one opens the workspace
- Workspace header shows project name, current git branch, "Goals" expander

**Acceptance test:** add `Sneebly-V3` as a project, see its name and detected stack appear in the header.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §3, §7, §10.4. Build the project registry: project list persisted to `~/Library/Application Support/sneebly-interface/projects.json`, "Open folder…" picker via `dialog.showOpenDialog`, package.json reading, a markdown GOALS.md parser that extracts Mission/Tech Stack/Phases/Milestones into a typed object. Add a sidebar listing registered projects and a Welcome screen when the list is empty. No GitHub OAuth yet — that's Phase 6. Workspace header shows project name + git branch (via `simple-git`).

---

## Phase 3 — Live Preview Panel (Week 3)

**Goal:** opening a project automatically runs its dev server and embeds it in the top panel.

**Deliverables:**
- On project open, spawn the detected dev command as a child process
- Capture stdout, regex out the localhost URL
- Embed URL in `<webview>` once detected
- Toolbar: back/forward/reload, URL bar, status pill, "Open in Chrome"
- Device-size selector: Desktop / Tablet (768) / iPhone (390)
- Logs drawer (collapsed by default) shows stdout/stderr live
- If dev server crashes, show last 50 lines of stderr + "Restart" button
- On project close or app quit, kill the child process cleanly

**Acceptance test:** open a Next.js or Vite project, preview appears within ~10 seconds. Edit the source manually, preview hot-reloads.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §5.1. Implement the live preview panel. Service in main process: `dev-server.ts` spawns the command, parses stdout for `https?://(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)`, exposes status events over IPC (`starting`, `running` with URL, `crashed` with stderr tail). Renderer: webview tag with the toolbar described in the spec, status pill, device-size selector. Logs drawer below the webview. Clean shutdown on window close (`SIGTERM` then `SIGKILL` after 3s).

---

## Phase 4 — Chat Panel (Week 4)

**Goal:** the left panel feels like the Claude desktop app. No agent integration yet — just the UI plus an echo backend.

**Deliverables:**
- Composer: auto-growing textarea, Cmd+Enter to send, paste-image support (renders thumbnail), drag-drop files
- Message list: user bubbles right, assistant full-width markdown via `react-markdown` + Shiki for code blocks
- Slash commands: `/clear`, `/checkpoint`, `/goals`, plus autocomplete dropdown
- `@file` autocomplete: fuzzy search project files (via main-process IPC)
- Session header: project name, branch, model picker (dropdown)
- Echo backend (placeholder): main process replies with the user's message uppercased + a fake "thinking" delay — proves the IPC pipe works
- Messages persist to `<project>/.sneebly-interface/sessions/<id>.jsonl` and reload on app restart

**Acceptance test:** type a message, paste a screenshot, drag a file, see them all appear in the composer. Send. Echo replies. Close app, reopen — conversation restored.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §5.2 and §10.1. Build the chat panel UI and session persistence. Use react-markdown + shiki for assistant message rendering. Composer supports clipboard images (paste event → save to `<project>/.sneebly-interface/attachments/<uuid>.png`, render thumbnail) and drag-drop. Slash command autocomplete: typing `/` opens a menu of `/clear`, `/checkpoint`, `/goals`. `@file` autocomplete uses fuzzy search over project file list (debounced IPC call). Session JSONL stored under `.sneebly-interface/sessions/`. For now, the "send" handler in main just echoes the message back uppercased after a 500ms delay — we'll replace this with the SDK in Phase 5.

---

## Phase 5 — Claude Agent SDK + Activity Panel (Week 5–6, the big one)

**Goal:** real agent integration. Sending a message in the left panel makes Claude Code work for real, with all activity rendering as cards on the right.

**Deliverables:**
- `agent-session.ts` service in main wraps `@anthropic-ai/claude-agent-sdk`
- IPC: `agent:send`, `agent:event` (streamed), `agent:abort`, `agent:list-sessions`
- Session resume via SDK's `resume` option keyed by sessionId
- Right panel renders all card types from `SPEC.md` §5.3: Thinking, Read, Edit, Write, Bash, Search, WebFetch, Task, Permission, Error, Summary
- Status bar at top of right panel: current activity, elapsed, tokens, cost, **Stop** button
- Filter bar: toggle visibility per card type, preference persisted
- Timeline scrubber on right edge
- Permission callback wires to inline yellow card in chat panel — user clicks Allow/Deny, callback resolves
- Cost lookup table for sonnet/opus/haiku, displayed live
- Left chat panel only shows `assistant_message` text + a "Claude is working — 3 tool calls" pill that focuses the right panel on click

**Acceptance test:** in a real project, type "what does this codebase do?" — Claude reads files (cards appear right), responds in the chat (left). Type "add a `/ping` endpoint" — Edit cards appear, diffs render, file saves, preview hot-reloads in top panel. Press Stop mid-run — agent aborts cleanly.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §4, §5.3, §6, §10.2, §10.5. This is the keystone phase. Implement `agent-session.ts` in main using `@anthropic-ai/claude-agent-sdk`. Stream every event (assistant_message, tool_use, tool_result, thinking, error) over IPC `agent:event`. In renderer, build the ActivityPanel with all card types listed in the spec — one component per card type. Use `jsdiff` to compute diffs for Edit cards, render with red/green inline styling. Permission callback: when SDK asks `canUseTool`, main forwards an IPC request to renderer, renderer shows yellow card in chat panel, awaits user choice, sends result back. Sessions resume via the SDK's `resume` option. Add the status bar with token/cost/elapsed and a Stop button that calls abort. Test thoroughly with a real project — this phase is the whole reason the app exists.

---

## Phase 6 — GitHub Integration (Week 7)

**Goal:** end-to-end project creation from a GitHub repo, no Terminal required.

**Deliverables:**
- "Connect GitHub" button → device flow OAuth (no need to run your own OAuth app — use GitHub CLI's public client ID or register a simple GitHub App)
- Token stored in macOS Keychain via `keytar`
- After connection, show a searchable list of your repos
- "Clone repo" action: pulls to `~/SneeblyProjects/<repo-name>/`, registers as project, opens workspace
- If repo has no `GOALS.md`, prompt to scaffold from `templates/GOALS.md`
- Git status indicator in workspace header (clean / dirty / N ahead)
- "Commit & push" button in header (opens a small modal with staged changes + message field)

**Acceptance test:** sign in, pick a repo, see workspace open with preview running, make a commit via the UI.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §7 and §10.7. Implement GitHub OAuth via the device flow (use the `@octokit/auth-oauth-device` package). Store the token in macOS Keychain via `keytar`. Build the "Connect GitHub" screen and a searchable repo picker (paginated via `@octokit/rest`). Cloning uses `simple-git`. After clone, if `GOALS.md` is missing, show a modal asking whether to copy a template (the template lives in `templates/GOALS.md` in the Sneebly Interface repo itself — bundle it as a resource). Add a "Commit & push" modal in the workspace header.

---

## Phase 7 — Polish, Packaging, & v1 Release (Week 8)

**Goal:** ship a `.dmg` you can install on the Mac mini.

**Deliverables:**
- App icon (commission or generate)
- About window with version
- Auto-update via `electron-updater` (optional but recommended)
- Crash reporter (optional, Sentry or just local logs)
- Settings screen: theme toggle (dark/light), default model, GitHub disconnect, projects folder, MCP servers
- First-run onboarding: tour the three panels, explain the model picker
- `npm run make` produces a signed & notarized `.dmg`
- README with screenshots
- Smoke test checklist run end-to-end on a fresh Mac mini

**Acceptance test:** install the `.dmg` on a fresh user account, complete onboarding, build a small project from scratch in one session.

**Claude Code kickoff prompt:**
> Read `SPEC.md` §10.7 and §13. Final polish phase. Build the Settings screen, About window, first-run onboarding overlay. Set up `electron-forge` with the `@electron-forge/maker-dmg` maker. Wire up Apple Developer ID signing & notarization (env vars: `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). Write the README with screenshots of all three panels in action. Run the full §13 success criteria checklist and fix anything broken.

---

## Optional Phase 8+ (the wishlist)

After v1 ships, in rough priority order:

- **Built-in Monaco editor** as a fourth panel/tab — click any file in an Edit card to open it inline, edit alongside Claude
- **Multi-project sidebar** like Replit — switch projects without window juggling
- **Snapshots / checkpoints** — Claude commits to a local branch every N edits, easy "go back 5 minutes" button
- **Voice input** in the composer (uses macOS dictation API)
- **Better diff conflict resolution** when you edit while Claude edits
- **Plugin marketplace** — installable MCP servers from a UI
- **Sneebly-V3 bridge tab** — show V3 daemon status & queue inside the Interface for the same project
- **Light theme**
- **Windows/Linux builds** (Electron makes this mostly free, but adds testing surface)

---

## Dependencies & Sequencing Notes

- Phases 1–4 can be done in parallel by separate Claude Code sessions if you wanted, but Phase 5 has to be done in one focused stretch — it touches both processes deeply.
- Phase 5 depends on Phase 4 (chat UI exists) and Phase 2 (project context exists). Don't start Phase 5 with placeholders for those.
- Phase 6 is mostly independent — you can do it before Phase 5 if you'd rather have GitHub working first. The "Open folder…" path from Phase 2 will keep working either way.
- Phase 3 (preview) is independent of Phase 5 (agent) but they pay off together — the magic moment is "Claude edits → preview reloads".

---

## How to Drive This With Claude Code

Each phase's "kickoff prompt" is designed to be the first message in a fresh Claude Code session in the `sneebly-interface` repo. The flow:

1. `cd ~/sneebly-interface && claude`
2. Paste the kickoff prompt for the current phase.
3. Let Claude Code propose a plan; review it; approve.
4. Let it implement; review diffs as it goes.
5. Run the **Acceptance test** for that phase before moving on.
6. Commit, push, move to next phase.

Once Phase 5 is done, you can ironically use **Sneebly Interface itself** to build the remaining phases — eating your own dog food is the best test that the app actually works.
