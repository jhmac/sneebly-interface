import { ShieldCheck, CheckCircle } from 'lucide-react'

interface Props {
  // true when there ARE findings but none survive the current filter/search
  hasFindings: boolean
  // true when findings exist and ALL of them are resolved
  allResolved?: boolean
}

export default function AuditEmptyState({ hasFindings, allResolved }: Props) {
  if (hasFindings && allResolved) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/30">
          <CheckCircle className="h-5 w-5 text-green-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-200">All findings resolved</p>
          <p className="mt-1 text-xs text-zinc-500">
            Toggle "Show resolved" to review them again.
          </p>
        </div>
      </div>
    )
  }

  if (hasFindings) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-xs text-zinc-500">No findings match the current filters.</p>
        <p className="text-[10px] text-zinc-600">Try clearing the severity filter or search.</p>
      </div>
    )
  }

  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/30">
        <ShieldCheck className="h-5 w-5 text-green-500" />
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-200">Clean audit</p>
        <p className="mt-1 text-xs text-zinc-500">Zero findings across all reviewed files.</p>
      </div>
    </div>
  )
}
