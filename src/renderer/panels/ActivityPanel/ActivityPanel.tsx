import { useRef, useEffect } from 'react'
import { useActivityStore } from '../../state/activityStore'
import { useChatStore } from '../../state/chatStore'
import { useActivityPanelStore } from '../../state/activityPanelStore'
import type { ActivityCardData, CardType } from '../../../shared/types'
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
      <StatusBar model={model} />

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
                <div key={card.id} className={card.source === 'daemon' ? 'ring-1 ring-inset ring-indigo-900/60 rounded-md' : undefined}>
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
