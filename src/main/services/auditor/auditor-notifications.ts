import { Notification, app } from 'electron'
import type { AuditStatus } from '../../../shared/types'

// ─── System notification ──────────────────────────────────────────────────────

export function notifyAuditComplete(
  projectName: string,
  status: AuditStatus,
  findingCount: number,
  criticalCount: number,
): void {
  if (!Notification.isSupported()) return

  const title = status === 'completed'
    ? '✓ Sneebly Audit complete'
    : status === 'canceled'
    ? 'Sneebly Audit canceled'
    : '⚠ Sneebly Audit failed'

  let body: string
  if (status === 'completed') {
    body = criticalCount > 0
      ? `${projectName} — ${findingCount} findings (${criticalCount} critical)`
      : `${projectName} — ${findingCount} findings`
  } else {
    body = projectName
  }

  const n = new Notification({ title, body, silent: true })
  n.show()
}

export function notifyCostCapReached(projectName: string, spentUsd: number, ceilingUsd: number): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: 'Audit paused: cost cap reached',
    body: `${projectName} — spent $${spentUsd.toFixed(2)} of $${ceilingUsd} ceiling. Review needed.`,
    silent: true,
  })
  n.show()
}

export function notifyRateLimitPause(projectName: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: 'Audit paused: rate limit',
    body: `${projectName} — resuming automatically`,
    silent: true,
  })
  n.show()
}

// ─── Dock badge ───────────────────────────────────────────────────────────────

export function setDockBadge(text: string): void {
  if (process.platform !== 'darwin') return
  app.dock?.setBadge(text)
}

export function clearDockBadge(): void {
  if (process.platform !== 'darwin') return
  app.dock?.setBadge('')
}
