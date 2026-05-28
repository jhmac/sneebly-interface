import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X, Copy, Check, Sparkles, ArrowRight, RotateCcw, FilePlus2, FolderInput, RefreshCw, GitBranch, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { useGoalsWizardStore } from '../../state/goalsWizardStore'
import { useProjectStore } from '../../state/projectStore'
import { useGitHubStore } from '../../state/githubStore'
import type { GitHubUser } from '../../../shared/types'

// Pasted by the user into their existing AI coding tool (Replit Agent, Cursor,
// Lovable, Claude Code). Emits GOALS.md in Sneebly's canonical format — the same
// "## Roadmap" + "### Phase N: Title" + "- [x]/- [ ]" structure the spec generator
// and phase planner parse. (Sneebly's parser has no "[~]" partial marker: partial
// features are unchecked "[ ]" with the gap noted inline, so the phase runner
// finishes them.)
const IMPORT_META_PROMPT = `Analyze this entire project and write a GOALS.md file at the repository root, then commit and push it. GOALS.md is the ONLY document a downstream coding assistant (Sneebly) will use to generate detailed build specs and finish this app — so it must be honest about what's done AND rich enough that someone who has never seen this codebase could build the unfinished features correctly from the descriptions alone.

## TWO CRITICAL FORMAT RULES (read both, twice)

### Rule 1 — Roadmap bullet format
Every feature bullet in the "## Roadmap" section MUST start with "- [x] " (done) or "- [ ] " (not done). Do NOT use "* Feature", "- Feature" (no checkbox), "1. Feature" (numbered), or any other style. If the bullet format is wrong, Sneebly's parser silently drops all features and the import is wasted.

### Rule 2 — Roadmap bullet LENGTH (this one causes the most broken imports)
The FEATURE NAME in each roadmap bullet — the words before the " — " separator — MUST be 3–7 words, no more. This name becomes the spec filename. If it is long, the filename breaks on most operating systems.

  GOOD: "- [ ] AI auto-scheduling — Claude schedule generation from sales history (partial: no production wiring)"
  GOOD: "- [ ] Stripe billing — subscription management, plan picker, webhook handler (not started)"
  BAD:  "- [ ] AI auto-scheduling — Claude-powered schedule generation using Shopify sales history, staffing tiers, availability, zone minimums, and custom AI rules"
  BAD:  "- [ ] Employee account hard-delete cascade — self-delete UI and basic backend route exist; FK cascade cleanup missing across all dependent tables (partial: most related tables lack onDelete cascade)"

The part AFTER the " — " is ONE sentence max. Put all the real detail in the "## Key Features" section where there is no length limit.

## Step 1 — Scan the project

Read the source thoroughly. Pay attention to:
- README, CLAUDE.md, /docs, /specs (anything describing the product or intent)
- Database schemas (tables, columns, relations — Drizzle, Prisma, raw SQL)
- API routes/handlers (registered + implemented vs stubbed)
- Frontend pages/components (rendered vs returning null/TODO)
- Tests (what's tested is likely implemented)
- TODO / FIXME / "not implemented" / throw new Error("...") markers
Skip node_modules, .git, build output, vendored libs. If /specs exists, treat it as authoritative for intent.

## Step 2 — Describe the product

In 3-5 sentences: what does the app do (lead with the core user value), the user roles, then the technical context. No marketing fluff — this is for a coding assistant.

## Step 3 — Identify features and their honest state

Break the product into discrete, shippable features. For each, decide:
- Done: implemented end-to-end (UI through to storage). No critical TODOs. You'd trust it in production.
- Partial: started but incomplete — UI without backend, backend without UI, happy path only, or a function that doesn't actually do its job.
- Not started: mentioned in docs/comments but no meaningful code.
Be ruthlessly honest. "It compiles" is not "done." "There's a button" is not "done." If unsure, call it partial.

## Step 4 — Write a DETAILED description of every UNFINISHED feature

This is the most important step. For each feature that is NOT fully done (partial or not started), write enough that Sneebly can build a complete spec WITHOUT re-deriving the product vision. Cover ALL of the following:

**For every unfinished feature:**
- Purpose — what the feature accomplishes for which user role
- Primary flow — the main steps the user takes and what the system does at each step
- Key data / entities — the main records, fields, and relationships involved; reference real table/column names from the schema where they exist; for not-started features, list the new tables and columns that need to be created with their types
- Rules & edge cases — validation rules, permission checks, important states, error handling, race conditions
- API shape — the HTTP routes or IPC handlers needed (method, path, request body, response shape)
- Files to create or modify — list specific file paths the implementation will touch; for not-started features this is the implementation skeleton

**For PARTIAL features, also include:**
- Current state — exactly what code exists today, with file paths
- What is missing — the specific gap between current state and done
- Done looks like — 3-5 testable conditions that define completion

Done features do NOT need this detail — one line is enough. Their code is the source of truth.

## Step 5 — Group into phases

5-12 features per phase, shipping in order (MVP first). If there's no natural phasing, use a single "Phase 1: All features".

## Step 6 — Write GOALS.md in EXACTLY this format

# <Project name>

## Mission

<3-5 sentence product description from Step 2>

## Tech Stack

- Language: <e.g. TypeScript>
- Framework: <e.g. React + Vite, Next.js>
- Backend: <e.g. Node/Express>
- Database: <e.g. PostgreSQL via Drizzle>
- Auth: <e.g. Clerk>
- <other notable stack choices found in the code>

## Key Features

### <Feature name — MUST match the roadmap bullet name exactly, word for word>

<The full description from Step 4. Required for every unfinished feature. Write as much as needed — there is no length limit here. Done features may be omitted or given a one-liner.>

### <Next feature>

<...>

## Roadmap

<one-line note on how the phases ship>

### Phase 1: <Title>

- [x] User authentication — Clerk OAuth, email/password fallback, JWT session
- [x] Employee profiles — HR metadata, documents, availability, pay rates
- [ ] AI auto-scheduling — schedule generation from sales history (partial: no production wiring)
- [ ] RAG semantic search — pgvector + Xenova embeddings for SOP search (not started)

### Phase 2: <Title>

- [x] AI morning briefing — daily store summary generated via Claude
- [ ] SOP evolution system — AI revision proposals from execution feedback (partial: generator exists, no review UI)

## Output rules (critical)

- GOALS.md MUST exist at the repository root.
- The product description MUST be under "## Mission".
- EVERY "- [ ]" roadmap item MUST have a matching "### <Feature name>" entry in "## Key Features" with the full Step 4 detail. The heading name and the roadmap bullet name MUST be identical — same words, same capitalization. This is what Sneebly builds specs from.
- Roadmap bullet feature names: 3–7 words ONLY. The description after " — " is ONE sentence max. All detail goes in Key Features.
- No emoji. No markdown tables in the Roadmap section.
- Don't invent features not in the code or docs. Don't mark done what isn't.

## Step 7 — Verify format and bullet length, then commit

Run these two checks before staging:

**Check 1 — bullet format:**

    grep -c "^- \\[" GOALS.md

Count must be >= total features listed. If lower, your bullets are wrong format. Fix all to start with "- [x] " or "- [ ] ".

**Check 2 — bullet name length (the one that breaks spec filenames):**

    grep "^- \\[" GOALS.md | awk -F ' — ' '{print $1}' | awk '{print length, $0}' | sort -rn | head -5

This prints the 5 longest feature names (the part before " — "). Any name over 60 characters is too long and will create a broken spec filename. Shorten those names to 3-7 words and move the excess detail into the "## Key Features" section.

Once both checks pass, commit and push:

    git add GOALS.md && git commit -m "Add GOALS.md describing current project state" && git push origin main

If git isn't configured or the push fails, save GOALS.md and tell me what happened.`

