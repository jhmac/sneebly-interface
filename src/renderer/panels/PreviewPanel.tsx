import { useRef, useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Monitor,
  Tablet,
  Smartphone,
  RotateCcw,
  Bug,
  Wand2,
  Loader2,
} from 'lucide-react'
import { usePreviewStore } from '../state/previewStore'
import { useProjectStore } from '../state/projectStore'
import { useChatStore } from '../state/chatStore'
import { useActivityStore } from '../state/activityStore'
import type { DeviceSize } from '../../shared/types'
import { buildSetupPrompt } from '../../shared/setup-prompt'

const DEVICE_WIDTHS: Record<DeviceSize, string> = {
  desktop: '100%',
  tablet: '768px',
  iphone: '390px',
}

export default function PreviewPanel() {
  const webviewRef = useRef<ElectronWebviewElement | null>(null)
  const [urlBar, setUrlBar] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const {
    status, url, stderrTail, deviceSize, logsExpanded, settingUp,
    setDeviceSize, setLogsExpanded, setAwaitingSetupComplete, setSettingUp,
    setWebContentsId,
  } = usePreviewStore()
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const { activeSessionId, defaultModel } = useChatStore()

  // Sync URL bar from store URL when dev server first starts
  useEffect(() => {
    if (url) setUrlBar(url)
  }, [url])

  // Attach webview event listeners when it mounts
  const attachWebviewListeners = useCallback((el: ElectronWebviewElement | null) => {
    if (!el) {
      setWebContentsId(null)
      return
    }
    webviewRef.current = el

    const onNavigate = (e: Event & { url?: string }) => {
      const navUrl = (e as unknown as { url: string }).url
      if (navUrl) setUrlBar(navUrl)
      setCanGoBack(el.canGoBack())
      setCanGoForward(el.canGoForward())
    }

    el.addEventListener('did-navigate', onNavigate as EventListener)
    el.addEventListener('did-navigate-in-page', onNavigate as EventListener)
    el.addEventListener('did-finish-load', () => {
      setUrlBar(el.getURL())
      setCanGoBack(el.canGoBack())
      setCanGoForward(el.canGoForward())
    })
    el.addEventListener('dom-ready', () => {
      el.setZoomFactor(1.0)
      // getWebContentsId() may only be called after dom-ready; calling it earlier
      // (e.g. in the ref callback on mount) throws and crashes the React tree.
      setWebContentsId(el.getWebContentsId())
    })
  }, [])

  function handleUrlSubmit(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const target = urlBar.startsWith('http') ? urlBar : `http://${urlBar}`
    webviewRef.current?.loadURL(target)
  }

  function handleRestart() {
    if (!activeProject) return
    window.api.previewRestart(activeProject.id, activeProject.path)
  }

  const deviceWidth = DEVICE_WIDTHS[deviceSize]

  function handleSetup() {
    if (!activeProject || !activeSessionId || settingUp) return
    const prompt = buildSetupPrompt(activeProject.name)
    window.api.chatSend(
      activeProject.path,
      activeSessionId,
      { id: crypto.randomUUID(), role: 'user', text: prompt, ts: Date.now() },
      defaultModel,
      activeProject.id
    )
    setSettingUp(true)
    setAwaitingSetupComplete(true)
  }

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      {/* Toolbar */}
      <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-2">
        {/* Navigation */}
        <button
          onClick={() => webviewRef.current?.goBack()}
          disabled={!canGoBack}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          disabled={!canGoForward}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => webviewRef.current?.reload()}
          disabled={status !== 'running'}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        {/* URL bar */}
        <input
          type="text"
          value={urlBar}
          onChange={(e) => setUrlBar(e.target.value)}
          onKeyDown={handleUrlSubmit}
          placeholder="No dev server running"
          className="mx-1 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
        />

        {/* Device size */}
        <div className="flex items-center rounded bg-zinc-800">
          {(
            [
              { size: 'desktop', Icon: Monitor },
              { size: 'tablet', Icon: Tablet },
              { size: 'iphone', Icon: Smartphone },
            ] as const
          ).map(({ size, Icon }) => (
            <button
              key={size}
              onClick={() => setDeviceSize(size)}
              title={size === 'desktop' ? 'Desktop' : size === 'tablet' ? 'Tablet (768px)' : 'iPhone (390px)'}
              className={[
                'rounded px-1.5 py-1 transition-colors',
                deviceSize === size ? 'text-zinc-200' : 'text-zinc-600 hover:text-zinc-400',
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        {/* Open in Chrome */}
        <button
          onClick={() => url && window.api.shellOpenExternal(url)}
          disabled={!url}
          title="Open in browser"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>

        {/* Webview DevTools */}
        <button
          onClick={() => webviewRef.current?.openDevTools()}
          title="Open webview DevTools"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Bug className="h-3.5 w-3.5" />
        </button>

        {/* Status pill */}
        <StatusPill status={status} />

        {/* Logs toggle */}
        <button
          onClick={() => setLogsExpanded(!logsExpanded)}
          title="Toggle logs"
          className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
        >
          {logsExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Main content area */}
      <div className="relative flex-1 overflow-hidden">
        {status === 'running' && url ? (
          <div className="relative h-full overflow-hidden bg-zinc-800">
            <webview
              key={url}
              ref={attachWebviewListeners as unknown as React.Ref<HTMLElement>}
              src={url}
              allowpopups={true}
              style={
                deviceSize === 'desktop'
                  ? {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      background: '#fff',
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: deviceWidth,
                      height: '100%',
                      display: 'flex',
                      background: '#fff',
                    }
              }
            />
          </div>
        ) : settingUp ? (
          <SetupOverlay />
        ) : status === 'crashed' ? (
          <CrashedOverlay
            stderrTail={stderrTail}
            onRestart={handleRestart}
            onSetup={handleSetup}
            canSetup={Boolean(activeProject && activeSessionId)}
          />
        ) : status === 'no-script' ? (
          <NoScriptOverlay
            onSetup={handleSetup}
            canSetup={Boolean(activeProject && activeSessionId)}
          />
        ) : (
          <WaitingOverlay status={status} />
        )}
      </div>

      {/* Logs drawer */}
      {logsExpanded && activeProjectId && (
        <LogsDrawer projectId={activeProjectId} />
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const configs: Record<string, { dot: string; label: string }> = {
    running:   { dot: 'bg-green-500',  label: 'Running'    },
    starting:  { dot: 'bg-amber-500 animate-pulse', label: 'Starting' },
    crashed:   { dot: 'bg-red-500',    label: 'Crashed'    },
    stopped:   { dot: 'bg-zinc-500',   label: 'Stopped'    },
    'no-script': { dot: 'bg-slate-500', label: 'No script' },
    idle:      { dot: 'bg-zinc-700',   label: 'Idle'       },
  }
  const cfg = configs[status] ?? configs.idle
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-0.5">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      <span className="text-[10px] text-zinc-400">{cfg.label}</span>
    </div>
  )
}

function WaitingOverlay({ status }: { status: string }) {
  const msg =
    status === 'starting' ? 'Starting dev server…' :
    status === 'stopped'  ? 'Dev server stopped' :
                            'No project open'
  return (
    <div className="flex h-full items-center justify-center">
      <span className="text-sm text-zinc-600">{msg}</span>
    </div>
  )
}

function SetupButton({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void
  disabled: boolean
  loading: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-4 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-[0_0_12px_theme(colors.indigo.700/50%)] transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Wand2 className="h-4 w-4" />
      )}
      {loading ? 'Setting up…' : 'Set up local environment'}
    </button>
  )
}

function SetupOverlay() {
  const { cards } = useActivityStore()
  const recent = cards.filter((c) => c.cardType === 'bash' || c.cardType === 'read' || c.cardType === 'summary').slice(-2)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      <p className="text-sm font-medium text-zinc-300">Sneebly is setting up your project…</p>
      {recent.length > 0 && (
        <div className="w-full max-w-sm space-y-1">
          {recent.map((c) => {
            const label =
              c.cardType === 'bash'
                ? (c as import('../../shared/types').BashCard).command
                : c.cardType === 'read'
                ? (c as import('../../shared/types').ReadCard).filePath.split('/').pop()
                : (c as import('../../shared/types').SummaryCard).text.slice(0, 60)
            return (
              <p key={c.id} className="truncate text-center text-xs text-zinc-600">
                {label}
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CrashedOverlay({
  stderrTail,
  onRestart,
  onSetup,
  canSetup,
}: {
  stderrTail: string[]
  onRestart: () => void
  onSetup: () => void
  canSetup: boolean
}) {
  const { settingUp } = usePreviewStore()
  const lines = stderrTail.slice(-10)
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col items-center rounded-lg border border-red-900 bg-zinc-900 p-4">
        <div className="mb-3 flex w-full items-center justify-between">
          <span className="text-sm font-medium text-red-400">Dev server crashed</span>
          <button
            onClick={onRestart}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </button>
        </div>
        {lines.length > 0 && (
          <pre className="mb-2 w-full max-h-48 overflow-y-auto rounded bg-zinc-950 p-3 text-[11px] leading-relaxed text-red-300">
            {lines.join('\n')}
          </pre>
        )}
        <SetupButton onClick={onSetup} disabled={!canSetup} loading={settingUp} />
      </div>
    </div>
  )
}

function NoScriptOverlay({
  onSetup,
  canSetup,
}: {
  onSetup: () => void
  canSetup: boolean
}) {
  const { settingUp } = usePreviewStore()
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900 p-5 text-center">
        <p className="mb-1 text-sm font-medium text-zinc-300">No dev script detected</p>
        <p className="text-xs text-zinc-500">
          This project has no <code className="text-zinc-400">scripts.dev</code> or{' '}
          <code className="text-zinc-400">scripts.start</code> in{' '}
          <code className="text-zinc-400">package.json</code>. Add one and reload the
          project to enable the live preview.
        </p>
        <SetupButton onClick={onSetup} disabled={!canSetup} loading={settingUp} />
      </div>
    </div>
  )
}

function LogsDrawer({ projectId }: { projectId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<string[]>([])

  // Fetch logs on mount and refresh every 1.5s while open
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const logs = await window.api.previewGetLogs(projectId)
      if (!cancelled) setLines(logs)
    }
    load()
    const id = setInterval(load, 1500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [projectId])

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="h-36 flex-shrink-0 border-t border-zinc-800 bg-zinc-950">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-zinc-400"
      >
        {lines.length === 0 ? (
          <span className="text-zinc-700">No log output yet.</span>
        ) : (
          lines.map((line, i) => <div key={i}>{line || ' '}</div>)
        )}
      </div>
    </div>
  )
}
