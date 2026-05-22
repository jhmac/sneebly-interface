import { useEffect, useState } from 'react'
import { X, GitBranch, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import type { GitHubUser } from '../../../shared/types'

type Phase = 'idle' | 'waiting-user' | 'polling' | 'connected' | 'error'

interface Props {
  onClose: () => void
  onConnected?: (user: GitHubUser) => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-300 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy code'}
    </button>
  )
}

export default function GitHubConnectModal({ onClose, onConnected }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [userCode, setUserCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [connectedUser, setConnectedUser] = useState<GitHubUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startAuth() {
    setPhase('waiting-user')
    setError(null)

    // Subscribe to the user-code push event BEFORE calling startOAuth
    const unsub = window.api.githubOnUserCode(({ code, verificationUri: uri }) => {
      setUserCode(code)
      setVerificationUri(uri)
      setPhase('polling')
    })

    try {
      const result = await window.api.githubStartOAuth()
      unsub()
      if (result.success && result.user) {
        setConnectedUser(result.user)
        setPhase('connected')
        onConnected?.(result.user)
      } else {
        setError(result.error ?? 'Authorization failed')
        setPhase('error')
      }
    } catch (err) {
      unsub()
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  function reopenBrowser() {
    if (verificationUri) window.api.shellOpenExternal(verificationUri)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[420px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Connect to GitHub</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col items-center gap-5 px-8 py-8 text-center">
          {phase === 'idle' && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
                <GitBranch className="h-8 w-8 text-zinc-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Connect to GitHub</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Sneebly will be able to read and clone your repositories.
                </p>
              </div>
              <button
                onClick={startAuth}
                className="rounded-lg bg-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
              >
                Continue
              </button>
            </>
          )}

          {(phase === 'waiting-user' || phase === 'polling') && (
            <>
              <Loader className="h-8 w-8 animate-spin text-zinc-500" />
              {userCode ? (
                <>
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-xs text-zinc-500">
                      Enter this code at{' '}
                      <button
                        onClick={reopenBrowser}
                        className="text-indigo-400 underline hover:text-indigo-300"
                      >
                        github.com/login/device
                      </button>
                    </p>
                    <div className="mt-2 rounded-lg bg-zinc-800 px-6 py-3">
                      <p className="font-mono text-2xl font-bold tracking-[0.2em] text-zinc-100">
                        {userCode}
                      </p>
                    </div>
                    <CopyButton text={userCode} />
                  </div>
                  <p className="text-xs text-zinc-600">Waiting for you to authorize…</p>
                  <button
                    onClick={reopenBrowser}
                    className="text-xs text-indigo-400 underline hover:text-indigo-300"
                  >
                    Open browser again
                  </button>
                </>
              ) : (
                <p className="text-xs text-zinc-500">Opening GitHub…</p>
              )}
            </>
          )}

          {phase === 'connected' && connectedUser && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <div className="flex flex-col items-center gap-2">
                {connectedUser.avatarUrl && (
                  <img
                    src={connectedUser.avatarUrl}
                    alt={connectedUser.login}
                    className="h-12 w-12 rounded-full border border-zinc-700"
                  />
                )}
                <p className="text-sm font-medium text-zinc-200">
                  Connected as{' '}
                  <span className="font-mono text-zinc-100">@{connectedUser.login}</span>
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
              >
                Done
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <AlertCircle className="h-10 w-10 text-red-500" />
              <div>
                <p className="text-sm font-medium text-zinc-200">Authorization failed</p>
                {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPhase('idle'); setError(null) }}
                  className="rounded-lg bg-zinc-700 px-4 py-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
                >
                  Try again
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
