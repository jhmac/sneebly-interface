import { useState } from 'react'
import { Globe, ExternalLink, Monitor, AlertTriangle, Info, XCircle } from 'lucide-react'
import type { BrowserCheckCard as TBrowserCheckCard } from '../../../../shared/types'
import CardShell from './CardShell'

export default function BrowserCheckCard({ card }: { card: TBrowserCheckCard }) {
  const { url, result, isError } = card

  let displayUrl = url
  try { displayUrl = new URL(url).host + new URL(url).pathname } catch { /* keep full */ }

  const statusColor = isError
    ? 'bg-red-500'
    : !result
    ? 'bg-amber-500 animate-pulse'
    : result.status >= 200 && result.status < 400
    ? 'bg-green-500'
    : 'bg-red-500'

  const statusLabel = isError
    ? 'error'
    : !result
    ? 'loading'
    : String(result.status)

  const summary = result
    ? `${result.title ? `"${result.title}"` : 'no title'} · #root has ${result.rootChildren} children · ${result.consoleMessages.filter(m => m.level === 'error').length} console error(s)`
    : isError
    ? 'Browser check failed'
    : 'Checking…'

  return (
    <CardShell
      ts={card.ts}
      accent="border-violet-600"
      defaultExpanded={Boolean(result && (
        result.consoleMessages.some(m => m.level === 'error') ||
        result.failedRequests.length > 0 ||
        result.cspViolations.length > 0
      ))}
      copyText={result ? JSON.stringify(result, null, 2) : undefined}
      headerContent={
        <>
          <Globe className="h-3 w-3 flex-shrink-0 text-violet-400" />
          <span className="truncate font-mono text-zinc-300">{displayUrl}</span>
          <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white ${statusColor}`}>
            {statusLabel}
          </span>
          {result && (
            <span className="flex-shrink-0 text-[10px] text-zinc-500">
              {result.durationMs}ms
            </span>
          )}
        </>
      }
      expandedContent={result ? <ExpandedView result={result} /> : undefined}
    />
  )
}

function ExpandedView({ result }: { result: TBrowserCheckCard['result'] }) {
  if (!result) return null

  const errors = result.consoleMessages.filter(m => m.level === 'error')
  const warnings = result.consoleMessages.filter(m => m.level === 'warning' || m.level === 'warn')
  const infos = result.consoleMessages.filter(m => m.level !== 'error' && m.level !== 'warning' && m.level !== 'warn')

  return (
    <div className="divide-y divide-zinc-800">
      {/* Screenshot + summary row */}
      <div className="flex gap-3 p-3">
        {result.screenshotPath && (
          <button
            onClick={() => window.api.shellOpenExternal(`file://${result.screenshotPath}`)}
            className="flex-shrink-0 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
            title="Open full screenshot"
          >
            <img
              src={`file://${result.screenshotPath}`}
              alt="Screenshot"
              className="h-20 w-32 rounded object-cover"
            />
          </button>
        )}
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <Monitor className="h-3 w-3 text-zinc-500" />
            <span className="text-zinc-400">{result.title || '(no title)'}</span>
          </div>
          <div className="text-zinc-600">
            <span className="text-zinc-500">background:</span> {result.bodyBackground}
          </div>
          <div className="text-zinc-600">
            <span className="text-zinc-500">#root children:</span>{' '}
            <span className={result.rootChildren === 0 ? 'text-amber-400' : 'text-green-400'}>
              {result.rootChildren}
            </span>
          </div>
          {result.screenshotPath && (
            <button
              onClick={() => window.api.shellOpenExternal(`file://${result.screenshotPath}`)}
              className="mt-1 flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Open screenshot
            </button>
          )}
        </div>
      </div>

      {/* Console errors */}
      {errors.length > 0 && (
        <ConsoleSection
          icon={<XCircle className="h-3 w-3 text-red-400" />}
          label={`${errors.length} console error${errors.length === 1 ? '' : 's'}`}
          messages={errors}
          defaultOpen
          rowClass="text-red-300"
        />
      )}

      {/* CSP violations */}
      {result.cspViolations.length > 0 && (
        <div className="p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            CSP violations
          </p>
          {result.cspViolations.map((v, i) => (
            <div key={i} className="font-mono text-[11px] text-amber-300">
              {v.violatedDirective} — {v.blockedURI || '(inline)'}
            </div>
          ))}
        </div>
      )}

      {/* Failed requests */}
      {result.failedRequests.length > 0 && (
        <div className="p-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-red-400">
            {result.failedRequests.length} failed request{result.failedRequests.length === 1 ? '' : 's'}
          </p>
          {result.failedRequests.map((r, i) => (
            <div key={i} className="truncate font-mono text-[11px] text-red-300">
              {r.url} — {r.errorText}
            </div>
          ))}
        </div>
      )}

      {/* Console warnings */}
      {warnings.length > 0 && (
        <ConsoleSection
          icon={<AlertTriangle className="h-3 w-3 text-amber-400" />}
          label={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
          messages={warnings}
          defaultOpen={false}
          rowClass="text-amber-300"
        />
      )}

      {/* Console info */}
      {infos.length > 0 && (
        <ConsoleSection
          icon={<Info className="h-3 w-3 text-zinc-500" />}
          label={`${infos.length} log${infos.length === 1 ? '' : 's'}`}
          messages={infos}
          defaultOpen={false}
          rowClass="text-zinc-400"
        />
      )}
    </div>
  )
}

function ConsoleSection({
  icon,
  label,
  messages,
  defaultOpen,
  rowClass,
}: {
  icon: React.ReactNode
  label: string
  messages: Array<{ level: string; text: string; url?: string; line?: number }>
  defaultOpen: boolean
  rowClass: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {icon}
        {label}
        <span className="text-zinc-700">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {messages.slice(0, 20).map((m, i) => (
            <div key={i} className={`truncate font-mono text-[11px] ${rowClass}`}>
              {m.text}
            </div>
          ))}
          {messages.length > 20 && (
            <div className="text-[10px] text-zinc-600">+{messages.length - 20} more</div>
          )}
        </div>
      )}
    </div>
  )
}
