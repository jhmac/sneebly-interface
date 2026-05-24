import { useRef, useState, useEffect } from 'react'
import { ChevronDown, Zap, X } from 'lucide-react'
import { SKILLS } from '../../skills'
import type { Skill } from '../../skills'
import { useChatStore } from '../../state/chatStore'

const CATEGORY_LABELS: Record<Skill['category'], string> = {
  debug: 'Debug',
  build: 'Build',
  review: 'Review',
  plan: 'Plan',
}

const CATEGORIES: Skill['category'][] = ['debug', 'build', 'review', 'plan']

export default function SkillSelector() {
  const { activeSkillId, setActiveSkill } = useChatStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const activeSkill = SKILLS.find((s) => s.id === activeSkillId) ?? null

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (activeSkill) {
    return (
      <div className="flex items-center gap-1 rounded-md bg-indigo-900/40 border border-indigo-700/50 px-2 py-0.5">
        <Zap className="h-3 w-3 text-indigo-400 flex-shrink-0" />
        <span className="text-xs font-medium text-indigo-300">{activeSkill.name}</span>
        <button
          onClick={() => setActiveSkill(null)}
          className="ml-0.5 text-indigo-500 hover:text-indigo-300 transition-colors"
          title="Clear skill"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        title="Activate a skill mode"
      >
        <Zap className="h-3 w-3" />
        Skills
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {CATEGORIES.map((cat) => {
            const skills = SKILLS.filter((s) => s.category === cat)
            return (
              <div key={cat}>
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  {CATEGORY_LABELS[cat]}
                </p>
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => { setActiveSkill(skill.id); setOpen(false) }}
                    className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-zinc-800"
                  >
                    <span className="text-xs font-medium text-zinc-300">{skill.name}</span>
                    <span className="text-[11px] text-zinc-600">{skill.description}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
