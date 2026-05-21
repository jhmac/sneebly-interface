import { FilePen, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import * as Diff from 'diff'
import type { EditCard as TEditCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function EditCard({ card }: { card: TEditCard }) {
  const fileName = card.filePath.split('/').pop() ?? card.filePath

  const diffLines = useMemo(() => {
    if (!card.oldContent && !card.newContent) return null
    const hunks = Diff.diffLines(card.oldContent ?? '', card.newContent ?? '')
    const out: { kind: 'add' | 'remove' | 'same'; text: string }[] = []
    for (const part of hunks) {
      const lines = part.value.split('\n').filter((_, i, a) => i < a.length - 1 || part.value.endsWith('\n') || i < a.length - 1)
      const rawLines = part.value.split('\n')
      for (let i = 0; i < rawLines.length; i++) {
        if (i === rawLines.length - 1 && rawLines[i] === '') break
        out.push({
          kind: part.added ? 'add' : part.removed ? 'remove' : 'same',
          text: rawLines[i],
        })
      }
    }
    return out
  }, [card.oldContent, card.newContent])

  return (
    <CardShell
      ts={card.ts}
      accent="border-amber-600"
      copyText={card.newContent}
      headerContent={
        <>
          <FilePen className="h-3 w-3 flex-shrink-0 text-amber-500" />
          <span className="truncate font-mono text-zinc-300">{fileName}</span>
          {card.isError && <span className="rounded bg-red-900/40 px-1 text-red-400">error</span>}
          <button
            onClick={() => window.api.shellOpenExternal(`file://${card.filePath}`)}
            title="View in editor"
            className="ml-auto flex-shrink-0 text-zinc-600 hover:text-zinc-400"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </>
      }
      expandedContent={
        diffLines ? (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full font-mono text-[11px] leading-5">
              <tbody>
                {diffLines.map((line, i) => (
                  <tr
                    key={i}
                    className={
                      line.kind === 'add'
                        ? 'bg-green-900/20 text-green-300'
                        : line.kind === 'remove'
                        ? 'bg-red-900/20 text-red-300'
                        : 'text-zinc-500'
                    }
                  >
                    <td className="w-5 select-none px-2 text-center opacity-60">
                      {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                    </td>
                    <td className="px-2 whitespace-pre">{line.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : card.result ? (
          <p className="p-3 text-zinc-500">{card.result}</p>
        ) : undefined
      }
    />
  )
}
