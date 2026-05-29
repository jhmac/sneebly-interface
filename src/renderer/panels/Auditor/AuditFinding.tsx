import { ShieldAlert, AlertTriangle, Info, Minus, CheckCircle, AlertCircle } from 'lucide-react'
import type { AuditFinding } from '../../../shared/types'

const SEVERITY_STYLES: Record<AuditFinding['severity'], { icon: React.ElementType; text: string; bg: string }> = {
  critical: { icon: ShieldAlert,    text: 'text-red-400',    bg: 'bg-red-900/30' },
  high:     { icon: AlertTriangle,  text: 'text-orange-400', bg: 'bg-orange-900/30' },
  medium:   { icon: AlertCircle,    text: 'text-amber-400',  bg: 'bg-amber-900/30' },
  low:      { icon: Info,           text: 'text-zinc-400',   bg: 'bg-zinc-800' },
}

interface Props {
  finding: AuditFinding
  selected: boolean
  onClick: () => void
}

export default function AuditFindingRow({ finding, selected, onClick }: Props) {
  const { icon: SeverityIcon, text: textCls, bg: bgCls } = SEVERITY_STYLES[finding.severity]

  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-start gap-3 border-b border-zinc-800 px-4 py-3 text-left transition-colors',
        selected ? 'bg-zinc-800/60' : 'hover:bg-zinc-900',
        finding.resolved ? 'opacity-50' : '',
        finding.falsePositive ? 'opacity-40' : '',
      ].join(' ')}
    >
      <div className={`mt-0.5 flex-shrink-0 rounded p-0.5 ${bgCls}`}>
        <SeverityIcon className={`h-3 w-3 ${textCls}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-xs font-medium leading-tight ${finding.resolved ? 'line-through text-zinc-500' : 'text-zinc-100'}`}>
            {finding.title}
          </p>
          <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${bgCls} ${textCls}`}>
            {finding.severity}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-zinc-500">
          {finding.filePath}:{finding.startLine}
          <span className="ml-1.5 text-zinc-600">{finding.category}</span>
        </p>
        {finding.resolved && (
          <span className="flex items-center gap-1 text-[9px] text-green-500 mt-0.5">
            <CheckCircle className="h-2.5 w-2.5" /> Resolved
          </span>
        )}
        {finding.falsePositive && !finding.resolved && (
          <span className="text-[9px] text-zinc-600 mt-0.5">False positive</span>
        )}
      </div>
    </button>
  )
}
