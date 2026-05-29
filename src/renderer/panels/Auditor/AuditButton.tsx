import { Shield, ShieldCheck, ShieldAlert, Loader } from 'lucide-react'
import { useAuditorStore } from '../../state/auditorStore'

interface Props {
  projectId: string | null
}

export default function AuditButton({ projectId }: Props) {
  const { runningAuditId, activeProgress, openConfig } = useAuditorStore()

  if (!projectId) return null

  const isRunning = runningAuditId !== null
  const pct = activeProgress && activeProgress.totalFiles > 0
    ? Math.round((activeProgress.totalProcessed / activeProgress.totalFiles) * 100)
    : null

  const criticalCount = activeProgress?.bySeverity.critical ?? 0

  return (
    <button
      onClick={openConfig}
      title={isRunning ? `Audit running… ${pct !== null ? pct + '%' : ''}` : 'Run audit'}
      className={[
        'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
        isRunning
          ? 'bg-indigo-900/40 text-indigo-300'
          : criticalCount > 0
          ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
          : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
      ].join(' ')}
    >
      {isRunning ? (
        <Loader className="h-3 w-3 animate-spin" />
      ) : criticalCount > 0 ? (
        <ShieldAlert className="h-3 w-3" />
      ) : (
        <Shield className="h-3 w-3" />
      )}
      Audit
      {isRunning && pct !== null && (
        <span className="text-[10px] text-indigo-400">{pct}%</span>
      )}
      {!isRunning && criticalCount > 0 && (
        <span className="rounded-full bg-red-700 px-1 text-[9px] font-semibold text-red-100">
          {criticalCount}
        </span>
      )}
    </button>
  )
}
