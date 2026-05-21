import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { GoalsMd, GoalsMilestone, GoalsPhase } from '../../shared/types'

export function parseGoalsFile(projectPath: string): GoalsMd | null {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) return null
  try {
    const content = readFileSync(goalsPath, 'utf-8')
    return parseGoals(content)
  } catch {
    return null
  }
}

export function parseGoals(content: string): GoalsMd {
  const lines = content.split('\n')

  let mission = ''
  const techStack: Record<string, string> = {}
  const phases: GoalsPhase[] = []
  const openQuestions: string[] = []

  type Section =
    | 'none'
    | 'mission'
    | 'techStack'
    | 'roadmap'
    | 'openQuestions'
    | 'other'

  let section: Section = 'none'

  // Within roadmap, we track sub-state
  type PhaseSection = 'none' | 'behaviors' | 'milestones'
  let phaseSection: PhaseSection = 'none'
  let currentPhase: GoalsPhase | null = null

  const missionLines: string[] = []

  function pushCurrentPhase() {
    if (currentPhase) phases.push(currentPhase)
    currentPhase = null
    phaseSection = 'none'
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip HTML comments
    if (trimmed.startsWith('<!--')) {
      while (i < lines.length && !lines[i].includes('-->')) i++
      continue
    }

    // Detect top-level sections (## headings)
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim().toLowerCase()
      pushCurrentPhase()

      if (heading === 'mission') {
        section = 'mission'
      } else if (heading === 'tech stack') {
        section = 'techStack'
      } else if (heading === 'roadmap') {
        section = 'roadmap'
      } else if (heading === 'open questions') {
        section = 'openQuestions'
      } else {
        section = 'other'
      }
      continue
    }

    // Roadmap phase headings (### Phase N: Name or ### Phase N — Name)
    if (section === 'roadmap' && trimmed.startsWith('### ')) {
      pushCurrentPhase()
      const phaseHeading = trimmed.slice(4).trim()
      const phaseMatch = phaseHeading.match(/^Phase\s+(\d+)[:\s—–-]+(.+)$/i)
      if (phaseMatch) {
        currentPhase = {
          number: parseInt(phaseMatch[1], 10),
          name: phaseMatch[2].trim(),
          behaviors: [],
          milestones: [],
        }
      } else {
        // Phase heading without number
        currentPhase = {
          number: phases.length + 1,
          name: phaseHeading,
          behaviors: [],
          milestones: [],
        }
      }
      phaseSection = 'none'
      continue
    }

    // Phase sub-sections: **Behaviors introduced**: or **Milestones**:
    if (section === 'roadmap' && currentPhase) {
      if (trimmed.match(/^\*\*Behaviors introduced\*\*:?/i)) {
        phaseSection = 'behaviors'
        continue
      }
      if (trimmed.match(/^\*\*Milestones\*\*:?/i)) {
        phaseSection = 'milestones'
        continue
      }

      // Bullet points within phase sections
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const bullet = trimmed.slice(2)
        if (phaseSection === 'behaviors') {
          currentPhase.behaviors.push(bullet.trim())
        } else if (phaseSection === 'milestones') {
          const milestone = parseMilestone(bullet)
          if (milestone) currentPhase.milestones.push(milestone)
        }
        continue
      }

      // Blank line resets phase section awareness but not the current phase
      if (trimmed === '') continue
    }

    // Mission: collect non-blank, non-separator lines
    if (section === 'mission') {
      if (trimmed === '---') continue
      missionLines.push(trimmed)
      continue
    }

    // Tech stack: parse "- **Key**: Value" format
    if (section === 'techStack') {
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const bullet = trimmed.slice(2)
        const kvMatch = bullet.match(/^\*\*(.+?)\*\*:?\s*(.*)$/)
        if (kvMatch) {
          const key = kvMatch[1].trim()
          let value = kvMatch[2].trim()
          // Collect any continuation lines (indented sub-bullets)
          const subLines: string[] = []
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1]
            const nextTrimmed = nextLine.trim()
            if (
              nextTrimmed.startsWith('  - ') ||
              nextTrimmed.startsWith('  * ')
            ) {
              subLines.push(nextTrimmed.slice(4).trim())
              i++
            } else {
              break
            }
          }
          if (value === '' && subLines.length > 0) {
            value = subLines.join(', ')
          }
          if (value !== '') techStack[key] = value
        }
      }
      continue
    }

    // Open questions: "- [ ] ..." or "- [x] ..." or plain "- ..."
    if (section === 'openQuestions') {
      if (trimmed.startsWith('- ')) {
        const bullet = trimmed.slice(2)
        const milestone = parseMilestone(bullet)
        if (milestone) {
          openQuestions.push(milestone.text)
        } else if (bullet.trim()) {
          openQuestions.push(bullet.trim())
        }
      }
      continue
    }
  }

  pushCurrentPhase()

  mission = missionLines
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { mission, techStack, phases, openQuestions }
}

function parseMilestone(bullet: string): GoalsMilestone | null {
  const checkedMatch = bullet.match(/^\[x\]\s+(.+)$/i)
  if (checkedMatch) return { text: checkedMatch[1].trim(), checked: true }
  const uncheckedMatch = bullet.match(/^\[ \]\s+(.+)$/)
  if (uncheckedMatch) return { text: uncheckedMatch[1].trim(), checked: false }
  return null
}
