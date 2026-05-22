# Sneebly

A local-first macOS desktop app that collapses the Claude UI + Claude Code CLI into one integrated workspace. Three panels: **live app preview** on top, **Claude chat** bottom-left, **agent activity feed** bottom-right.

Think of it as a personal Replit — but running entirely on your Mac, using your Claude Code subscription, with autonomous multi-step coding sessions.

---

## What it does

- **Live preview** — opens a project folder, auto-detects the dev command (`npm run dev`), spawns it, captures the localhost URL, and embeds the running app in a webview with back/forward/reload and device-size presets.
- **Claude chat** — a full-fidelity Claude-style chat panel with image paste, file drag-drop, @file autocomplete, slash commands (`/clear`, `/setup`, `/goals`), and markdown + syntax-highlighted responses.
- **Agent activity** — every Claude Code tool call rendered as an interactive card: reads, edits (with inline red/green diffs), bash commands, web fetches, and a `browser_check` MCP tool that runs headless Chromium without installing Playwright in your project.
- **Secrets** — stores API keys in macOS Keychain, injected automatically as env vars into both the dev server and Claude subprocess. Never written to disk in plaintext.
- **One-click setup** — "Set up local environment" button triggers a Claude-driven provisioning session that installs deps, creates `.env`, runs migrations, and auto-restarts the preview.

---

## Requirements

- macOS 13+ (Apple Silicon or Intel)
- [Claude Code CLI](https://claude.ai/code) installed and authenticated (`claude --version`)
- Node.js 20+

---

## Development

```bash
npm install
npm run dev
```

The app opens in development mode with hot-reload.

---

## Build

### Unsigned local build (for personal use)

```bash
npm run make
```

Produces `out/make/SneeblyInterface.dmg`. Since it's unsigned, right-click → Open the first time you launch.

### Signed & notarized release

Set these env vars before running `make`:

```bash
export APPLE_ID="your@apple.id"
export APPLE_PASSWORD="app-specific-password"   # from appleid.apple.com
export APPLE_TEAM_ID="XXXXXXXXXX"               # 10-char team ID from Apple Developer portal
npm run make
```

With these set, `forge.config.ts` activates `osxSign` and `osxNotarize` automatically. See [Apple's notarization docs](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution).

> **Note:** Code signing and notarization require an Apple Developer ID certificate installed in Keychain. Without these env vars, the build is unsigned and shows a Gatekeeper warning on first open.

---

## Screenshots

_Screenshots coming — see `screenshots/` folder._

<!-- Add screenshots here once the UI is finalized:
![Three-panel workspace](screenshots/workspace.png)
![Activity panel with card types](screenshots/activity.png)
![Secrets panel](screenshots/secrets.png)
-->

---

## Architecture

- **Main process** (Node.js): project registry, dev server spawning, Claude CLI subprocess, IPC handlers, keytar secrets
- **Renderer process** (React + Vite): all UI panels
- **Claude engine**: spawns `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions --mcp-config <path>` as a subprocess using the user's Claude Max subscription
- **MCP server**: bundled `browser-check` server providing headless Chromium via Playwright — registered automatically, no per-project install

**No `ANTHROPIC_API_KEY` used.** Auth is the user's Claude Code login.

---

## Project layout

```
src/
  main/           Node.js main process
    ipc/          IPC handlers (chat, preview, secrets, settings…)
    mcp-servers/  Bundled MCP servers (browser-check)
    services/     Business logic (dev-server, agent-session, secrets-store…)
  renderer/       React UI
    panels/       Panel components (ChatPanel, ActivityPanel, PreviewPanel…)
    screens/      Top-level screens (Welcome, Workspace)
    state/        Zustand stores
  shared/         Types, IPC channel names, utils
resources/        App icon (icon.png, icon.icns)
```

---

## Roadmap

See `ROADMAP.md`. Phase 6 (GitHub OAuth + repo cloning) is next.
