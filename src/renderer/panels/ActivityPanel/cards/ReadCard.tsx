import { FileText } from 'lucide-react'
import type { ReadCard as TReadCard } from '../../../../shared/types'
import CardShell from './CardShell'
import CodeBlock from '../../ChatPanel/CodeBlock'

function langFromPath(p: string): string {
  const ext = p.split('.').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', sh: 'bash', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
    css: 'css', html: 'html', sql: 'sql',
  }
  return map[ext] ?? 'text'
}

export default function ReadCard({ card }: { card: TReadCard }) {
  const fileName = card.filePath.split('/').pop() ?? card.filePath
  const lineRange = card.startLine != null
    ? ` :${card.startLine}${card.endLine != null ? `–${card.endLine}` : ''}`
    : ''

  return (
    <CardShell
      ts={card.ts}
      accent="border-blue-700"
      copyText={card.resultContent}
      headerContent={
        <>
          <FileText className="h-3 w-3 flex-shrink-0 text-blue-500" />
          <span className="truncate font-mono text-zinc-300">{fileName}</span>
          {lineRange && <span className="text-zinc-500">{lineRange}</span>}
          {card.isError && <span className="rounded bg-red-900/40 px-1 text-red-400">error</span>}
        </>
      }
      expandedContent={
        card.resultContent ? (
          <div className="overflow-hidden">
            <CodeBlock language={langFromPath(card.filePath)} code={card.resultContent} />
          </div>
        ) : undefined
      }
    />
  )
}
