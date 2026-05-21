import { Globe } from 'lucide-react'
import type { WebFetchCard as TWebFetchCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function WebFetchCard({ card }: { card: TWebFetchCard }) {
  let displayUrl = card.url
  try { displayUrl = new URL(card.url).hostname } catch { /* keep full url */ }

  const preview = card.resultContent?.slice(0, 200)

  return (
    <CardShell
      ts={card.ts}
      accent="border-sky-700"
      copyText={card.resultContent}
      headerContent={
        <>
          <Globe className="h-3 w-3 flex-shrink-0 text-sky-500" />
          <span className="truncate font-mono text-zinc-300">{displayUrl}</span>
          {card.isError && <span className="rounded bg-red-900/40 px-1 text-red-400">error</span>}
        </>
      }
      expandedContent={
        preview ? (
          <p className="p-3 text-[11px] leading-relaxed text-zinc-400 line-clamp-4">{preview}</p>
        ) : undefined
      }
    />
  )
}
