import Store from 'electron-store'
import { agentBus } from './agent-bus'
import { runAuditDecider } from './decider-orchestrator'
import { sendToProjectWindows } from './window-registry'
import { IPC_CHANNELS } from '../../shared/ipc-channels'

const store = new Store()

let initialized = false

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Subscribe to review:done events on the agent bus.
 * When both deciderEnabled and deciderAutoFire are on, triggers an audit Decider
 * run after each review completion so decisions are captured alongside the verdict.
 * deciderEnabled is checked here as a fast short-circuit; runAuditDecider also
 * re-checks it internally for defence-in-depth.
 *
 * Idempotent — safe to call multiple times; the listener is registered only once.
 * Call once from main process startup (registerDeciderHandlers).
 */
export function initDeciderReviewBridge(): void {
  if (initialized) return
  initialized = true

  agentBus.on('review:done', (projectId, milestoneId) => {
    const s = store.get('appSettings', {}) as Record<string, unknown>
    const enabled = (s['deciderEnabled'] as boolean | undefined) ?? true
    const autoFire = (s['deciderAutoFire'] as boolean | undefined) ?? false

    if (!enabled || !autoFire) return

    // Fire-and-forget audit run — never blocks the review agent's own callback chain.
    runAuditDecider(projectId, milestoneId)
      .then((result) => {
        if (result) {
          sendToProjectWindows(
            projectId,
            IPC_CHANNELS.DECIDER_DECISIONS_UPDATED,
            projectId,
          )
        }
      })
      .catch((err) => {
        console.warn('[decider-review-bridge] audit run failed:', err)
      })
  })
}
