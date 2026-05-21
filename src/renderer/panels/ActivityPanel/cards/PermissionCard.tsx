import { ShieldAlert } from 'lucide-react'
import type { PermissionCard as TPermissionCard } from '../../../../shared/types'
import { useActivityStore } from '../../../state/activityStore'
import CardShell from './CardShell'

export default function PermissionCard({ card }: { card: TPermissionCard }) {
  const respondToPermission = useActivityStore((s) => s.respondToPermission)
  const decided = Boolean(card.decision)

  return (
    <CardShell
      ts={card.ts}
      accent="border-yellow-600"
      defaultExpanded={!decided}
      headerContent={
        <>
          <ShieldAlert className="h-3 w-3 flex-shrink-0 text-yellow-500" />
          <span className="text-yellow-400">Permission needed</span>
          <code className="ml-1 font-mono text-zinc-300">{card.toolName}</code>
          {card.decision && (
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${
              card.decision === 'allow' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
            }`}>
              {card.decision === 'allow' ? 'Allowed' : 'Denied'}
            </span>
          )}
        </>
      }
      expandedContent={
        !decided ? (
          <div className="p-3 space-y-3">
            <pre className="rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
              {JSON.stringify(card.input, null, 2)}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => respondToPermission(card.requestId, 'allow')}
                className="rounded-md bg-green-800 px-3 py-1.5 text-xs text-green-100 hover:bg-green-700"
              >
                Allow
              </button>
              <button
                onClick={() => respondToPermission(card.requestId, 'deny')}
                className="rounded-md bg-red-900 px-3 py-1.5 text-xs text-red-200 hover:bg-red-800"
              >
                Deny
              </button>
            </div>
          </div>
        ) : undefined
      }
    />
  )
}
