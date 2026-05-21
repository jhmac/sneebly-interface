import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { timeAgo } from '../../../../shared/utils'

interface CardShellProps {
  ts: number
  accent?: string          // left-border color class, e.g. 'border-zinc-600'
  defaultExpanded?: boolean
  headerContent: React.ReactNode
  expandedContent?: React.ReactNode
  copyText?: string
}

export default function CardShell({
  ts,
  accent = 'border-zinc-700',
  defaultExpanded = false,
  headerContent,
  expandedContent,
  copyText,
}: CardShellProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!copyText) return
    navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const canExpand = Boolean(expandedContent)

  return (
    <div className={`rounded-md border border-zinc-800 border-l-2 ${accent} bg-zinc-900/60 text-xs`}>
      <div className="flex items-center gap-2 px-3 py-2">
        {canExpand && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex-shrink-0 text-zinc-600 hover:text-zinc-400"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {headerContent}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 text-zinc-600">
          <span className="text-[10px]">{timeAgo(ts)}</span>
          {copyText && (
            <button onClick={handleCopy} className="hover:text-zinc-400">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
      {expanded && expandedContent && (
        <div className="border-t border-zinc-800">
          {expandedContent}
        </div>
      )}
    </div>
  )
}
