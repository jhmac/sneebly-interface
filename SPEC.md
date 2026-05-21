# Sneebly Interface — Full Spec

A local-first, Replit-style desktop app that replaces the awkward Claude UI ↔ Claude Code CLI copy/paste loop with a single integrated workspace.

---

## 1. The Problem We're Solving

Today the workflow looks like this:

1. You spin up a project in Replit and create a `GOALS.md`.
2. You push it to GitHub.
3. You start coding with Claude Code CLI on your Mac mini.
4. **But** Claude Code CLI can't handle pasted images, can't render rich formatting in chat, and is awkward for long conversations.
5. So you keep the **Claude desktop app** open in another window. You type your "real" prompt there (with screenshots, attached files, etc.), Claude crafts a response, you copy that response into the Claude Code CLI terminal, then watch what happens, then paste results back into Claude desktop to discuss next steps.
6. The screenshot in the conversation shows this exact split: Sneebly app on top, Claude on bottom-left, Claude Code CLI on bottom-right. Three apps. Constant context switching.

This works, but the seams are everywhere. **Sneebly Interface** collapses those three windows into one purpose-built desktop app.

---

## 2. What We're Building

A native macOS desktop app (Electron + React + TypeScript) with three panels in one window:

```
┌────────────────────────────────────────────────────────────────┐
│ TOP — Live App Preview                                         │
│ Your project running locally (npm run dev → localhost:NNNN)    │
│ rendered inside a webview. Device-frame toggle, refresh, URL.  │
├──────────────────────────────┬─────────────────────────────────┤
│ BOTTOM-LEFT — Claude Chat    │ BOTTOM-RIGHT — Claude Code      │
│ Rich chat UI (images, files, │ Graphical "session view" of the │
│ markdown, history). Looks    │ Claude Code agent: messages,    │
│ and feels like claude.ai.    │ tool calls, diffs, file edits.  │
│ This is where YOU compose.   │ Not a raw terminal.             │
└──────────────────────────────┴─────────────────────────────────┘
```

**Critical mechanic:** when you press Send in the bottom-left Claude Chat panel, the message is *not* sent to the Anthropic API directly. Instead the app forwards it (text, images, file refs, the whole payload) into a running Claude Code Agent SDK session in the bottom-right panel. The bottom-right panel then renders the agent's work — every tool call, every file edit, every shell command — as graphical cards (not a green-text terminal).

So: **left panel = where you talk, right panel = what the agent does, top panel = what the user (you) sees**.

---

## 3. Core Concepts

### 3.1 Project
A folder on disk (cloned from GitHub) with a `GOALS.md` in the root. Sneebly Interface tracks a list of projects in `~/Library/Application Support/sneebly-interface/projects.json`.

### 3.2 Session
One conversation thread with the Claude Code agent, scoped to one project. Sessions are persistent — closing the app and reopening it should restore your last session per project. Stored as JSONL on disk under `<project>/.sneebly-interface/sessions/<session-id>.jsonl`.

### 3.3 Preview
A child process running `npm run dev` (or the project-configured command) inside the project folder. Sneebly captures the URL it prints (e.g. `http://localhost:5173`), pipes stdout/stderr to a log buffer, and embeds the URL in a webview tag.

### 3.4 Agent (the Claude Code engine)
The bottom-right panel is **not** a terminal emulator. It's a custom React UI driven by the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` — TypeScript). Every event the SDK emits (assistant message, tool_use, tool_result, file diff, bash output) becomes a structured card in the UI. The user sees an activity feed of what Claude Code is doing — far more legible than scrolling terminal output.

### 3.5 Relationship to Sneebly-V3 (the autonomous daemon)
**Sneebly-V3 stays as-is.** It's the unattended overnight engine. **Sneebly Interface** is the *daytime* hands-on interface. They share the same project layout (same `GOALS.md`, same `.sneebly/` folder convention) and can coexist on the same project — the Interface is for interactive coding, the V3 daemon is for cycles you trigger and walk away from. They never write to the same files at the same time (we'll add a soft lock; see §10).

