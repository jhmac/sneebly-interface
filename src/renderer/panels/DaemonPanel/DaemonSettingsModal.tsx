import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useDaemonStore } from '../../state/daemonStore'
import type { DaemonProjectConfig } from '../../../shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS: { label: string; value: number }[] = [
  { label: 'Low', value: 0.5 },
  { label: 'Normal', value: 1.0 },
  { label: 'High', value: 2.0 },
  { label: 'Highest', value: 4.0 },
]

const SCHEDULE_OPTIONS: DaemonProjectConfig['schedule'][] = [
  'manual', 'hourly', 'nightly', 'continuous',
]

function weightToLabel(w: number): string {
  return PRIORITY_OPTIONS.find((o) => o.value === w)?.label ?? 'Normal'
}

// ── Toggle component ───────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors',
        checked ? 'bg-indigo-600' : 'bg-zinc-700',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-200 shadow-xl">
      {message}
    </div>
  )
}

// ── Per-project row ────────────────────────────────────────────────────────

function ProjectRow({
  projectId,
  projectName,
  cycleActive,
}: {
  projectId: string
  projectName: string
  cycleActive: boolean
}) {
  const [config, setConfig] = useState<DaemonProjectConfig | null>(null)
  const [running, setRunning] = useState<'idle' | 'cycling' | 'dryrun'>('idle')

  useEffect(() => {
    window.api.daemonGetProjectConfig(projectId).then(setConfig)
  }, [projectId])

  async function update(patch: Partial<DaemonProjectConfig>) {
    if (!config) return
    const next = { ...config, ...patch }
    setConfig(next)
    await window.api.daemonSetProjectConfig(projectId, patch)
    useDaemonStore.getState().refreshStatus()
  }

  async function runNow(dryRun: boolean) {
    setRunning(dryRun ? 'dryrun' : 'cycling')
    try {
      await window.api.daemonRunNow(projectId, { dryRun })
    } finally {
      setRunning('idle')
      useDaemonStore.getState().refreshStatus()
    }
  }

  if (!config) return null

  const busyTooltip = cycleActive ? 'Wait for current cycle to finish' : undefined

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{projectName}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Enabled</span>
          <Toggle
            checked={config.enabled}
            onChange={(v) => update({ enabled: v })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Schedule
          <select
            value={config.schedule}
            onChange={(e) => update({ schedule: e.target.value as DaemonProjectConfig['schedule'] })}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {SCHEDULE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Priority
          <select
            value={config.weight}
            onChange={(e) => update({ weight: parseFloat(e.target.value) })}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-1.5 ml-auto">
          <button
            onClick={() => runNow(false)}
            disabled={cycleActive || running !== 'idle'}
            title={busyTooltip}
            className="rounded bg-indigo-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === 'cycling' ? 'Running…' : 'Run cycle now'}
          </button>
          <button
            onClick={() => runNow(true)}
            disabled={cycleActive || running !== 'idle'}
            title={busyTooltip}
            className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === 'dryrun' ? 'Running…' : 'Dry run'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────

export default function DaemonSettingsModal({ onClose }: { onClose: () => void }) {
  const { projects } = useProjectStore()
  const { status, refreshStatus } = useDaemonStore()

  const [experimental, setExperimental] = useState(false)
  const [daemonEnabled, setDaemonEnabled] = useState(false)
  const [showInMenuBar, setShowInMenuBar] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Load persisted global flags from localStorage
  useEffect(() => {
    try {
      setExperimental(localStorage.getItem('daemon.experimental') === 'true')
      setDaemonEnabled(status?.running ?? false)
      setShowInMenuBar(localStorage.getItem('daemon.showInMenuBar') === 'true')
    } catch { /* ignore */ }
  }, [status?.running])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleExperimentalToggle(v: boolean) {
    setExperimental(v)
    try { localStorage.setItem('daemon.experimental', String(v)) } catch { /* ignore */ }
    if (!v && status?.running) {
      await window.api.daemonStop()
      setDaemonEnabled(false)
      await refreshStatus()
      showToast('Daemon stopped (experimental mode disabled).')
    }
  }

  async function handleDaemonToggle(v: boolean) {
    setDaemonEnabled(v)
    if (v) {
      await window.api.daemonStart()
    } else {
      await window.api.daemonStop()
    }
    await refreshStatus()
  }

  function handleMenuBarToggle(v: boolean) {
    setShowInMenuBar(v)
    try { localStorage.setItem('daemon.showInMenuBar', String(v)) } catch { /* ignore */ }
    // Also persist to electron-store via a settings IPC so main process can read it
    window.api.daemonSetRunAfterQuit(v)
  }

  const cycleActive = status?.activeCycle !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[640px] max-h-[90vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Daemon Settings</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* Global controls */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Global</h3>

            <SettingRow
              label="Experimental mode"
              subtitle="Required to enable autonomous cycles. Read the safety notes first."
            >
              <Toggle checked={experimental} onChange={handleExperimentalToggle} />
            </SettingRow>

            <SettingRow
              label="Daemon enabled"
              subtitle={!experimental ? 'Enable experimental mode first.' : undefined}
            >
              <Toggle
                checked={daemonEnabled}
                onChange={handleDaemonToggle}
                disabled={!experimental}
              />
            </SettingRow>

            <SettingRow
              label="Show in menu bar when window closed"
              subtitle={
                !daemonEnabled
                  ? 'Enable daemon first.'
                  : 'Adds an icon to the macOS menu bar so daemon status is visible when the main window is closed.'
              }
            >
              <Toggle
                checked={showInMenuBar}
                onChange={handleMenuBarToggle}
                disabled={!daemonEnabled}
              />
            </SettingRow>
          </section>

          {/* Per-project */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Projects</h3>
            {projects.length === 0 ? (
              <p className="text-xs text-zinc-600">No projects registered.</p>
            ) : (
              projects.map((p) => (
                <ProjectRow
                  key={p.id}
                  projectId={p.id}
                  projectName={p.name}
                  cycleActive={cycleActive}
                />
              ))
            )}
          </section>
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  )
}

function SettingRow({
  label,
  subtitle,
  children,
}: {
  label: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm text-zinc-200">{label}</p>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      <div className="flex-shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
