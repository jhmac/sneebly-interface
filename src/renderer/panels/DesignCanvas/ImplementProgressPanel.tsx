import { useEffect, useRef } from 'react'
import { Loader2, CheckCircle2, XCircle, GitBranch, X } from 'lucide-react'
import { useDesignImplementStore } from '../../state/designImplementStore'
import { useViewStore } from '../../state/viewStore'
import type { AgentEvent, AgentContentToolUse } from '../../../shared/types'

interface Props {
  onClose: () => void
}

export default function ImplementProgressPanel({ onClose }: Props) {
  const { current, reset } = useDesignImplementStore()
  const { setView } = useViewStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll as events arrive
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [current.events.length])

  function handleClose() {
    // Cancel in-flight work if still running
    if (current.status === 'running' && current.implementId) {
      window.api.designImplementCancel(current.implementId).catch(console.error)
    }
    reset()
    onClose()
  }

  return (
    <div className="flex flex-col border-t border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <StatusIcon status={current.status} />
        <span className="flex-1 text-xs font-medium text-zinc-300">
          {current.status === 'running' && 'Implementing design…'}
          {current.status === 'success' && 'Implementation complete'}
          {current.status === 'error' && 'Implementation failed'}
        </span>
        {current.status === 'success' && (
          <button
            onClick={() => { reset(); onClose(); setView('workspace') }}
            title="Switch to workspace to view git diff"
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <GitBranch className="h-3 w-3" />
            View in workspace
          </button>
        )}
        <button
          onClick={handleClose}
          className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Event stream */}
      <div
        ref={scrollRef}
        className="h-40 overflow-y-auto px-3 py-2 space-y-1"
      >
        {current.events.length === 0 && current.status === 'running' && (
          <p className="text-[10px] text-zinc-600">Starting…</p>
        )}
        {current.events.map((event, i) => (
          <EventRow key={i} event={event} />
        ))}
        {current.status === 'error' && current.error && (
          <p className="text-[10px] text-red-400">{current.error}</p>
        )}
      </div>
    </div>
  )
}

// ─── EventRow ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: AgentEvent }) {
  const label = describeEvent(event)
  if (!label) return null
  return (
    <p className="truncate text-[10px] text-zinc-500">{label}</p>
  )
}

function describeEvent(event: AgentEvent): string | null {
  if (event.type !== 'assistant') return null

  const blocks = event.message.content
  // Prefer showing text output
  const textBlock = blocks.find((b) => b.type === 'text')
  if (textBlock && textBlock.type === 'text' && textBlock.text.trim()) {
    return `Claude: ${textBlock.text.trim().slice(0, 120)}`
  }
  // Otherwise describe the first tool-use block
  const toolBlock = blocks.find((b): b is AgentContentToolUse => b.type === 'tool_use')
  if (!toolBlock) return null
  const { name, input } = toolBlock
  if (name === 'Write' || name === 'Edit') {
    const path = (input.path ?? input.file_path) as string | undefined
    return path ? `${name}: ${path}` : name
  }
  if (name === 'Read') {
    const path = (input.path ?? input.file_path) as string | undefined
    return path ? `Read: ${path}` : 'Read'
  }
  if (name === 'Bash') {
    const cmd = input.command as string | undefined
    return cmd ? `Bash: ${cmd.slice(0, 80)}` : 'Bash'
  }
  return name
}

// ─── StatusIcon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
  if (status === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
  return <XCircle className="h-3.5 w-3.5 text-red-400" />
}
