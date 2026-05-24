import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { app } from 'electron'
import type { SkillSeedResult } from '../../shared/types'

function firstContentLine(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#')) return t
  }
  return null
}

function buildClaudeMd(projectPath: string): string {
  const name = basename(projectPath)
  const description =
    firstContentLine(join(projectPath, 'CONTEXT.md')) ??
    '{One-sentence description — populated from CONTEXT.md if generated.}'

  return `# CLAUDE.md — ${name}

Persistent context for Claude Code in this project.

## What this project is

${description}

Read \`GOALS.md\` for the project roadmap and \`CONTEXT.md\` for the domain glossary.

## Available skills

This project ships with Matt Pocock's engineering skill set under \`.claude/skills/\`. All skills are project-scoped and available via the \`/skills\` command in Claude Code, or selectable from the Skills dropdown in Sneebly Interface.

**Plan / strategy:** grill-with-docs, to-prd, to-issues, triage, setup-matt-pocock-skills
**Build / change:** tdd, prototype
**Review / diagnose:** diagnose, zoom-out, improve-codebase-architecture

See each skill's \`SKILL.md\` for full discipline. Reach for \`diagnose\` on hard bugs; \`improve-codebase-architecture\` between phases; \`grill-with-docs\` before non-trivial changes to stress-test against the project's language.

## Conventions

- Don't add new top-level dependencies without naming them first.
- Don't add documentation files unless requested.
- No emoji in code or commit messages.
`
}

export async function seedSkillsIntoProject(projectPath: string): Promise<SkillSeedResult> {
  if (resolve(projectPath) === resolve(app.getAppPath())) {
    console.warn('[skills-seeder] refusing to seed Sneebly Interface checkout into itself')
    return { copied: [], skipped: [] }
  }

  const sourceRoot = join(app.getAppPath(), '.claude', 'skills')
  if (!existsSync(sourceRoot)) {
    console.warn('[skills-seeder] source skills dir not found:', sourceRoot)
    return { copied: [], skipped: [] }
  }

  const destRoot = join(projectPath, '.claude', 'skills')
  const copied: string[] = []
  const skipped: string[] = []

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const dest = join(destRoot, id)
    if (existsSync(dest)) {
      skipped.push(id)
      continue
    }
    await cp(join(sourceRoot, id), dest, { recursive: true })
    copied.push(id)
  }

  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, buildClaudeMd(projectPath), 'utf-8')
  }

  return { copied, skipped }
}
