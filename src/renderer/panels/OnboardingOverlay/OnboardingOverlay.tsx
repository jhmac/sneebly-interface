import { useState } from 'react'
import { Monitor, MessageSquare, Key, X, ChevronRight, Sparkles } from 'lucide-react'

interface Props {
  onDismiss: () => void
}

const STEPS = [
  {
    icon: Monitor,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/30',
    title: 'Live Preview',
    subtitle: 'Top panel',
    body: 'Sneebly automatically runs your project\'s dev server and embeds it here. When Claude edits a file, the preview hot-reloads within seconds — no Terminal needed.',
    tip: 'Use the device-size buttons (Desktop / Tablet / iPhone) to check responsive layouts.',
  },
  {
    icon: MessageSquare,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10 border-indigo-500/30',
    title: 'Chat + Activity',
    subtitle: 'Bottom panels',
    body: 'Type a message in the bottom-left chat and Claude Code gets to work. The bottom-right Activity panel shows every tool call — file reads, edits, Bash commands — as interactive cards.',
    tip: 'Paste a screenshot directly into the composer. Drag files to attach them. Type / for slash commands.',
  },
  {
    icon: Key,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
    title: 'Secrets & Goals',
    subtitle: 'Workspace header',
    body: 'The Secrets button stores API keys in macOS Keychain — they\'re injected automatically as env vars when the dev server and Claude subprocess start. Goals shows your project roadmap parsed from GOALS.md.',
    tip: 'Secrets never appear in chat history or on disk in plaintext.',
  },
]

export default function OnboardingOverlay({ onDismiss }: Props) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-[480px] rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute right-4 top-4 rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="px-8 pt-8 pb-0">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              Welcome to Sneebly
            </span>
          </div>
          <p className="text-[11px] text-zinc-600">Step {step + 1} of {STEPS.length}</p>
        </div>

        {/* Step content */}
        <div className="px-8 py-6">
          <div className={`mb-5 flex items-center gap-3 rounded-xl border p-4 ${current.bg}`}>
            <Icon className={`h-7 w-7 flex-shrink-0 ${current.color}`} />
            <div>
              <p className={`text-sm font-semibold ${current.color}`}>{current.title}</p>
              <p className="text-[10px] text-zinc-500">{current.subtitle}</p>
            </div>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-zinc-300">{current.body}</p>

          <div className="rounded-lg bg-zinc-800/60 px-4 py-3">
            <p className="text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-300">Tip: </span>
              {current.tip}
            </p>
          </div>
        </div>

        {/* Step dots + navigation */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-8 py-5">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={[
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-6 bg-emerald-400' : 'w-1.5 bg-zinc-700 hover:bg-zinc-600',
                ].join(' ')}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                onClick={onDismiss}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={() => {
                if (isLast) {
                  onDismiss()
                } else {
                  setStep((s) => s + 1)
                }
              }}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              {isLast ? 'Get started' : 'Next'}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
