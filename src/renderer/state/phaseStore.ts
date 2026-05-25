import { create } from 'zustand'
import type { PhasePlan, PhaseRunConfig, PhaseRunState } from '../../shared/types'

interface PhaseState {
  plan: PhasePlan | null
  runState: PhaseRunState
  generating: boolean
  loadError: string | null

  load: (projectId: string) => Promise<void>
  generate: (projectId: string) => Promise<void>
  completeMilestone: (projectId: string, milestoneId: string) => Promise<void>
  startRun: (projectId: string, config: PhaseRunConfig) => Promise<void>
  stopRun: (projectId: string) => Promise<void>
  refreshRunState: (projectId: string) => Promise<void>
  setRunState: (state: PhaseRunState) => void
}

const idleRunState: PhaseRunState = {
  status: 'idle',
  currentMilestoneId: null,
  completedInBatch: 0,
  batchSize: 0,
  activeChecklist: [],
  lastError: null,
}

export const usePhaseStore = create<PhaseState>((set, get) => ({
  plan: null,
  runState: idleRunState,
  generating: false,
  loadError: null,

  load: async (projectId) => {
    try {
      const plan = await window.api.phasePlanGet(projectId)
      const runState = await window.api.phaseRunState(projectId)
      set({ plan, runState, loadError: null })
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) })
    }
  },

  generate: async (projectId) => {
    set({ generating: true, loadError: null })
    try {
      const plan = await window.api.phasePlanGenerate(projectId)
      set({ plan, generating: false })
    } catch (e) {
      set({ generating: false, loadError: e instanceof Error ? e.message : String(e) })
    }
  },

  completeMilestone: async (projectId, milestoneId) => {
    try {
      const plan = await window.api.phaseMilestoneComplete(projectId, milestoneId)
      if (plan) set({ plan })
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) })
    }
  },

  startRun: async (projectId, config) => {
    await window.api.phaseRunStart(projectId, config)
    const runState = await window.api.phaseRunState(projectId)
    set({ runState })
  },

  stopRun: async (projectId) => {
    await window.api.phaseRunStop(projectId)
    set({ runState: idleRunState })
  },

  refreshRunState: async (projectId) => {
    const runState = await window.api.phaseRunState(projectId)
    set({ runState })
  },

  setRunState: (runState) => set({ runState }),
}))