---

## 4. Architecture

### 4.1 Process model (Electron)

```
┌──────────────────────────────────────────────────────────────┐
│ Main Process (Node.js, full filesystem access)               │
│  - Project registry                                          │
│  - Spawns: dev server, Claude Agent SDK session, git ops     │
│  - IPC handlers                                              │
│  - Window management                                         │
└────────────┬─────────────────────────────────────────────────┘
             │ IPC (typed channels)
             │
┌────────────▼─────────────────────────────────────────────────┐
│ Renderer Process (React + Vite, sandboxed)                   │
│  - All three panels                                          │
│  - Preview panel uses <webview> tag (out-of-process)         │
│  - Receives streamed agent events over IPC                   │
└──────────────────────────────────────────────────────────────┘
```

The Claude Agent SDK runs in **main**, not renderer — it needs filesystem access, child_process, and we don't want renderer-side bundlers to choke on its native deps.

### 4.2 Key data flow — "user sends a message"

1. User types in bottom-left chat. Presses Send.
2. Renderer fires IPC `agent:send` with `{ sessionId, text, attachments[] }`.
3. Main process:
   - Saves the user message to the session JSONL.
   - If the session isn't already running, starts a Claude Agent SDK `query()` with the project folder as cwd and resumes from the JSONL.
   - Pipes the user message into the SDK.
4. SDK emits a stream of events (`assistant_message`, `tool_use`, `tool_result`, etc.).
5. For each event, main process:
   - Writes to the session JSONL.
   - Forwards over IPC `agent:event` to renderer.
6. Renderer's bottom-right panel renders each event as a card. The bottom-left panel renders only the human-readable `assistant_message` text plus a compact "Claude is working…" indicator that links over to the activity panel.

### 4.3 Why this split between left and right

- **Left (Chat):** clean, distraction-free, like a chat app. You see your messages and Claude's high-level replies. No tool noise.
- **Right (Activity):** the full agent trace — every `Read`, `Edit`, `Bash`, every diff. Click any card to expand. This replaces what you'd otherwise watch in the CLI terminal, but rendered as cards instead of ANSI text.

When you ask Claude something visual ("center this button"), the *answer* shows up in the left chat, the *work* (the Edit calls, the file diff) shows up in the right activity, and the *result* (the button actually centered) shows up in the top preview the moment the dev server hot-reloads.

---

## 5. Panel Specs

### 5.1 Top Panel — Live Preview

**Goal:** see the running app instantly. No "where's my localhost tab" friction.

Features:
- Auto-detect dev command:
  1. Read `package.json` → if `scripts.dev` exists, use it.
  2. Else look for `scripts.start`.
  3. Else fall back to user-configured command per project.
