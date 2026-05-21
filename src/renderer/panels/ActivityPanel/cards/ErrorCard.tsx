import { AlertCircle } from 'lucide-react'
import type { ErrorCard as TErrorCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function ErrorCard({ card }: { card: TErrorCard }) {
  return (
    <CardShell
      ts={card.ts}
      accent="border-red-700"
      defaultExpanded={true}
      copyText={card.message}
      headerContent={
        <>
          <AlertCircle className="h-3 w-3 flex-shrink-0 text-red-500" />
          <span className="text-red-400">Error</span>
        </>
      }
      expandedContent={
        <p className="p-3 font-mono text-[11px] leading-relaxed text-red-300 whitespace-pre-wrap">
          {card.message}
        </p>
      }
    />
  )
}
