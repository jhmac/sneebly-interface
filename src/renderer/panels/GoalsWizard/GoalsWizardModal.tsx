import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X, Copy, Check, Sparkles, ArrowRight, RotateCcw } from 'lucide-react'
import { useGoalsWizardStore } from '../../state/goalsWizardStore'
import { useProjectStore } from '../../state/projectStore'

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
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const [goalsCopied, copyGoals] = useCopy(goalsMd)
  const [promptCopied, copyPrompt] = useCopy(buildPrompt)
  const [contextCopied, copyContext] = useCopy(contextMd)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    if (!activeProjectId || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await window.api.goalsWrite(activeProjectId, goalsMd)
      if (contextMd) await window.api.goalsWriteContext(activeProjectId, contextMd)
      setSaved(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

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
        <div className="flex items-center gap-3">
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          {!activeProject ? (
            <p className="text-xs text-zinc-600">
              Open a project to save docs there
            </p>
          ) : saved ? (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <Check className="h-3.5 w-3.5" />
              Saved to {activeProject.name}
            </span>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : `Save to ${activeProject.name}`}
            </button>
          )}
        </div>
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

// ── Main modal ────────────────────────────────────────────────────────────────

const STAGE_TITLES: Record<string, string> = {
  hook: 'New App',
  grill: 'Define Your App',
  generating: 'Generating',
  output: 'Your Documents',
  'stack-report': 'Stack Report',
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
          {stage !== 'hook' && stage !== 'generating' && (
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
        {stage === 'hook' && <HookStage />}
        {stage === 'grill' && <GrillStage />}
        {stage === 'generating' && <GeneratingStage />}
        {stage === 'output' && <OutputStage />}
        {stage === 'stack-report' && <StackReportStage />}
      </div>
    </div>
  )
}
