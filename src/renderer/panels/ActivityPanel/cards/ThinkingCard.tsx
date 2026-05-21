import { Brain } from 'lucide-react'
import type { ThinkingCard as TThinkingCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function ThinkingCard({ card }: { card: TThinkingCard }) {
  return (
    <CardShell
      ts={card.ts}
      accent="border-zinc-600"
      defaultExpanded={false}
      copyText={card.text}
      headerContent={
        <>
          <Brain className="h-3 w-3 flex-shrink-0 text-zinc-500" />
          <span className="text-zinc-500 italic">Claude is thinking…</span>
        </>
      }
      expandedContent={
        <pre className="max-h-48 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
          {card.text}
        </pre>
      }
    />
  )
}
