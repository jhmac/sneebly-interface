import type { AuditMode } from '../../../shared/types'

interface Props {
  mode: AuditMode
  onChange: (mode: AuditMode) => void
  lastAuditDate?: string
}

const MODES: Array<{ value: AuditMode; label: string; description: string }> = [
  { value: 'full', label: 'Full', description: 'Audit every in-scope file' },
  { value: 'incremental', label: 'Incremental', description: 'Only files changed since last audit' },
  { value: 'subset', label: 'Subset', description: 'Pick specific files or directories' },
  { value: 'dry-run', label: 'Dry Run', description: 'Show what would be audited — no LLM calls' },
]

export default function AuditModePicker({ mode, onChange, lastAuditDate }: Props) {
  return (
    <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
      {MODES.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          title={m.description}
          className={[
            'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            mode === m.value
              ? 'bg-zinc-700 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300',
          ].join(' ')}
        >
          {m.label}
          {m.value === 'incremental' && lastAuditDate && (
            <span className="ml-1 text-[9px] text-zinc-600">since {lastAuditDate}</span>
          )}
        </button>
      ))}
    </div>
  )
}
