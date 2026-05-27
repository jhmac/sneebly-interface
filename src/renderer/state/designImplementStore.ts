import { create } from 'zustand'
import type { AgentEvent, DesignImplementStatusEvent } from '../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImplementStatus = 'idle' | 'running' | 'success' | 'error'

export interface ImplementState {
  implementId: string | null
  status: ImplementStatus
  events: AgentEvent[]
  error: string | null
}

interface DesignImplementStore {
  current: ImplementState

  /** Called from App.tsx's push channel listener */
  handleStatusEvent: (event: DesignImplementStatusEvent) => void
  /** Called when the user confirms a frame to implement */
  startPending: (implementId: string) => void
  /** Called when the user dismisses the progress panel */
  reset: () => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

const IDLE: ImplementState = {
  implementId: null,
  status: 'idle',
  events: [],
  error: null,
}

export const useDesignImplementStore = create<DesignImplementStore>((set) => ({
  current: { ...IDLE },

  handleStatusEvent: (event) =>
    set((s) => {
      if (s.current.implementId !== event.implementId) return {}
      if (event.status === 'running' && event.event) {
        return { current: { ...s.current, events: [...s.current.events, event.event] } }
      }
      if (event.status === 'success') {
        return { current: { ...s.current, status: 'success' } }
      }
      if (event.status === 'error') {
        return { current: { ...s.current, status: 'error', error: event.error ?? 'Unknown error' } }
      }
      return {}
    }),

  startPending: (implementId) =>
    set({ current: { implementId, status: 'running', events: [], error: null } }),

  reset: () => set({ current: { ...IDLE } }),
}))
