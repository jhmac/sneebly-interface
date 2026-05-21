import { FilePlus } from 'lucide-react'
import type { WriteCard as TWriteCard } from '../../../../shared/types'
import CardShell from './CardShell'
import CodeBlock from '../../ChatPanel/CodeBlock'

function langFromPath(p: string): string {
  const ext = p.split('.').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', sh: 'bash', json: 'json',
    yaml: 'yaml', yml: 'yaml', css: 'css', html: 'html', md: 'markdown',
  }
  return map[ext] ?? 'text'
}

export default function WriteCard({ card }: { card: TWriteCard }) {
  const fileName = card.filePath.split('/').pop() ?? card.filePath
  return (
    <CardShell
      ts={card.ts}
      accent="border-green-700"
      copyText={card.content}
      headerContent={
        <>
          <FilePlus className="h-3 w-3 flex-shrink-0 text-green-500" />
          <span className="text-green-600">new</span>
          <span className="truncate font-mono text-zinc-300">{fileName}</span>
          {card.isError && <span className="rounded bg-red-900/40 px-1 text-red-400">error</span>}
        </>
      }
      expandedContent={
        card.content ? (
          <div className="overflow-hidden">
            <CodeBlock language={langFromPath(card.filePath)} code={card.content} />
          </div>
        ) : undefined
      }
    />
  )
}
