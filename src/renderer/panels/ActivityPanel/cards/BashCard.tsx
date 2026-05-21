import { Terminal } from 'lucide-react'
import type { BashCard as TBashCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function BashCard({ card }: { card: TBashCard }) {
  const hasOutput = Boolean(card.output?.trim())
  return (
    <CardShell
      ts={card.ts}
      accent="border-zinc-500"
      copyText={card.command}
      headerContent={
        <>
          <Terminal className="h-3 w-3 flex-shrink-0 text-zinc-400" />
          <code className="truncate font-mono text-zinc-300">{card.command}</code>
          {card.isError && (
            <span className="ml-auto flex-shrink-0 rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] text-red-400">
              error
            </span>
          )}
        </>
      }
      expandedContent={
        hasOutput ? (
          <pre className="max-h-64 overflow-y-auto bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
            {card.output}
          </pre>
        ) : undefined
      }
    />
  )
}
