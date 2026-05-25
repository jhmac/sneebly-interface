import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Skill } from '../../shared/types'

// Sneebly UX display names, keyed by folder name (skill ID)
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'diagnose':                     'Diagnose',
  'tdd':                          'TDD',
  'prototype':                    'Prototype',
  'zoom-out':                     'Zoom Out',
  'improve-codebase-architecture':'Architecture Review',
  'to-prd':                       'Write PRD',
  'to-issues':                    'Break into Issues',
  'triage':                       'Triage Issues',
  'grill-with-docs':              'Grill + Build Docs',
  'setup-matt-pocock-skills':     'Setup Skills',
  'self-review':                  'Self-Review',
}

// Category is a Sneebly UX concern — not stored in the skill files themselves
const SKILL_CATEGORIES: Record<string, Skill['category']> = {
  'diagnose':                      'debug',
  'tdd':                           'build',
  'prototype':                     'build',
  'zoom-out':                      'review',
  'improve-codebase-architecture': 'review',
  'self-review':                   'review',
  'to-prd':                        'plan',
  'to-issues':                     'plan',
  'triage':                        'plan',
  'grill-with-docs':               'plan',
  'setup-matt-pocock-skills':      'plan',
}

const CATEGORY_ORDER: Skill['category'][] = ['debug', 'build', 'review', 'plan']

function toTitleCase(s: string): string {
  return s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function parseFrontmatter(content: string): { description: string; body: string } {
  if (!content.startsWith('---\n')) return { description: '', body: content.trim() }

  const rest = content.slice(4)
  const endIdx = rest.indexOf('\n---')
  if (endIdx === -1) return { description: '', body: content.trim() }

  const fmBlock = rest.slice(0, endIdx)
  const body = rest.slice(endIdx + 4).replace(/^\n/, '').trim()

  let description = ''
  for (const line of fmBlock.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (key === 'description') {
      description = line.slice(colon + 1).trim()
    }
  }

  return { description, body }
}

export function getSkillPrompt(id: string): string | null {
  const skillsRoot = join(app.getAppPath(), '.claude', 'skills')
  const skillFile = join(skillsRoot, id, 'SKILL.md')
  if (!existsSync(skillFile)) return null
  const content = readFileSync(skillFile, 'utf-8')
  const { body } = parseFrontmatter(content)
  return body || null
}

export function listInstalledSkills(): Skill[] {
  // In development app.getAppPath() is the project root; skills live at .claude/skills/
  const skillsRoot = join(app.getAppPath(), '.claude', 'skills')
  if (!existsSync(skillsRoot)) return []

  const skills: Skill[] = []

  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const skillFile = join(skillsRoot, id, 'SKILL.md')
    if (!existsSync(skillFile)) continue

    const content = readFileSync(skillFile, 'utf-8')
    const { description, body } = parseFrontmatter(content)

    skills.push({
      id,
      name: SKILL_DISPLAY_NAMES[id] ?? toTitleCase(id),
      description,
      category: SKILL_CATEGORIES[id] ?? 'review',
      prompt: body,
    })
  }

  return skills.sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    return catDiff !== 0 ? catDiff : a.name.localeCompare(b.name)
  })
}
