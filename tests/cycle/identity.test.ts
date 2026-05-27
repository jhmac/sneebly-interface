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
  normalizeRoadmapBullet,
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

  it('marks normal milestones as not skipped', () => {
    const content = `## Roadmap\n\n### Phase 1: Setup\n\n**Milestones**:\n- [ ] Create basic UI\n- [x] Set up project\n`
    const goals = parseGoals(content)
    for (const m of goals.phases[0]!.milestones) {
      expect(m.skipped).toBe(false)
      expect(m.skipReason).toBeUndefined()
    }
  })

  it('detects (skipped) annotation on an unchecked milestone', () => {
    const content = `## Roadmap\n\n### Phase 1: Setup\n\n**Milestones**:\n- [ ] Create basic UI (skipped)\n- [x] Set up project\n`
    const goals = parseGoals(content)
    const ui = goals.phases[0]!.milestones[0]!
    expect(ui.skipped).toBe(true)
    expect(ui.skipReason).toBeUndefined()
    expect(ui.text).toBe('Create basic UI')
    expect(ui.checked).toBe(false)
  })

  it('detects (skipped: reason) annotation and captures reason', () => {
    const content = `## Roadmap\n\n### Phase 1: Setup\n\n**Milestones**:\n- [ ] Create basic UI (skipped: not ready yet)\n`
    const goals = parseGoals(content)
    const ui = goals.phases[0]!.milestones[0]!
    expect(ui.skipped).toBe(true)
    expect(ui.skipReason).toBe('not ready yet')
    expect(ui.text).toBe('Create basic UI')
  })

  it('strips skip annotation from text but preserves the rest of the line', () => {
    const content = `## Roadmap\n\n### Phase 1: Setup\n\n**Milestones**:\n- [ ] Auth system (skipped: no designs) → [spec](./specs/SPEC_AUTH.md)\n`
    const goals = parseGoals(content)
    const m = goals.phases[0]!.milestones[0]!
    // parseMilestone extracts text BEFORE milestone-parser strips the spec link,
    // so the text here still includes the spec link arrow (identity.ts doesn't strip it)
    expect(m.skipped).toBe(true)
    expect(m.skipReason).toBe('no designs')
    expect(m.text).not.toContain('skipped')
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

describe('identity — normalizeRoadmapBullet', () => {
  const none = new Set<string>()

  it('passes canonical bullets through unchanged', () => {
    expect(normalizeRoadmapBullet('- [x] Feature foo', none)).toBe('- [x] Feature foo')
    expect(normalizeRoadmapBullet('- [ ] Feature bar', none)).toBe('- [ ] Feature bar')
  })

  it('normalizes "*", bare "-", "+", and "1." bullets, defaulting to done', () => {
    expect(normalizeRoadmapBullet('* Authentication', none)).toBe('- [x] Authentication')
    expect(normalizeRoadmapBullet('- Authentication', none)).toBe('- [x] Authentication')
    expect(normalizeRoadmapBullet('+ Authentication', none)).toBe('- [x] Authentication')
    expect(normalizeRoadmapBullet('1. Authentication', none)).toBe('- [x] Authentication')
  })

  it('marks "(partial:)" and "(not started)" bullets unchecked', () => {
    expect(normalizeRoadmapBullet('* Profiles (partial: no avatar)', none)).toBe('- [ ] Profiles (partial: no avatar)')
    expect(normalizeRoadmapBullet('* RAG search (not started)', none)).toBe('- [ ] RAG search (not started)')
  })

  it('marks features with a Key Features entry unchecked (primary signal)', () => {
    const kf = new Set(['rag semantic search'])
    expect(normalizeRoadmapBullet('* RAG semantic search — pgvector search', kf)).toBe('- [ ] RAG semantic search — pgvector search')
    expect(normalizeRoadmapBullet('* User auth — Clerk', kf)).toBe('- [x] User auth — Clerk')
  })

  it('leaves non-bullet lines untouched', () => {
    expect(normalizeRoadmapBullet('Some prose paragraph', none)).toBe('Some prose paragraph')
    expect(normalizeRoadmapBullet('### Phase 1: Core', none)).toBe('### Phase 1: Core')
    expect(normalizeRoadmapBullet('', none)).toBe('')
  })
})

describe('identity — parseGoals tolerates non-canonical bullets', () => {
  it('parses a Replit-style GOALS.md with "*" bullets into milestones', () => {
    const content = `# Taime

## Mission

Taime is a retail ops platform.

## Roadmap

Phases ship in order.

### Phase 1: Core Operations

* Authentication and RBAC — Clerk OAuth, role-based access
* Employee profiles — HR metadata, documents
* Payroll export — presets UI done (partial: CSV byte stream not produced)

### Phase 2: AI Intelligence Layer

* AI auto-scheduling — Claude-powered schedule generation
* SOP Evolution System — AI revision proposals (not started)
`
    const goals = parseGoals(content)
    expect(goals.mission).toContain('retail ops platform')
    expect(goals.phases.length).toBe(2)
    const all = goals.phases.flatMap((p) => p.milestones)
    expect(all.length).toBe(5)
    const byText = (t: string) => all.find((m) => m.text.startsWith(t))!
    expect(byText('Authentication and RBAC').checked).toBe(true)
    expect(byText('AI auto-scheduling').checked).toBe(true)
    expect(byText('Payroll export').checked).toBe(false)       // (partial:)
    expect(byText('SOP Evolution System').checked).toBe(false) // (not started)
  })

  it('uses Key Features entries to mark checkbox-less bullets unchecked', () => {
    const content = `# App

## Mission

An app.

## Key Features

### RAG semantic search

Search SOPs with embeddings. Not started — no code yet.

## Roadmap

### Phase 1: Core

* User authentication — Clerk
* RAG semantic search — pgvector embeddings
`
    const goals = parseGoals(content)
    const all = goals.phases.flatMap((p) => p.milestones)
    expect(all.find((m) => m.text.startsWith('User authentication'))!.checked).toBe(true)
    expect(all.find((m) => m.text.startsWith('RAG semantic search'))!.checked).toBe(false)
  })

  it('still parses canonical "- [x]"/"- [ ]" bullets unchanged (no regression)', () => {
    const content = `# NYOUS

## Mission

A news app.

## Roadmap

### Phase 1: Core Loop

- [x] Clerk auth
- [x] Phone verification
- [ ] Full-screen feed card
`
    const goals = parseGoals(content)
    const all = goals.phases.flatMap((p) => p.milestones)
    expect(all.length).toBe(3)
    expect(all.filter((m) => m.checked).length).toBe(2)
    expect(all.find((m) => m.text === 'Full-screen feed card')!.checked).toBe(false)
  })
})

// Locks the contract the new-project Goals Wizard generation prompt must satisfy:
// a freshly generated GOALS.md (every feature "- [ ]") parses into phases with all
// milestones unchecked, mission populated, Key Features prose ignored by the parser.
describe('identity — new-project canonical GOALS.md (Goals Wizard output shape)', () => {
  const content = `# Receipt Vault

## Mission

Receipt Vault helps small-business owners and bookkeepers capture, organize, and
tax-classify receipts. Owners scan or email receipts; AI extracts the details and
suggests QuickBooks-compatible categories.

## Tech Stack

To be filled after Replit build — paste the Stack Report here.

## Key Features

### Authentication and multi-user accounts

Email/password auth with owner, bookkeeper, and employee roles. Owners invite
teammates; role gates what each can see and edit.

### Camera-based receipt scanner

Capture or upload a photo of a receipt; the image is stored securely and queued
for AI extraction.

### AI receipt extraction

Pulls vendor, date, total, tax, and line items from the receipt image.

## Roadmap

Phases ship MVP first, then advanced features.

### Phase 1: Foundation & Receipt Capture

- [ ] Authentication and multi-user accounts — email/password auth with owner/bookkeeper/employee roles
- [ ] Camera-based receipt scanner — capture or upload photo, secure storage
- [ ] AI receipt extraction — vendor, date, total, tax, line items

### Phase 2: Email Auto-Import (IMAP)

- [ ] IMAP account connection — single account per user, secure credentials
- [ ] Scheduled pull — on demand or scheduled, attachment + inline content
`

  it('populates mission and parses both phases', () => {
    const goals = parseGoals(content)
    expect(goals.mission).toContain('Receipt Vault helps small-business owners')
    expect(goals.phases.length).toBe(2)
    expect(goals.phases[0]!.name).toBe('Foundation & Receipt Capture')
    expect(goals.phases[1]!.name).toBe('Email Auto-Import (IMAP)')
  })

  it('parses every feature as an unchecked milestone (nothing built yet)', () => {
    const goals = parseGoals(content)
    const all = goals.phases.flatMap((p) => p.milestones)
    expect(all.length).toBe(5)
    expect(all.every((m) => m.checked === false)).toBe(true)
    expect(all[0]!.text).toBe('Authentication and multi-user accounts — email/password auth with owner/bookkeeper/employee roles')
  })

  it('does not leak Key Features "### " entries into the roadmap as phases', () => {
    const goals = parseGoals(content)
    // Three "### " feature entries under Key Features must NOT become phases.
    expect(goals.phases.length).toBe(2)
  })
})
