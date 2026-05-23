import { useRef, useEffect, useState } from 'react'
import { useActivityStore } from '../../state/activityStore'
import { useChatStore } from '../../state/chatStore'
import { useActivityPanelStore } from '../../state/activityPanelStore'
import { useProjectStore } from '../../state/projectStore'
import type { ActivityCardData, CardType } from '../../../shared/types'
import SpecGeneratorModal from '../SpecPanel/SpecGeneratorModal'
import StatusBar from './StatusBar'
import FilterBar from './FilterBar'
import FilesTree from '../FilesPanel/FilesTree'
import DigestCard from '../DaemonPanel/DigestCard'
import ThinkingCard from './cards/ThinkingCard'
import ReadCard from './cards/ReadCard'
import EditCard from './cards/EditCard'
import WriteCard from './cards/WriteCard'
import BashCard from './cards/BashCard'
import SearchCard from './cards/SearchCard'
import WebFetchCard from './cards/WebFetchCard'
import TaskCard from './cards/TaskCard'
import PermissionCard from './cards/PermissionCard'
import ErrorCard from './cards/ErrorCard'
import SummaryCard from './cards/SummaryCard'
import BrowserCheckCard from './cards/BrowserCheckCard'

function CardView({ card }: { card: ActivityCardData }) {
  switch (card.cardType) {
    case 'thinking':      return <ThinkingCard card={card} />
    case 'read':          return <ReadCard card={card} />
    case 'edit':          return <EditCard card={card} />
    case 'write':         return <WriteCard card={card} />
    case 'bash':          return <BashCard card={card} />
    case 'search':        return <SearchCard card={card} />
    case 'webfetch':      return <WebFetchCard card={card} />
    case 'task':          return <TaskCard card={card} />
    case 'permission':    return <PermissionCard card={card} />
    case 'error':         return <ErrorCard card={card} />
    case 'summary':       return <SummaryCard card={card} />
    case 'browsercheck':  return <BrowserCheckCard card={card} />
  }
}

export default function ActivityPanel() {
  const { cards, filters, sourceFilters } = useActivityStore()
  const model = useChatStore((s) => s.defaultModel)
  const { activeTab, setActiveTab } = useActivityPanelStore()
  const { activeProjectId } = useProjectStore()
  const [showSpecBanner, setShowSpecBanner] = useState(false)
  const [specModalOpen, setSpecModalOpen] = useState(false)

  // Listen for auto-suggest push from main
  useEffect(() => {
    return window.api.specOnAutoSuggest((projectId) => {
      if (projectId === activeProjectId) setShowSpecBanner(true)
    })
  }, [activeProjectId])

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    if (activeTab === 'activity' && atBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [cards.length, activeTab])

  const visible = cards.filter((c) => {
    if (!filters[c.cardType as CardType]) return false
    const src = c.source ?? 'chat'
    return sourceFilters[src as keyof typeof sourceFilters] ?? true
  })

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-100">
      {specModalOpen && <SpecGeneratorModal onClose={() => setSpecModalOpen(false)} />}
      <StatusBar model={model} />
      {showSpecBanner && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-purple-900/60 bg-purple-950/30 px-3 py-2">
          <p className="text-[11px] text-purple-300">
            GOALS.md has unfleshed-out milestones.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSpecModalOpen(true); setShowSpecBanner(false) }}
              className="rounded px-2 py-0.5 text-[11px] font-medium text-purple-300 bg-purple-900/40 hover:bg-purple-800/50 transition-colors"
            >
              Generate detailed specs
            </button>
            <button
              onClick={() => setShowSpecBanner(false)}
              className="text-purple-600 hover:text-purple-400 text-xs"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Tab strip */}
      <div className="flex flex-shrink-0 border-b border-zinc-800 bg-zinc-950">
        <button
          onClick={() => setActiveTab('activity')}
          className={[
            'px-4 py-1.5 text-xs transition-colors',
            activeTab === 'activity'
              ? 'border-b-2 border-indigo-500 text-zinc-200'
              : 'text-zinc-500 hover:text-zinc-300',
          ].join(' ')}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={[
            'px-4 py-1.5 text-xs transition-colors',
            activeTab === 'files'
              ? 'border-b-2 border-indigo-500 text-zinc-200'
              : 'text-zinc-500 hover:text-zinc-300',
          ].join(' ')}
        >
          Files
        </button>
      </div>

      {activeTab === 'activity' ? (
        <>
          <DigestCard />
          <FilterBar />
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
          >
            {visible.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
                Activity will appear here
              </div>
            ) : (
              visible.map((card) => (
                <div key={card.id} className={
  card.source === 'daemon' ? 'ring-1 ring-inset ring-indigo-900/60 rounded-md' :
  card.source === 'spec-generator' ? 'ring-1 ring-inset ring-purple-900/60 rounded-md' :
  undefined
}>
                  <CardView card={card} />
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          <FilesTree />
        </div>
      )}
    </div>
  )
}
