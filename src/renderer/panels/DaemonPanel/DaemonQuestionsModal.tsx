import { useEffect, useRef, useState } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useDaemonStore } from '../../state/daemonStore'
import type { OpenQuestion } from '../../../shared/types'

// ── Auto-grow textarea ─────────────────────────────────────────────────────

function AutoTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full resize-none rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500 transition-colors"
    />
  )
}

// ── Question card ──────────────────────────────────────────────────────────

function QuestionCard({
  question,
  projectId,
  onAnswered,
}: {
  question: OpenQuestion
  projectId: string
  onAnswered: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    if (!answer.trim()) return
    setSaving(true)
    try {
      await window.api.daemonAnswerOpenQuestion(projectId, question.cycleId, answer.trim())
      setSaved(true)
      useDaemonStore.getState().refreshQuestionCounts()
      setTimeout(onAnswered, 800)
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-green-400">
        Answer saved. Daemon will use it on the next cycle.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 flex flex-col gap-2">
      <p className="text-sm text-zinc-200">{question.question}</p>
      <p className="text-xs text-zinc-500">
        {question.constraint} · {new Date(question.ts).toLocaleString()}
      </p>
      <AutoTextarea
        value={answer}
        onChange={setAnswer}
        placeholder="Type your answer…"
      />
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!answer.trim() || saving}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save answer'}
        </button>
      </div>
    </div>
  )
}

// ── Per-project section ────────────────────────────────────────────────────

function ProjectSection({
  projectId,
  projectName,
  onChanged,
}: {
  projectId: string
  projectName: string
  onChanged: () => void
}) {
  const [questions, setQuestions] = useState<OpenQuestion[] | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  async function load() {
    try {
      const qs = await window.api.daemonListOpenQuestions(projectId)
      setQuestions(qs)
    } catch {
      setQuestions([])
    }
  }

  useEffect(() => { load() }, [projectId])

  if (!questions || questions.length === 0) return null

  return (
    <section>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3" />
          : <ChevronDown className="h-3 w-3" />
        }
        {projectName} ({questions.length})
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2 mt-1.5">
          {questions.map((q) => (
            <QuestionCard
              key={q.cycleId}
              question={q}
              projectId={projectId}
              onAnswered={() => { load(); onChanged() }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────

export default function DaemonQuestionsModal({ onClose }: { onClose: () => void }) {
  const { projects, activeProjectId } = useProjectStore()
  const { questionCounts, refreshQuestionCounts } = useDaemonStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeQuestionCount = questionCounts[activeProjectId ?? ''] ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[600px] max-h-[90vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Open Questions</h2>
            {activeProject && (
              <p className="text-xs text-zinc-500 mt-0.5">{activeProject.name}</p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeQuestionCount === 0 ? (
            <p className="text-center text-xs text-zinc-600 py-12">No open questions yet.</p>
          ) : activeProjectId && activeProject ? (
            <ProjectSection
              projectId={activeProjectId}
              projectName={activeProject.name}
              onChanged={refreshQuestionCounts}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
