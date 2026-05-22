import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseGoals,
  parseGoalsFile,
  parseHeartbeat,
  parseIdentity,
  computeChecksums,
  verifyChecksums,
  saveChecksums,
} from '../../src/main/services/cycle/identity'

const FLOW_COMMERCE_GOALS = '/Users/mister/Sneebly-V3/projects/Flow-Commerce/artifacts/GOALS.md'

describe('identity — parseGoals', () => {
  it('parses Flow-Commerce GOALS.md if it exists', () => {
    if (!existsSync(FLOW_COMMERCE_GOALS)) return // skip if V3 not present

    const result = parseGoalsFile(FLOW_COMMERCE_GOALS.replace('/GOALS.md', ''))
    // parseGoalsFile takes a project dir, not the file path directly
    // So we call parseGoals directly on the file content
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const content = readFileSync(FLOW_COMMERCE_GOALS, 'utf8')
    const goals = parseGoals(content)

    expect(goals.mission).toBeTruthy()
    expect(goals.mission.length).toBeGreaterThan(10)
    expect(goals.phases.length).toBeGreaterThan(0)
    // At least one phase should have milestones
    const hasAnyMilestone = goals.phases.some(p => p.milestones.length > 0)
    expect(hasAnyMilestone).toBe(true)
  })

  it('parses minimal GOALS.md with just Mission', () => {
    const content = `# GOALS.md

## Mission

Build a simple todo app.

## Roadmap

### Phase 1: Foundation

**Milestones**:
- [ ] Create basic UI
- [x] Set up project
`
    const goals = parseGoals(content)
    expect(goals.mission).toBe('Build a simple todo app.')
    expect(goals.phases).toHaveLength(1)
    expect(goals.phases[0]!.milestones).toHaveLength(2)
    expect(goals.phases[0]!.milestones[0]!.checked).toBe(false)
    expect(goals.phases[0]!.milestones[1]!.checked).toBe(true)
    expect(goals.openQuestions).toHaveLength(0)
  })

  it('returns empty mission and empty phases for blank content', () => {
    const goals = parseGoals('')
    expect(goals.mission).toBe('')
    expect(goals.phases).toHaveLength(0)
    expect(goals.techStack).toEqual({})
  })
})

describe('identity — parseHeartbeat', () => {
  it('parses numeric fields with defaults for missing ones', () => {
    const content = `
**Max turns per Claude Code call**: 25
**Max files modified per cycle**: 5
**Soft cap per project per day**: 15
`
    const hb = parseHeartbeat(content)
    expect(hb.maxTurns).toBe(25)
    expect(hb.maxFilesPerCycle).toBe(5)
    expect(hb.softCapPerDay).toBe(15)
    expect(hb.hardCapPerDay).toBe(40) // default
    expect(hb.executionRetries).toBe(1) // default
  })
})

describe('identity — parseIdentity', () => {
  it('parses project metadata fields', () => {
    const content = `
## Project Name

Flow-Commerce

## Repository

github.com/jhmac/flow-commerce

## Production URL

https://flowcommerce.app

## Health Endpoint

/api/health
`
    const id = parseIdentity(content)
    expect(id.projectName).toBe('Flow-Commerce')
    expect(id.repository).toBe('github.com/jhmac/flow-commerce')
    expect(id.productionUrl).toBe('https://flowcommerce.app')
    expect(id.healthEndpoint).toBe('/api/health')
  })
})

describe('identity — checksums', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sneebly-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    // Write minimal identity files
    for (const f of ['SOUL.md', 'AGENTS.md', 'GOALS.md', 'HEARTBEAT.md', 'IDENTITY.md']) {
      writeFileSync(join(tmpDir, f), `# ${f}\n\nContent for ${f}`)
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saveChecksums + verifyChecksums: passes on unchanged files', () => {
    saveChecksums(tmpDir)
    const result = verifyChecksums(tmpDir)
    expect(result.ok).toBe(true)
    expect(result.tampered).toHaveLength(0)
  })

  it('verifyChecksums: detects modification', () => {
    saveChecksums(tmpDir)
    // Modify one file
    writeFileSync(join(tmpDir, 'GOALS.md'), '# GOALS.md\n\nTampered content')
    const result = verifyChecksums(tmpDir)
    expect(result.ok).toBe(false)
    expect(result.tampered).toContain('GOALS.md')
  })

  it('verifyChecksums: returns ok=true when no checksums file exists', () => {
    // No saveChecksums call, so no .sneebly/checksums.json exists
    const result = verifyChecksums(tmpDir)
    expect(result.ok).toBe(true)
  })

  it('computeChecksums: produces consistent SHA-256 hashes', () => {
    const c1 = computeChecksums(tmpDir)
    const c2 = computeChecksums(tmpDir)
    expect(c1).toEqual(c2)
    expect(Object.keys(c1)).toHaveLength(5)
    expect(c1['SOUL.md']).toMatch(/^[a-f0-9]{64}$/)
  })
})
