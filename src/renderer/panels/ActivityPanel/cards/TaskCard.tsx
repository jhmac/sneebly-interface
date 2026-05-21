import { Cpu } from 'lucide-react'
import type { TaskCard as TTaskCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function TaskCard({ card }: { card: TTaskCard }) {
  return (
    <CardShell
      ts={card.ts}
      accent="border-indigo-700"
      copyText={card.result}
      headerContent={
        <>
          <Cpu className="h-3 w-3 flex-shrink-0 text-indigo-500" />
          <span className="text-zinc-500">Task</span>
          <span className="truncate text-zinc-300">{card.description}</span>
          {card.isError && <span className="rounded bg-red-900/40 px-1 text-red-400">error</span>}
        </>
      }
      expandedContent={
        card.result ? (
          <p className="p-3 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">{card.result}</p>
        ) : undefined
      }
    />
  )
}
