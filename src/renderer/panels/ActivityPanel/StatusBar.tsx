import { useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import { useActivityStore } from '../../state/activityStore'
import type { ModelName } from '../../../shared/types'

const RATES: Record<ModelName, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3,    output: 15  },
  'claude-opus-4-7':   { input: 15,   output: 75  },
  'claude-haiku-4-5':  { input: 0.80, output: 4   },
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function StatusBar({ model }: { model: ModelName }) {
  const { currentTurn, abortTurn } = useActivityStore()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!currentTurn?.active) { setElapsed(0); return }
    const id = setInterval(() => {
      setElapsed(Date.now() - currentTurn.startedAt)
    }, 1000)
    return () => clearInterval(id)
  }, [currentTurn?.active, currentTurn?.startedAt])

  const rates = RATES[model] ?? RATES['claude-sonnet-4-6']
  const costEstimate = currentTurn
    ? (currentTurn.tokensIn / 1e6 * rates.input) + (currentTurn.tokensOut / 1e6 * rates.output)
    : 0
  const displayCost = currentTurn?.costUsd ?? costEstimate

  return (
    <div className="flex h-8 flex-shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-3 text-[11px] text-zinc-500">
      {/* Activity label */}
      <span className="min-w-0 flex-1 truncate">
        {currentTurn?.currentActivity ?? 'Idle'}
      </span>

      {/* Elapsed */}
      {currentTurn?.active && (
        <span className="flex-shrink-0 tabular-nums text-zinc-400">
          {formatElapsed(elapsed)}
        </span>
      )}

      {/* Tokens */}
      {currentTurn && (currentTurn.tokensIn > 0 || currentTurn.tokensOut > 0) && (
        <span className="flex-shrink-0 tabular-nums">
          {(currentTurn.tokensIn / 1000).toFixed(1)}k↑ {(currentTurn.tokensOut / 1000).toFixed(1)}k↓
        </span>
      )}

      {/* Cost */}
      {displayCost > 0 && (
        <span className="flex-shrink-0 tabular-nums">{formatCost(displayCost)}</span>
      )}

      {/* Stop button */}
      <button
        onClick={abortTurn}
        disabled={!currentTurn?.active}
        title="Stop"
        className="flex-shrink-0 rounded p-0.5 text-red-600 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-20"
      >
        <Square className="h-3 w-3" />
      </button>
    </div>
  )
}
