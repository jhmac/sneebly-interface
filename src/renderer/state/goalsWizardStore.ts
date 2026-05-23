import { create } from 'zustand'
import type { GrillMessage } from '../../shared/types'

export type WizardStage = 'hook' | 'grill' | 'generating' | 'output' | 'stack-report'

interface GoalsWizardStore {
  open: boolean
  stage: WizardStage
  // The user's initial idea (from the hook stage)
  ideaSeed: string
  // Full conversation history for the grill
  messages: GrillMessage[]
  // Set when Claude signals it has enough info
  grillReady: boolean
  // Generated outputs
  goalsMd: string
  buildPrompt: string
  // Stack report pasted by user
  stackReport: string
  // Error from any async operation
  error: string | null

  openWizard: () => void
  closeWizard: () => void
  setStage: (stage: WizardStage) => void
  setIdeaSeed: (idea: string) => void
  addMessages: (userMsg: string, assistantMsg: string, ready: boolean) => void
  setGrillReady: (ready: boolean) => void
  setGenerated: (goalsMd: string, buildPrompt: string) => void
  setStackReport: (report: string) => void
  setGoalsMd: (md: string) => void
  setError: (err: string | null) => void
  reset: () => void
}

const INITIAL_STATE = {
  open: false,
  stage: 'hook' as WizardStage,
  ideaSeed: '',
  messages: [] as GrillMessage[],
  grillReady: false,
  goalsMd: '',
  buildPrompt: '',
  stackReport: '',
  error: null,
}

export const useGoalsWizardStore = create<GoalsWizardStore>((set) => ({
  ...INITIAL_STATE,

  openWizard: () => set({ ...INITIAL_STATE, open: true }),

  closeWizard: () => set({ open: false }),

  setStage: (stage) => set({ stage }),

  setIdeaSeed: (ideaSeed) => set({ ideaSeed }),

  addMessages: (userMsg, assistantMsg, ready) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { role: 'user', content: userMsg },
        { role: 'assistant', content: assistantMsg },
      ],
      grillReady: ready,
    })),

  setGrillReady: (grillReady) => set({ grillReady }),

  setGenerated: (goalsMd, buildPrompt) => set({ goalsMd, buildPrompt }),

  setStackReport: (stackReport) => set({ stackReport }),

  setGoalsMd: (goalsMd) => set({ goalsMd }),

  setError: (error) => set({ error }),

  reset: () => set(INITIAL_STATE),
}))
