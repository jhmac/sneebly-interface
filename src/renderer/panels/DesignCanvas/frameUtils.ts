// ─── Shared layout constants ──────────────────────────────────────────────────
// Imported by both DesignFrame and SeedFrame so they stay in sync.

import { FRAME_HEIGHT } from '../../state/designStore'

export const HEADER_H = 40
export const FOOTER_H = 28
/** Usable body height = frame total minus header, footer, and 2px of borders. */
export const BODY_H = FRAME_HEIGHT - HEADER_H - FOOTER_H - 2

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function formatTimeAgo(ts: number): string {
  if (!ts) return ''
  const diffSec = Math.floor((Date.now() - ts) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}
