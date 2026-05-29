import { CheckCircle, XCircle, Copy, Check, ExternalLink } from 'lucide-react'
import { useState, useCallback } from 'react'
import type { AuditFinding } from '../../../shared/types'

interface Props {
  finding: AuditFinding
  onMarkResolved: (id: string, resolved: boolean) => void
  onMarkFalsePositive: (id: string, fp: boolean) => void
}

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])
  return [copied, copy]
}

function formatExcerpt(finding: AuditFinding): string {
  const { lines, startLine, highlightStart, highlightEnd } = finding.codeExcerpt
  return lines.map((l, i) => {
    const lineNum = startLine + i
    const marker = lineNum >= highlightStart && lineNum <= highlightEnd ? '>' : ' '
    return `${marker} ${String(lineNum).padStart(4)} │ ${l}`
  }).join('\n')
}

export default function AuditFindingDetail({ finding, onMarkResolved, onMarkFalsePositive }: Props) {
  const excerpt = formatExcerpt(finding)
  const [copied, copy] = useCopy(
    `**${finding.title}**\n\n${finding.description}\n\n**File:** ${finding.filePath}:${finding.startLine}\n\n**Fix:** ${finding.suggestedFix}`,
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-100">{finding.title}</p>
            <p className="mt-1 text-[10px] font-mono text-zinc-500">
              {finding.filePath}:{finding.startLine}–{finding.endLine}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={copy}
              title="Copy finding"
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 transition-colors"
            >
              {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] font-medium text-zinc-400 uppercase">
            {finding.severity}
          </span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-500">
            {finding.category}
          </span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] font-mono text-zinc-600">
            {finding.id}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 px-5 py-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Description</p>
          <p className="text-xs leading-relaxed text-zinc-300">{finding.description}</p>
        </div>

        {finding.businessImpact && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Impact</p>
            <p className="text-xs leading-relaxed text-amber-300/80">{finding.businessImpact}</p>
          </div>
        )}

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Code</p>
          <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {excerpt}
          </pre>
        </div>

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Suggested fix</p>
          <p className="text-xs leading-relaxed text-zinc-300">{finding.suggestedFix}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
        <button
          onClick={() => onMarkFalsePositive(finding.id, !finding.falsePositive)}
          className={[
            'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] transition-colors',
            finding.falsePositive
              ? 'bg-zinc-700 text-zinc-300'
              : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
          ].join(' ')}
        >
          <XCircle className="h-3 w-3" />
          {finding.falsePositive ? 'Un-flag false positive' : 'False positive'}
        </button>

        <button
          onClick={() => onMarkResolved(finding.id, !finding.resolved)}
          className={[
            'flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-medium transition-colors',
            finding.resolved
              ? 'bg-zinc-700 text-zinc-300'
              : 'bg-green-900/60 text-green-300 hover:bg-green-900/80',
          ].join(' ')}
        >
          <CheckCircle className="h-3 w-3" />
          {finding.resolved ? 'Unresolve' : 'Mark resolved'}
        </button>
      </div>
    </div>
  )
}