- Spawn the dev server as a child process on project open.
- Capture the URL from stdout using a regex (`https?://localhost:\d+`, also matches `127.0.0.1` and `0.0.0.0`).
- Embed the URL in `<webview>` (Electron's out-of-process tag — safer than `<iframe>` for arbitrary local content and gives us proper devtools).
- **Toolbar:**
  - Back / Forward / Reload
  - URL bar (editable — you can navigate to `/some-route`)
  - Device-size selector: Desktop / Tablet / iPhone — sets webview width
  - "Open in Chrome" button (passes URL to `shell.openExternal`)
  - Status pill: green ● when dev server is up, amber when starting, red when crashed
  - Logs drawer toggle: shows captured stdout/stderr from the dev process
- **Restart logic:** if the dev process exits non-zero, show the last 50 lines of stderr inline with a "Restart" button. No silent failures.

### 5.2 Bottom-Left Panel — Claude Chat

**Goal:** feel like the Claude desktop app — paste images, drag files, rich markdown, fast.

Features:
- **Composer** at the bottom:
  - Auto-growing textarea
  - Paste image from clipboard → renders inline thumbnail, gets attached
  - Drag-drop files → attached as references (Claude sees the path, can choose to Read)
  - `@file` autocomplete: type `@`, fuzzy-pick a file from the project, inserts a path mention
  - `Cmd+Enter` to send, `Enter` for newline (configurable)
  - "/" slash-commands: `/clear`, `/compact`, `/branch <name>` (forks the session), `/checkpoint`
- **Message list:**
  - User messages: right-aligned, bubble style
  - Assistant messages: full-width, markdown-rendered, with code blocks (syntax-highlighted via Shiki), copy buttons on every block
  - A small "Working on it…" pill appears under the latest user message while the agent is mid-run, with a live count of tool calls — clicking it focuses the right panel
- **Session header:**
  - Project name + current git branch
  - "New session", "Sessions…" (list of past sessions), "Export" (markdown dump)
- **Model picker** in the header: Sonnet 4.6 / Opus 4.7 / Haiku 4.5 — passed through to the Agent SDK.
- **Approval prompts** appear inline as cards: "Claude wants to run `rm -rf node_modules`. [Allow once] [Allow always] [Deny]". (Map to the Agent SDK's permission callback.)

### 5.3 Bottom-Right Panel — Claude Code Activity View

**Goal:** the graphical replacement for the CLI terminal. Every tool call, every file edit, every shell command, as a card you can scan and click.

This is the panel you specifically said you want **less terminal-like, more graphical**. Here's the design.

**Card types** (each maps to an SDK event):

| Card | Trigger | Visual |
|---|---|---|
| `Thinking` | `thinking` block | Subtle grey card, monospace, collapsed by default ("Claude is thinking…") |
| `Read file` | `tool_use: Read` | File icon + path + line range, click to preview content |
| `Edit file` | `tool_use: Edit` | Diff card: red/green inline diff with file path header, "View in editor" link |
| `Write file` | `tool_use: Write` | Green "+ new file" card, expandable to show content |
| `Bash` | `tool_use: Bash` | Terminal-style card with the command in mono, output as collapsible block, exit code badge |
| `Search` | `tool_use: Grep/Glob` | "🔎 Searched for `pattern` → 12 matches", expandable |
| `Web fetch` | `tool_use: WebFetch` | Link-preview card with URL and fetched title |
| `Task / Agent` | `tool_use: Task` | "Sub-agent: <description>" with its own nested timeline |
| `Permission request` | permission callback | Yellow card with the action + Allow/Deny buttons |
| `Error` | tool error / model error | Red card with message and "Retry" |
| `Summary` | assistant message (non-tool) | Italic grey one-liner: "Claude says: 'Done — button is now centered.'" (the full text already lives in the left panel) |

**Layout:**
- Vertical scrolling feed, newest at the bottom (auto-scroll to bottom unless user has scrolled up).
- Each card has: timestamp (relative), duration if applicable, expand/collapse, copy-as-text.
- A sticky **status bar** at the top: current activity ("Editing `src/App.tsx`…"), elapsed time on current step, total tokens used, cost so far, **Stop** button (sends abort signal to the SDK).
- A **filter bar** above the feed: toggle which card types are visible (e.g. hide `Thinking` for less noise).
- A **timeline scrubber** on the right edge: tiny dots representing each event, click to scroll-jump. Helps when sessions get long.

**Why this beats a raw terminal:**
- Diffs are inline-colored, not ANSI escape sequences.
- File reads are clickable previews instead of dumping 500 lines into your scrollback.
- Bash output is collapsed by default — you don't drown in `npm install` noise.
- Tool inputs are parsed JSON, not flat text.
- You can scroll back through a 2-hour session and find "where did Claude edit the auth middleware?" in 5 seconds.

---

## 6. The Claude Agent SDK Integration

The bottom-right panel is powered by `@anthropic-ai/claude-agent-sdk` (TypeScript). The SDK is a programmatic interface to the same agent that powers the Claude Code CLI — same tools (Read/Write/Edit/Bash/Grep/Glob/Task/WebFetch), same system prompt, same MCP support. We just render its events ourselves instead of letting the CLI print them.

```ts
// engine/agent-session.ts (in Electron main process)
import { query } from '@anthropic-ai/claude-agent-sdk';

export async function* runTurn(opts: {
  cwd: string;            // project root
  prompt: string;         // user message
  attachments: Path[];    // image paths, etc.
  model: 'sonnet' | 'opus' | 'haiku';
  sessionId: string;      // for resuming
  permissionMode: 'acceptEdits' | 'plan' | 'default' | 'bypassPermissions';
  onPermissionRequest: (req) => Promise<'allow' | 'deny'>;
}) {
  const stream = query({
    prompt: buildPrompt(opts.prompt, opts.attachments),
    options: {
      model: opts.model,
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      canUseTool: opts.onPermissionRequest,
      resume: opts.sessionId,
    },
  });

  for await (const event of stream) {
    yield event; // -> forwarded to renderer over IPC
  }
}
```

**Why SDK, not spawning the CLI binary:**
- Structured events (JSON), not parsed ANSI.
- Programmatic permission control — we can show our own Allow/Deny UI.
- Sessions resume cleanly.
- No PTY weirdness.
- Same authentication as the CLI (reads `~/.config/claude/`), so your existing Claude Max login carries over.

**What about MCP servers and CLAUDE.md?** Both are honored — the SDK picks up MCP config from `~/.claude/` and the project's `CLAUDE.md` exactly like the CLI does.

---

## 7. GitHub & Project Onboarding

The new-project flow inside Sneebly Interface:

1. **Welcome screen** → "Connect GitHub" button (OAuth via GitHub's device flow, token stored in macOS Keychain).
2. **Pick a repo** from your repo list, or paste a URL.
3. App clones to `~/SneeblyProjects/<repo-name>/` (configurable).
4. App reads `GOALS.md` from the project root:
   - If present → parse Mission, Tech Stack, current Phase, next unchecked milestones. Show a project dashboard.
   - If absent → offer to scaffold one from a template (copies `templates/GOALS.md` and opens it for editing).
5. App auto-detects the dev command from `package.json`, prompts to confirm.
6. App opens the workspace (three panels).
7. First message from Sneebly to Claude is auto-composed:
   > "Project context: [reads GOALS.md + AGENTS.md]. The user is about to start working. Acknowledge briefly and stand by."

   This primes the agent with the goals file. Subsequent user messages can be brief.

---

## 8. File Structure (the Sneebly Interface repo itself)

```
sneebly-interface/
├─ package.json
├─ tsconfig.json
├─ electron.vite.config.ts          # bundler config (electron-vite)
├─ forge.config.ts                  # electron-forge for packaging
├─ src/
│  ├─ main/                         # Electron main process
│  │  ├─ index.ts                   # app entry, window creation
│  │  ├─ ipc/
│  │  │  ├─ index.ts                # registers all handlers
│  │  │  ├─ project.ts              # open/close/clone/list projects
│  │  │  ├─ agent.ts                # send message, abort, list sessions
│  │  │  ├─ preview.ts              # start/stop dev server, get URL/logs
│  │  │  ├─ fs.ts                   # read file, list dir (renderer can't)
│  │  │  └─ git.ts                  # status, branch, commit, push
│  │  ├─ services/
│  │  │  ├─ agent-session.ts        # Claude Agent SDK wrapper
│  │  │  ├─ dev-server.ts           # spawns npm run dev, captures URL
│  │  │  ├─ project-registry.ts     # ~/Library/.../projects.json
│  │  │  ├─ session-store.ts        # JSONL persistence
│  │  │  ├─ github-auth.ts          # device flow + Keychain
│  │  │  └─ goals-parser.ts         # parses GOALS.md → structured data
│  │  └─ preload.ts                 # exposes typed IPC to renderer
│  │
│  ├─ renderer/                     # React UI
│  │  ├─ index.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx                    # three-panel layout
│  │  ├─ panels/
│  │  │  ├─ PreviewPanel.tsx
│  │  │  ├─ ChatPanel/
│  │  │  │  ├─ ChatPanel.tsx
│  │  │  │  ├─ Composer.tsx
│  │  │  │  ├─ MessageList.tsx
│  │  │  │  ├─ AttachmentPicker.tsx
│  │  │  │  └─ SlashCommands.ts
│  │  │  └─ ActivityPanel/
│  │  │     ├─ ActivityPanel.tsx
│  │  │     ├─ cards/
│  │  │     │  ├─ ThinkingCard.tsx
│  │  │     │  ├─ ReadCard.tsx
│  │  │     │  ├─ EditCard.tsx
│  │  │     │  ├─ WriteCard.tsx
│  │  │     │  ├─ BashCard.tsx
│  │  │     │  ├─ SearchCard.tsx
│  │  │     │  ├─ TaskCard.tsx
│  │  │     │  ├─ PermissionCard.tsx
│  │  │     │  └─ ErrorCard.tsx
│  │  │     ├─ StatusBar.tsx
│  │  │     ├─ FilterBar.tsx
│  │  │     └─ TimelineScrubber.tsx
│  │  ├─ chrome/                    # app-wide UI
│  │  │  ├─ Sidebar.tsx             # project switcher
│  │  │  ├─ TopBar.tsx
│  │  │  └─ StatusFooter.tsx
│  │  ├─ screens/
│  │  │  ├─ Welcome.tsx
│  │  │  ├─ ConnectGithub.tsx
│  │  │  ├─ NewProject.tsx
│  │  │  └─ Workspace.tsx           # the three-panel screen
│  │  ├─ state/                     # Zustand stores
│  │  │  ├─ projectStore.ts
│  │  │  ├─ sessionStore.ts
│  │  │  ├─ previewStore.ts
│  │  │  └─ uiStore.ts
│  │  ├─ hooks/
│  │  │  ├─ useAgentStream.ts
│  │  │  ├─ usePreviewUrl.ts
│  │  │  └─ useProject.ts
│  │  └─ styles/
│  │     └─ globals.css             # Tailwind v4
│  │
│  └─ shared/                       # imported by both processes
│     ├─ ipc-channels.ts            # channel name constants
│     ├─ types.ts                   # AgentEvent, Session, Project, etc.
│     └─ schemas.ts                 # Zod schemas for IPC payloads
│
├─ resources/                       # icons, fonts
└─ README.md
```

Conventions:
- All IPC payloads are Zod-validated on both sides.
- Renderer never touches `fs` directly — all file ops go through main.
- One Zustand store per concern; no global Redux.

---

## 9. Key Dependencies

| Package | Why |
|---|---|
| `electron`, `electron-vite`, `@electron-forge/cli` | App shell, dev tooling, packaging |
| `@anthropic-ai/claude-agent-sdk` | The agent engine for the right panel |
| `react`, `react-dom`, `typescript`, `vite` | UI |
| `tailwindcss` v4 | Styling |
| `zustand` | Renderer state |
| `zod` | IPC payload validation |
| `shiki` | Code syntax highlighting in chat & diffs |
| `diff` (`jsdiff`) | Computing Edit-card diffs |
| `simple-git` | Git ops in main |
| `chokidar` | Watching project files (e.g. detect external edits) |
| `keytar` | macOS Keychain (GitHub token) |
| `@octokit/rest` | GitHub API (repo list, clone helper) |
| `electron-store` | Small key-value persistence (settings) |
| `lucide-react` | Icons |

---

## 10. Cross-Cutting Concerns

### 10.1 Session persistence
Every agent event is appended to `<project>/.sneebly-interface/sessions/<sessionId>.jsonl`. On app start, the most recent session per project is auto-loaded. "Sessions…" menu lists all of them.

### 10.2 Permissions & safety
Default `permissionMode: 'acceptEdits'` — Claude can read/edit/write files in the project without asking, matching Claude Code CLI's default. Bash commands trigger an inline permission card in the left chat. "Allow always for this session" caches the decision for the rest of the session only.

Destructive ops (`rm -rf`, `git push --force`, anything touching `.env*`) always prompt regardless.

### 10.3 Coexistence with Sneebly-V3 daemon
- Sneebly Interface writes a heartbeat to `<project>/.sneebly-interface/lock` while a session is active.
- The V3 daemon's `cycle.ts` should check for this lock and skip that project if it's actively being edited. (Small addition to V3.)

### 10.4 GOALS.md awareness
- On project open, parse `GOALS.md` into a structured object.
- Show in a collapsible "Goals" sidebar inside the chat header: current phase, next 3 unchecked milestones, open questions.
- Slash command `/goals` injects the goals summary into the next user message — handy for re-grounding Claude mid-session.

### 10.5 Telemetry & cost
The Agent SDK reports token usage per turn. Show running totals in the right-panel status bar:
- Tokens in / out
- Estimated cost (use a small lookup table per model)
- Wall-clock time for the current turn

### 10.6 Error recovery
- Dev server crashes → show stderr inline, "Restart" button.
- Agent SDK errors → red card in activity panel, retry button.
- Network blip → auto-retry with backoff.
- File conflict (you edited a file Claude is editing) → diff conflict resolver inline.

### 10.7 Settings (per app and per project)
Per-app: theme, default model, GitHub token, default projects folder, telemetry on/off.
Per-project (stored in `<project>/.sneebly-interface/config.json`): dev command override, ignored paths, custom system prompt addendum, MCP servers.

---

## 11. What This Spec Deliberately Does Not Build (Yet)

These are easy to bolt on later; calling them out so phase scope stays honest:
- **No multi-tab projects.** One project per window. Use multiple windows for multiple projects.
- **No built-in code editor.** "View in editor" buttons open the file in your default editor (VS Code, Cursor, etc.). Building Monaco into the app is Phase 5+.
- **No collaborative editing.** Single user.
- **No remote deploy button.** Deploy still happens via `git push` (which the V3 daemon or Replit picks up).
- **No mobile/Windows/Linux builds.** macOS-only for v1.

---

## 12. Confirmed Decisions

1. ✅ **Clone destination:** `~/SneeblyProjects/<repo-name>/`. Not user-configurable in v1 — settings screen in Phase 7 may add an override.
2. ✅ **Window-per-project.** Each project opens in its own Electron window so multiple projects can be arranged side-by-side on a large display. No Replit-style multi-project sidebar in v1. (Revisit if friction shows up.)
3. **Theme:** dark by default (matches the V3 dashboard's zinc-on-black). Light theme deferred to Phase 7 polish.
4. **Stop button behavior:** hard abort of the SDK turn. The current turn is cancelled, but session state is preserved — next message resumes cleanly.

---

## 13. Success Criteria (how we know v1 works)

- You can connect GitHub, pick a repo, and be in the workspace in under 30 seconds.
- The preview panel shows the running app within 10 seconds of opening a project.
- You can paste a screenshot into the left chat and Claude in the right panel reads it and edits files based on it.
- When Claude edits a file, the diff card appears in the right panel within 2 seconds.
- The preview hot-reloads to reflect the edit within 5 seconds.
- Closing and reopening the app restores the exact session, scrolled to the same place.
- A typical 1-hour coding session never requires you to open Terminal, claude.ai, or another window.
