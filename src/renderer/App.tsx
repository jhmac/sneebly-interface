import { useEffect, useState } from 'react'
import type { PongPayload } from '../shared/types'

export default function App() {
  const [pong, setPong] = useState<PongPayload | null>(null)

  useEffect(() => {
    window.api.ping().then(setPong)
  }, [])

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Hello, Sneebly
        </h1>
        {pong ? (
          <p className="mt-4 text-sm text-zinc-400">
            IPC ping →{' '}
            <span className="font-mono text-emerald-400">{pong.message}</span>
          </p>
        ) : (
          <p className="mt-4 text-sm text-zinc-600">waiting for IPC…</p>
        )}
      </div>
    </div>
  )
}
