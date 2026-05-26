import { create } from 'zustand'
import type { GrillMessage } from '../../shared/types'

export type WizardStage = 'path-pick' | 'import' | 'hook' | 'grill' | 'generating' | 'output' | 'stack-report'

interface GoalsWizardStore {
  open: boolean
  stage: WizardStage
  ideaSeed: string
  messages: GrillMessage[]
  grillReady: boolean
  goalsMd: string
  buildPrompt: string
  contextMd: string
  stackReport: string
  error: string | null

  openWizard: () => void
  closeWizard: () => void
  setStage: (stage: WizardStage) => void
  setIdeaSeed: (idea: string) => void
  // Appends a user+assistant exchange; grillReady latches true and never goes false
  addMessages: (userMsg: string, assistantMsg: string, ready: boolean) => void
  setGenerated: (goalsMd: string, buildPrompt: string, contextMd: string) => void
  setStackReport: (report: string) => void
  setGoalsMd: (md: string) => void
  setError: (err: string | null) => void
  // Resets conversation state but keeps the wizard open
  reset: () => void
}

const BLANK: Omit<GoalsWizardStore, 'openWizard' | 'closeWizard' | 'setStage' | 'setIdeaSeed' | 'addMessages' | 'setGenerated' | 'setStackReport' | 'setGoalsMd' | 'setError' | 'reset'> = {
  open: false,
  stage: 'path-pick',
  ideaSeed: '',
  messages: [],
  grillReady: false,
  goalsMd: '',
  buildPrompt: '',
  contextMd: '',
  stackReport: '',
  error: null,
}

export const useGoalsWizardStore = create<GoalsWizardStore>((set) => ({
  ...BLANK,

  openWizard: () => set({ ...BLANK, open: true }),

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
      // Latch: once true, stays true even if Claude omits the marker on a follow-up
      grillReady: s.grillReady || ready,
    })),

  setGenerated: (goalsMd, buildPrompt, contextMd) => set({ goalsMd, buildPrompt, contextMd }),

  setStackReport: (stackReport) => set({ stackReport }),

  setGoalsMd: (goalsMd) => set({ goalsMd }),

  setError: (error) => set({ error }),

  // Keeps wizard open, resets everything else back to the hook stage
  reset: () => set({ ...BLANK, open: true }),
}))
