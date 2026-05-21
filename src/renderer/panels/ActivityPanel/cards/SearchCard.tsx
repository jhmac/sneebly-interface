import { Search } from 'lucide-react'
import type { SearchCard as TSearchCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function SearchCard({ card }: { card: TSearchCard }) {
  const lines = card.resultContent?.split('\n').filter(Boolean) ?? []
  return (
    <CardShell
      ts={card.ts}
      accent="border-violet-700"
      copyText={card.resultContent}
      headerContent={
        <>
          <Search className="h-3 w-3 flex-shrink-0 text-violet-500" />
          <span className="text-zinc-500">{card.toolName}</span>
          <code className="truncate font-mono text-zinc-300">{card.pattern}</code>
          {lines.length > 0 && (
            <span className="ml-auto flex-shrink-0 text-zinc-600">{lines.length} matches</span>
          )}
          {card.isError && <span className="rounded bg-red-900/40 px-1 text-red-400">error</span>}
        </>
      }
      expandedContent={
        lines.length > 0 ? (
          <div className="max-h-48 overflow-y-auto p-3">
            {lines.map((line, i) => (
              <div key={i} className="font-mono text-[11px] text-zinc-400">{line}</div>
            ))}
          </div>
        ) : undefined
      }
    />
  )
}
