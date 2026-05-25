import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { useChatStore } from '../../state/chatStore'
import { useSettingsStore } from '../../state/settingsStore'
import { useActivityStore } from '../../state/activityStore'
import { useProjectStore } from '../../state/projectStore'
import type { ModelName, SessionSummary } from '../../../shared/types'
import { timeAgo } from '../../../shared/utils'
import MessageList from './MessageList'
import Composer from './Composer'
import SkillSelector from './SkillSelector'

const MODELS: { id: ModelName; label: string }[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7'   },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5'  },
]

export default function ChatPanel({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { messages, pastSessions, defaultModel, pendingSend, switchModel, createNewSession, switchSession } = useChatStore()

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-100">
      <ChatHeader
        model={defaultModel}
        onModelChange={switchModel}
        pastSessions={pastSessions}
        onNewSession={createNewSession}
        onSwitchSession={switchSession}
        onOpenSettings={onOpenSettings}
      />
      <MessageList messages={messages} pendingSend={pendingSend} />
      <Composer />
    </div>
  )
}

function ChatHeader({
  model,
  onModelChange,
  pastSessions,
  onNewSession,
  onSwitchSession,
  onOpenSettings,
}: {
  model: ModelName
  onModelChange: (m: ModelName) => void
  pastSessions: SessionSummary[]
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onOpenSettings?: () => void
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const sessionsRef = useRef<HTMLDivElement>(null)
  const autoSelfReview = useSettingsStore((s) => s.settings?.autoSelfReview ?? true)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const isReviewing = useActivityStore((s) => s.chatInFlightProjectIds.has(activeProjectId ?? ''))

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
      if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) setSessionsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentLabel = MODELS.find((m) => m.id === model)?.label ?? model

  return (
    <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3">
      {/* Model picker */}
      <div ref={modelRef} className="relative">
        <button
          onClick={() => setModelOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {currentLabel}
          <ChevronDown className="h-3 w-3" />
        </button>
        {modelOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => { onModelChange(m.id); setModelOpen(false) }}
                className={[
                  'flex w-full items-center px-3 py-2 text-left text-xs transition-colors',
                  m.id === model ? 'text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                ].join(' ')}
              >
                {m.label}
                {m.id === model && <span className="ml-auto text-zinc-500">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1">
        {autoSelfReview && (
          <button
            onClick={onOpenSettings}
            title={isReviewing ? 'Auto-review in progress…' : 'Auto-review is on — click to configure'}
            className="rounded-md px-2 py-0.5 text-[10px] font-medium text-indigo-400 bg-indigo-950/60 hover:bg-indigo-900/60 transition-colors"
          >
            {isReviewing ? (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                Reviewing…
              </span>
            ) : (
              'Review'
            )}
          </button>
        )}
        <SkillSelector />
        <button
          onClick={onNewSession}
          title="New session"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Plus className="h-3 w-3" />
          New
        </button>

        {/* Sessions dropdown */}
        <div ref={sessionsRef} className="relative">
          <button
            onClick={() => setSessionsOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            Sessions
            <ChevronDown className="h-3 w-3" />
          </button>
          {sessionsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
              {pastSessions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-600">No past sessions</p>
              ) : (
                pastSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { onSwitchSession(s.id); setSessionsOpen(false) }}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                  >
                    <span className="truncate text-xs text-zinc-300">{s.preview}</span>
                    <span className="text-[10px] text-zinc-600">
                      {s.messageCount} messages · {timeAgo(s.lastMessageAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