// ── Stage: Path picker ──────────────────────────────────────────────────────────

function PathPickStage() {
  const { setStage } = useGoalsWizardStore()
  const goals = useProjectStore((s) => s.activeProjectGoals)
  // No parsed roadmap → this project needs a GOALS.md, so nudge toward import.
  const needsOnboarding = !goals || goals.phases.length === 0

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            <span className="text-sm font-medium uppercase tracking-widest text-purple-400">Goals Wizard</span>
          </div>
          <h1 className="text-3xl font-semibold text-zinc-100">What are we doing?</h1>
          {needsOnboarding && (
            <p className="mt-2 text-sm text-amber-400">
              Looks like this project doesn&apos;t have a GOALS.md yet — let&apos;s generate one.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setStage('hook')}
            className={`flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-colors ${
              needsOnboarding
                ? 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                : 'border-purple-700/50 bg-purple-950/20 hover:border-purple-600'
            }`}
          >
            <FilePlus2 className="h-5 w-5 text-purple-400" />
            <span className="text-base font-medium text-zinc-100">Start a new project</span>
            <span className="text-xs leading-relaxed text-zinc-500">
              Describe an idea — Sneebly writes a build prompt for Replit or your AI tool of choice.
            </span>
          </button>

          <button
            onClick={() => setStage('import')}
            className={`flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-colors ${
              needsOnboarding
                ? 'border-amber-600/60 bg-amber-950/20 hover:border-amber-500'
                : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
            }`}
          >
            <FolderInput className="h-5 w-5 text-amber-400" />
            <span className="text-base font-medium text-zinc-100">Import existing project</span>
            <span className="text-xs leading-relaxed text-zinc-500">
              You already have most of a project (Replit, Cursor, etc.) — generate GOALS.md from the existing code.
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stage: Import existing project ──────────────────────────────────────────────

function ImportStage() {
  const { setStage } = useGoalsWizardStore()
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const [copied, copy] = useCopy(IMPORT_META_PROMPT)
  const [reloading, setReloading] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function handleReload() {
    if (!activeProject || reloading) return
    setReloading(true)
    setNote(null)
    try {
      const pull = await window.api.gitPull(activeProject.path)
      // Re-activate to re-parse GOALS.md (works whether or not the pull succeeded).
      await useProjectStore.getState().activateProject(activeProject.id)
      const goals = useProjectStore.getState().activeProjectGoals
      if (goals && goals.phases.length > 0) {
        // Seed Sneebly's skills into the freshly-imported project. Bonus — a failure
        // here must not block the import, so swallow and log rather than surface.
        try {
          await window.api.skillsSeedIntoProject(activeProject.id)
        } catch (e) {
          console.error('[GoalsWizard] skill seeding failed:', e)
        }
        setStage('github-connect')
      } else {
        setNote(
          pull.ok
            ? 'Pulled, but still no valid GOALS.md detected — re-run the prompt in your AI tool, or check the file format.'
            : `Still no valid GOALS.md detected${pull.error ? ` (git pull: ${pull.error})` : ''}.`
        )
      }
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto px-8 py-6">
      <button onClick={() => setStage('path-pick')} className="mb-4 self-start text-xs text-zinc-500 hover:text-zinc-300">
        ← Back
      </button>

      <h1 className="text-2xl font-semibold text-zinc-100">Generate GOALS.md from your existing project</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Works with Replit Agent, Cursor, Lovable, Claude Code — any AI coding assistant that can read and edit your project files.
      </p>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-300">1. Copy this prompt</span>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
          >
            {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
          </button>
        </div>
        <pre className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
          {IMPORT_META_PROMPT}
        </pre>
      </div>

      <div className="mt-5 space-y-2 text-sm text-zinc-400">
        <p><span className="text-zinc-300">2. Paste it into your AI tool</span> (Replit Agent, Cursor, etc.) and run it. Usually 2-5 minutes — it scans your code and writes GOALS.md.</p>
        <p><span className="text-zinc-300">3. Commit and push to GitHub</span>, then come back and reload below.</p>
      </div>

      {note && <p className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-400">{note}</p>}

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-zinc-800 pt-4">
        {!activeProject ? (
          <span className="text-xs text-zinc-600">Open a project first</span>
        ) : (
          <button
            onClick={handleReload}
            disabled={reloading}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
            {reloading ? 'Pulling…' : "I've pushed — reload"}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])
  return [copied, copy]
}

// ── Stage: Hook ───────────────────────────────────────────────────────────────

function HookStage() {
  const { ideaSeed, setIdeaSeed, setStage, addMessages, setError, error } =
    useGoalsWizardStore()
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  async function handleStart() {
    const text = ideaSeed.trim()
    if (!text || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.goalsGrillTurn([], text)
      addMessages(text, result.message, result.ready)
      setStage('grill')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart()
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            <span className="text-sm font-medium uppercase tracking-widest text-purple-400">
              Goals Wizard
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-zinc-100">What are you building?</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Describe your idea — we'll work through the details together.
          </p>
        </div>

        <textarea
          ref={textareaRef}
          value={ideaSeed}
          onChange={(e) => setIdeaSeed(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. An app that helps freelancers track invoices and automatically follow up on unpaid ones..."
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800/60 px-5 py-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-purple-600/60 focus:ring-1 focus:ring-purple-600/30 transition-colors"
          rows={5}
          disabled={loading}
        />

        {error && (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleStart}
            disabled={!ideaSeed.trim() || loading}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Starting…' : 'Start'}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-zinc-600">
          Cmd+Enter to start
        </p>
      </div>
    </div>
  )
}

// ── Stage: Grill ──────────────────────────────────────────────────────────────

function GrillStage() {
  const { messages, ideaSeed, grillReady, addMessages, setStage, setGenerated, setError, error } =
    useGoalsWizardStore()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    setError(null)
    try {
      const result = await window.api.goalsGrillTurn(messages, text)
      addMessages(text, result.message, result.ready)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    setStage('generating')
    setError(null)
    try {
      const result = await window.api.goalsGenerate(ideaSeed, messages)
      setGenerated(result.goalsMd, result.buildPrompt, result.contextMd)
      setStage('output')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('grill')
      setGenerating(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex h-full">
      {/* Chat panel */}
      <div className="flex flex-1 flex-col border-r border-zinc-800">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Show the user's original idea as the first user bubble */}
          <ChatBubble role="user" text={ideaSeed} />
          {messages.slice(1).map((m, i) => (
            <ChatBubble key={i} role={m.role} text={m.content} />
          ))}
          {sending && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-zinc-800 p-4">
          {error && (
            <p className="mb-2 text-xs text-red-400">{error}</p>
          )}
          <div className="flex gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply… (Enter to send, Shift+Enter for newline)"
              disabled={sending}
              className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-purple-600/50 focus:ring-1 focus:ring-purple-600/20 transition-colors disabled:opacity-50"
              rows={2}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="self-end rounded-lg bg-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Brief panel */}
      <div className="flex w-72 flex-col bg-zinc-950/60">
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Your Brief
          </p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          {grillReady ? (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-900/40 ring-1 ring-green-700/50">
                <Sparkles className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Ready to generate</p>
                <p className="mt-1 text-xs text-zinc-500">
                  I have enough to build your GOALS.md and Replit prompt.
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                Generate
              </button>
              <p className="text-[11px] text-zinc-600">
                You can keep refining before generating.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
                <div className="h-2 w-2 animate-pulse rounded-full bg-purple-400" />
              </div>
              <p className="text-sm text-zinc-400">Building your brief…</p>
              <p className="text-xs text-zinc-600">
                Tell me about your idea until I have enough detail.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user'
  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded-2xl px-4 py-3 text-sm',
          isUser
            ? 'bg-purple-600/80 text-white rounded-br-sm'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-sm',
        ].join(' ')}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {text}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="mb-4 flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:300ms]" />
      </div>
    </div>
  )
}

// ── Stage: Generating ─────────────────────────────────────────────────────────

function GeneratingStage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-purple-500" />
        <Sparkles className="h-6 w-6 text-purple-400" />
      </div>
      <div className="text-center">
        <p className="text-base font-medium text-zinc-200">Generating your documents</p>
        <p className="mt-1 text-sm text-zinc-500">
          Building GOALS.md, build prompt, and CONTEXT.md…
        </p>
      </div>
    </div>
  )
}

// ── Stage: Output ─────────────────────────────────────────────────────────────

function OutputStage() {
  const { goalsMd, buildPrompt, contextMd, setStage } = useGoalsWizardStore()

  const [goalsCopied, copyGoals] = useCopy(goalsMd)
  const [promptCopied, copyPrompt] = useCopy(buildPrompt)
  const [contextCopied, copyContext] = useCopy(contextMd)

  return (
    <div className="flex h-full flex-col">
      {/* Documents */}
      <div className="flex flex-1 min-h-0 gap-0">
        <DocPanel
          title="GOALS.md"
          subtitle="Your project roadmap for Sneebly"
          content={goalsMd}
          copied={goalsCopied}
          onCopy={copyGoals}
          accentColor="purple"
        />
        <DocPanel
          title="Replit Build Prompt"
          subtitle="Paste this into Replit to start building"
          content={buildPrompt}
          copied={promptCopied}
          onCopy={copyPrompt}
          accentColor="indigo"
        />
        <DocPanel
          title="CONTEXT.md"
          subtitle="Domain glossary for AI agents"
          content={contextMd}
          copied={contextCopied}
          onCopy={copyContext}
          accentColor="emerald"
        />
      </div>

      {/* Bottom action bar */}
      <div className="flex flex-shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStage('stack-report')}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Update with Stack Report
          </button>
        </div>
        <p className="max-w-md text-right text-xs text-zinc-500">
          Copy these into Replit (or your AI tool), build, push to GitHub — then use{' '}
          <span className="text-zinc-300">Import existing project</span> to bring it into Sneebly.
        </p>
      </div>
    </div>
  )
}

const DOC_PANEL_ACCENT = {
  purple:  { text: 'text-purple-400',  border: 'border-purple-900/40'  },
  indigo:  { text: 'text-indigo-400',  border: 'border-indigo-900/40'  },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-900/40' },
} as const

function DocPanel({
  title,
  subtitle,
  content,
  copied,
  onCopy,
  accentColor,
}: {
  title: string
  subtitle: string
  content: string
  copied: boolean
  onCopy: () => void
  accentColor: 'purple' | 'indigo' | 'emerald'
}) {
  const { text: textCls, border: borderCls } = DOC_PANEL_ACCENT[accentColor]
  return (
    <div className={`flex flex-1 flex-col border-r last:border-r-0 ${borderCls}`}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <p className={`text-xs font-semibold ${textCls}`}>{title}</p>
          <p className="text-[11px] text-zinc-600">{subtitle}</p>
        </div>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
        >
          {copied ? (
            <><Check className="h-3 w-3 text-green-400" /> Copied</>
          ) : (
            <><Copy className="h-3 w-3" /> Copy</>
          )}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-zinc-300">
          {content || <span className="text-zinc-600">Nothing generated yet.</span>}
        </pre>
      </div>
    </div>
  )
}

// ── Stage: Stack Report ───────────────────────────────────────────────────────

function StackReportStage() {
  const { goalsMd, stackReport, setStackReport, setGoalsMd, setStage, setError, error } =
    useGoalsWizardStore()
  const [updating, setUpdating] = useState(false)

  async function handleUpdate() {
    if (!stackReport.trim() || updating) return
    setUpdating(true)
    setError(null)
    try {
      const updated = await window.api.goalsUpdateStack(goalsMd, stackReport)
      setGoalsMd(updated)
      setStage('output')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
            Stack Report
          </p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">
            Paste the Stack Report from Replit
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            After Replit builds your app, it will output a Stack Report. Paste it here and we'll
            update your GOALS.md with the exact tech stack.
          </p>
        </div>

        <div className="mb-2 rounded-lg border border-zinc-700/50 bg-zinc-900/60 px-4 py-3">
          <p className="text-[11px] font-mono text-zinc-500">Expected format:</p>
          <pre className="mt-1 text-[11px] font-mono text-zinc-400">{`---STACK REPORT---
Language: TypeScript
Framework: Next.js 14
Database: PostgreSQL via Supabase
...
---END STACK REPORT---`}</pre>
        </div>

        <textarea
          value={stackReport}
          onChange={(e) => setStackReport(e.target.value)}
          placeholder="Paste the Stack Report here…"
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-3 font-mono text-xs text-zinc-300 placeholder-zinc-600 outline-none focus:border-indigo-600/60 focus:ring-1 focus:ring-indigo-600/30 transition-colors"
          rows={8}
          disabled={updating}
        />

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex justify-between">
          <button
            onClick={() => setStage('output')}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleUpdate}
            disabled={!stackReport.trim() || updating}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {updating ? 'Updating…' : 'Update GOALS.md'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stage: GitHub connect ─────────────────────────────────────────────────────

type GitHubPhase = 'idle' | 'waiting-user' | 'polling' | 'connected' | 'error'

function GitHubConnectStage() {
  const { closeWizard } = useGoalsWizardStore()
  const { connected, user } = useGitHubStore()

  const [phase, setPhase] = useState<GitHubPhase>(connected ? 'connected' : 'idle')
  const [userCode, setUserCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [connectedUser, setConnectedUser] = useState<GitHubUser | null>(user)
  const [error, setError] = useState<string | null>(null)

  async function startAuth() {
    setPhase('waiting-user')
    setError(null)
    const unsub = window.api.githubOnUserCode(({ code, verificationUri: uri }) => {
      setUserCode(code)
      setVerificationUri(uri)
      setPhase('polling')
    })
    try {
      const result = await window.api.githubStartOAuth()
      unsub()
      if (result.success && result.user) {
        useGitHubStore.getState().setConnected(result.user)
        setConnectedUser(result.user)
        setPhase('connected')
      } else {
        setError(result.error ?? 'Authorization failed')
        setPhase('error')
      }
    } catch (err) {
      unsub()
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-center gap-2">
            <GitBranch className="h-5 w-5 text-indigo-400" />
            <span className="text-sm font-medium uppercase tracking-widest text-indigo-400">GitHub</span>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100">Connect to GitHub</h1>
          <p className="mt-2 text-sm text-zinc-500">
            So Sneebly can push, pull, and create PRs on your behalf.
          </p>
        </div>

        <div className="flex flex-col items-center gap-5">
          {phase === 'idle' && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
                <GitBranch className="h-8 w-8 text-zinc-300" />
              </div>
              <div className="flex flex-col gap-2 w-full">
                <button
                  onClick={startAuth}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
                >
                  Connect GitHub
                </button>
                <button
                  onClick={closeWizard}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}

          {(phase === 'waiting-user' || phase === 'polling') && (
            <>
              <Loader className="h-8 w-8 animate-spin text-zinc-500" />
              {userCode ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs text-zinc-500">
                    Enter this code at{' '}
                    <button
                      onClick={() => verificationUri && window.api.shellOpenExternal(verificationUri)}
                      className="text-indigo-400 underline hover:text-indigo-300"
                    >
                      github.com/login/device
                    </button>
                  </p>
                  <div className="rounded-lg bg-zinc-800 px-6 py-3">
                    <p className="font-mono text-2xl font-bold tracking-[0.2em] text-zinc-100">{userCode}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(userCode)
                    }}
                    className="text-xs text-zinc-500 underline hover:text-zinc-300 transition-colors"
                  >
                    Copy code
                  </button>
                  <p className="text-xs text-zinc-600">Waiting for you to authorize…</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">Opening GitHub…</p>
              )}
            </>
          )}

          {phase === 'connected' && connectedUser && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <div className="flex flex-col items-center gap-2">
                {connectedUser.avatarUrl && (
                  <img
                    src={connectedUser.avatarUrl}
                    alt={connectedUser.login}
                    className="h-12 w-12 rounded-full border border-zinc-700"
                  />
                )}
                <p className="text-sm font-medium text-zinc-200">
                  Connected as <span className="font-mono text-zinc-100">@{connectedUser.login}</span>
                </p>
              </div>
              <button
                onClick={closeWizard}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
              >
                Finish
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <AlertCircle className="h-10 w-10 text-red-500" />
              <div>
                <p className="text-sm font-medium text-zinc-200">Authorization failed</p>
                {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPhase('idle'); setError(null) }}
                  className="rounded-lg bg-zinc-700 px-4 py-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
                >
                  Try again
                </button>
                <button
                  onClick={closeWizard}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                  Skip
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

const STAGE_TITLES: Record<string, string> = {
  'path-pick': 'Goals Wizard',
  import: 'Import Existing Project',
  hook: 'New App',
  grill: 'Define Your App',
  generating: 'Generating',
  output: 'Your Documents',
  'stack-report': 'Stack Report',
  'github-connect': 'Connect GitHub',
}

export default function GoalsWizardModal() {
  const { open, stage, closeWizard, reset } = useGoalsWizardStore()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium text-zinc-300">{STAGE_TITLES[stage] ?? 'Goals Wizard'}</span>
        </div>
        <div className="flex items-center gap-2">
          {stage !== 'path-pick' && stage !== 'generating' && stage !== 'github-connect' && (
            <button
              onClick={reset}
              title="Start over"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Start over
            </button>
          )}
          <button
            onClick={closeWizard}
            disabled={stage === 'generating'}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 disabled:opacity-30 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stage content */}
      <div className="flex-1 min-h-0">
        {stage === 'path-pick' && <PathPickStage />}
        {stage === 'import' && <ImportStage />}
        {stage === 'hook' && <HookStage />}
        {stage === 'grill' && <GrillStage />}
        {stage === 'generating' && <GeneratingStage />}
        {stage === 'output' && <OutputStage />}
        {stage === 'stack-report' && <StackReportStage />}
        {stage === 'github-connect' && <GitHubConnectStage />}
      </div>
    </div>
  )
}
