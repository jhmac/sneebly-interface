import { create } from 'zustand'
import type { Skill } from '../../shared/types'

export type { Skill }

interface SkillsState {
  skills: Skill[] | null
  setSkills: (skills: Skill[]) => void
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: null,
  setSkills: (skills) => set({ skills }),
}))

export async function loadSkills(): Promise<void> {
  const skills = await window.api.skillsList()
  useSkillsStore.getState().setSkills(skills)
}

export function getSkill(id: string): Skill | undefined {
  return useSkillsStore.getState().skills?.find((s) => s.id === id)
}
