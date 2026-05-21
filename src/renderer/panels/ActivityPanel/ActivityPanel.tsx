import { useRef, useEffect } from 'react'
import { useActivityStore } from '../../state/activityStore'
import { useChatStore } from '../../state/chatStore'
import type { ActivityCardData, CardType } from '../../../shared/types'
import StatusBar from './StatusBar'
import FilterBar from './FilterBar'
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
  const { cards, filters } = useActivityStore()
  const model = useChatStore((s) => s.defaultModel)

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    if (atBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [cards.length])

  const visible = cards.filter((c) => filters[c.cardType as CardType])

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-100">
      <StatusBar model={model} />
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
          visible.map((card) => <CardView key={card.id} card={card} />)
        )}
      </div>
    </div>
  )
}
