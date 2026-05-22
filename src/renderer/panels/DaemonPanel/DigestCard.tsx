import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import type { JournalEntry } from '../../../shared/types'

interface DigestSummary {
  commits: number
  queued: number
  blocked: number
  projectBreakdown: Array<{
    projectId: string
    projectName: string
    cycleCount: number
    outcomes: Record<string, number>
    lastCycleTs: string
  }>
  earliestTs: number
}

function SummaryModal({
  summary,
  sinceLabel,
  onClose,
}: {
  summary: DigestSummary
  sinceLabel: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60">
      <div
        className="flex w-[560px] max-h-[80vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">
            Daemon activity since {sinceLabel}
          </h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {summary.projectBreakdown
            .sort((a, b) => b.lastCycleTs.localeCompare(a.lastCycleTs))
            .map((p) => (
              <div key={p.projectId} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <p className="text-sm font-medium text-zinc-200">{p.projectName}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {p.cycleCount} cycle{p.cycleCount !== 1 ? 's' : ''} ·
                  Last: {new Date(p.lastCycleTs).toLocaleString()}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Object.entries(p.outcomes).map(([outcome, count]) => (
                    <span key={outcome} className="text-xs text-zinc-400">
                      {count} {outcome}
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export default function DigestCard() {
  const { projects } = useProjectStore()
  const [summary, setSummary] = useState<DigestSummary | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    if (projects.length === 0) return

    let lastShown: number
    try {
      lastShown = parseInt(localStorage.getItem('daemon.lastShownDigestAt') ?? '0', 10) || 0
    } catch {
      lastShown = 0
    }

    async function loadDigest() {
      let commits = 0, queued = 0, blocked = 0
      const breakdownMap = new Map<string, DigestSummary['projectBreakdown'][0]>()

      for (const project of projects) {
        try {
          const entries = await window.api.daemonReadJournal(project.id)
          const recent = entries.filter((e: JournalEntry) => new Date(e.ts).getTime() > lastShown)

          const cycleEnds = recent.filter((e: JournalEntry) => e.event === 'cycle-end' || e.event === 'committed')
          const committedCount = recent.filter((e: JournalEntry) => e.event === 'committed').length
          const queuedCount = recent.filter((e: JournalEntry) => e.event === 'queued').length
          const blockedCount = recent.filter((e: JournalEntry) => e.event === 'blocked').length

          commits += committedCount
          queued += queuedCount
          blocked += blockedCount

          if (cycleEnds.length > 0 || committedCount > 0 || queuedCount > 0 || blockedCount > 0) {
            const outcomes: Record<string, number> = {}
            for (const e of recent) {
              if (['committed', 'queued', 'blocked', 'phase-complete'].includes(e.event)) {
                outcomes[e.event] = (outcomes[e.event] ?? 0) + 1
              }
            }
            const lastEntry = recent[recent.length - 1]
            breakdownMap.set(project.id, {
              projectId: project.id,
              projectName: project.name,
              cycleCount: recent.filter((e: JournalEntry) => e.event === 'cycle-start').length,
              outcomes,
              lastCycleTs: lastEntry?.ts ?? new Date().toISOString(),
            })
          }
        } catch {
          // Project journal unreadable — skip
        }
      }

      const total = commits + queued + blocked
      if (total > 0 || breakdownMap.size > 0) {
        // Find earliest event ts across all projects
        const allEntries = await Promise.all(
          projects.map((p) => window.api.daemonReadJournal(p.id).catch(() => [] as JournalEntry[]))
        )
        const allRecent = allEntries
          .flat()
          .filter((e) => new Date(e.ts).getTime() > lastShown)
        const earliest = allRecent.length > 0
          ? Math.min(...allRecent.map((e) => new Date(e.ts).getTime()))
          : lastShown

        setSummary({
          commits,
          queued,
          blocked,
          projectBreakdown: Array.from(breakdownMap.values()),
          earliestTs: earliest,
        })
      }
    }

    loadDigest()
  }, [projects.length])

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem('daemon.lastShownDigestAt', String(Date.now())) } catch { /* ignore */ }
  }

  if (!summary || dismissed) return null

  const { commits, queued, blocked, projectBreakdown } = summary
  const projectCount = projectBreakdown.length
  const sinceLabel = new Date(summary.earliestTs).toLocaleString()

  const parts: string[] = []
  if (commits > 0) parts.push(`${commits} commit${commits !== 1 ? 's' : ''}`)
  if (queued > 0) parts.push(`${queued} approval${queued !== 1 ? 's' : ''} queued`)
  if (blocked > 0) parts.push(`${blocked} question${blocked !== 1 ? 's' : ''} opened`)
  const summary_text = parts.join(', ')

  return (
    <>
      <div className="mx-3 mt-2 flex flex-shrink-0 items-start gap-2 rounded-md border border-l-2 border-indigo-700 border-l-indigo-500 bg-indigo-950/30 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-indigo-200">
            Daemon was active since you last looked:{' '}
            <span className="font-medium">{summary_text}</span>
            {' '}across {projectCount} project{projectCount !== 1 ? 's' : ''}.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-0.5 text-[11px] text-indigo-400 underline hover:text-indigo-300"
          >
            View summary
          </button>
        </div>
        <button onClick={dismiss} className="flex-shrink-0 text-indigo-600 hover:text-indigo-400">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {showModal && (
        <SummaryModal
          summary={summary}
          sinceLabel={sinceLabel}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
