import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, X, Send, Square, MessagesSquare } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAskSneeblyStore } from './useAskSneeblyStore'
import { useProjectStore } from '../../state/projectStore'

const MARKDOWN_CLASS =
  'prose prose-invert prose-sm max-w-none text-zinc-300 [&_a]:text-blue-400 [&_a]:no-underline hover:[&_a]:underline [&_strong]:text-zinc-200 [&_li]:text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-zinc-300 [&_pre]:bg-zinc-900 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5'

const EXAMPLE_QUESTIONS = [
  'What is this project building?',
  'What did Sneebly just do?',
  'Is this code safe to ship?',
  'What does the current milestone mean?',
]

export default function AskSneeblyPanel() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const currentConversation = useAskSneeblyStore((s) => s.currentConversation)
  const isStreaming = useAskSneeblyStore((s) => s.isStreaming)
  const askQuestion = useAskSneeblyStore((s) => s.askQuestion)
  const cancelCurrent = useAskSneeblyStore((s) => s.cancelCurrent)
  const newConversation = useAskSneeblyStore((s) => s.newConversation)
  const setSidebarVisible = useAskSneeblyStore((s) => s.setSidebarVisible)

  const [input, setInput] = useState('')
  const [includeDiff, setIncludeDiff] = useState(false)
  const [includeEvents, setIncludeEvents] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const messages = currentConversation?.messages ?? []

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || isStreaming || !activeProjectId) return
    setInput('')
    askQuestion(activeProjectId, q, { includeDiff, includeEvents })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* Header */}
      <div className="flex h-9 flex-shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
          <MessagesSquare className="h-3.5 w-3.5 text-indigo-400" />
          Ask Sneebly
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => activeProjectId && newConversation(activeProjectId)}
            title="New question"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setSidebarVisible(false)}
            title="Close"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3 pt-4 text-xs text-zinc-500">
            <p className="leading-relaxed">
              Ask questions about your project while the build agent works. Answers come from an
              independent Claude session that reads your project files — it can&apos;t edit anything.
            </p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-left text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="text-xs leading-relaxed">
              <div className="mb-0.5 font-semibold text-zinc-500">
                {m.role === 'user' ? 'You' : 'Sneebly'}
              </div>
              {m.role === 'assistant' && m.isStreaming && m.content === '' ? (
                <div className="space-y-0.5">
                  {(m.thinking ?? []).length === 0 ? (
                    <span className="italic text-zinc-600">Thinking…</span>
                  ) : (
                    (m.thinking ?? []).map((t, i) => (
                      <div key={i} className="italic text-zinc-600">
                        {t}
                      </div>
                    ))
                  )}
                </div>
              ) : m.role === 'assistant' ? (
                <div className={MARKDOWN_CLASS}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-zinc-300">{m.content}</div>
              )}
              {m.error && (
                <div className="mt-1 text-rose-400">Error: {m.error}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-zinc-800 px-3 py-2">
        <div className="mb-2 flex flex-col gap-1 text-[11px] text-zinc-500">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeDiff}
              onChange={(e) => setIncludeDiff(e.target.checked)}
              className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 accent-indigo-500"
            />
            Include current diff
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeEvents}
              onChange={(e) => setIncludeEvents(e.target.checked)}
              className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 accent-indigo-500"
            />
            Include recent activity (last 20)
          </label>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            rows={2}
            placeholder={activeProjectId ? 'Ask a question…  (Cmd+Enter)' : 'Open a project first'}
            className="flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 disabled:opacity-60"
          />
          {isStreaming ? (
            <button
              onClick={cancelCurrent}
              title="Stop"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-rose-600/80 text-white transition-colors hover:bg-rose-600"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim() || !activeProjectId}
              title="Send (Cmd+Enter)"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
