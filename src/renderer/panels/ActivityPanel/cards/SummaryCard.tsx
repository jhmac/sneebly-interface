import { MessageSquare } from 'lucide-react'
import type { SummaryCard as TSummaryCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function SummaryCard({ card }: { card: TSummaryCard }) {
  const preview = card.text.length > 120 ? card.text.slice(0, 120) + '…' : card.text
  return (
    <CardShell
      ts={card.ts}
      accent="border-zinc-600"
      copyText={card.text}
      headerContent={
        <>
          <MessageSquare className="h-3 w-3 flex-shrink-0 text-zinc-500" />
          <span className="italic text-zinc-500">Claude says: "{preview}"</span>
        </>
      }
      expandedContent={
        card.text.length > 120 ? (
          <p className="p-3 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">{card.text}</p>
        ) : undefined
      }
    />
  )
}
