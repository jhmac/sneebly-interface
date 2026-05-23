import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const CANNED_SPEC = `# SPEC: Add Search Functionality

> Source milestone: Add search functionality
> Generated: 2026-05-23

## Overview

Refined spec content here.`

vi.mock('../../src/main/services/standalone-turn', () => {
  return {
    runStandaloneTurn: vi.fn().mockResolvedValue({
      assistantText: '# SPEC: Add Search Functionality\n\n## Overview\n\nRefined spec content here.',
      events: [],
      claudeCodeSessionId: 'test-session',
    }),
  }
})

vi.mock('../../src/main/services/project-registry', () => ({
  detectProjectName: vi.fn().mockReturnValue('Test Project'),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { refineSpec } from '../../src/main/services/spec/spec-generator'
import { runStandaloneTurn } from '../../src/main/services/standalone-turn'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_GOALS = `# Mission

Ship it.

## Roadmap

### Phase 1: Foundation

- [ ] Set up database schema
- [x] Create user authentication

### Phase 2: Core Features

- [ ] Add search functionality
- [ ] Implement dashboard UI
`

const EXISTING_SPEC = `# SPEC: Add Search Functionality

## Overview

Original spec content.`

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProjectDir(): string {
  const dir = join(tmpdir(), `sneebly-test-refine-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'specs'), { recursive: true })
  writeFileSync(join(dir, 'GOALS.md'), BASE_GOALS, 'utf-8')
  writeFileSync(join(dir, 'specs', 'SPEC_ADD_SEARCH_FUNCTIONALITY.md'), EXISTING_SPEC, 'utf-8')
  return dir
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('refineSpec', () => {
  let projectDir: string
  const progressEvents: string[] = []

  beforeEach(() => {
    projectDir = makeProjectDir()
    progressEvents.length = 0
    vi.mocked(runStandaloneTurn).mockClear()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('returns error if GOALS.md is missing', async () => {
    rmSync(join(projectDir, 'GOALS.md'))
    const result = await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Add more detail',
      mode: 'edit-only',
      onProgress: (e) => progressEvents.push(e.type),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('GOALS.md')
  })

  it('returns error if milestone is not found', async () => {
    const result = await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'nonexistent-milestone',
      refinementPrompt: 'Make it better',
      mode: 'edit-only',
      onProgress: (e) => progressEvents.push(e.type),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns error if spec file does not exist', async () => {
    rmSync(join(projectDir, 'specs', 'SPEC_ADD_SEARCH_FUNCTIONALITY.md'))
    const result = await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Add more detail',
      mode: 'edit-only',
      onProgress: (e) => progressEvents.push(e.type),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('does not exist')
  })

  it('uses Sonnet for edit-only mode', async () => {
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Improve the UI section',
      mode: 'edit-only',
      onProgress: () => {},
    })
    const call = vi.mocked(runStandaloneTurn).mock.calls[0]![0]
    expect(call.model).toBe('claude-sonnet-4-6')
  })

  it('uses Opus for research mode', async () => {
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Improve with new research',
      mode: 'research',
      onProgress: () => {},
    })
    const call = vi.mocked(runStandaloneTurn).mock.calls[0]![0]
    expect(call.model).toBe('claude-opus-4-7')
  })

  it('edit-only mode does not allow WebSearch or WebFetch', async () => {
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Just edit it',
      mode: 'edit-only',
      onProgress: () => {},
    })
    const call = vi.mocked(runStandaloneTurn).mock.calls[0]![0]
    expect(call.allowedTools).not.toContain('WebSearch')
    expect(call.allowedTools).not.toContain('WebFetch')
  })

  it('research mode allows WebSearch and WebFetch', async () => {
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Research and improve',
      mode: 'research',
      onProgress: () => {},
    })
    const call = vi.mocked(runStandaloneTurn).mock.calls[0]![0]
    expect(call.allowedTools).toContain('WebSearch')
    expect(call.allowedTools).toContain('WebFetch')
  })

  it('writes refined content to the spec file', async () => {
    const result = await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Make the UI section specific',
      mode: 'edit-only',
      onProgress: () => {},
    })
    expect(result.success).toBe(true)
    const written = readFileSync(
      join(projectDir, 'specs', 'SPEC_ADD_SEARCH_FUNCTIONALITY.md'),
      'utf-8'
    )
    expect(written).toContain('# SPEC: Add Search Functionality')
    expect(written).toContain('Refined spec content here.')
  })

  it('returns the spec file path on success', async () => {
    const result = await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Make it better',
      mode: 'edit-only',
      onProgress: () => {},
    })
    expect(result.success).toBe(true)
    expect(result.specPath).toBe(join(projectDir, 'specs', 'SPEC_ADD_SEARCH_FUNCTIONALITY.md'))
  })

  it('emits start, milestone-start, milestone-done, complete events in order', async () => {
    const types: string[] = []
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Make it better',
      mode: 'edit-only',
      onProgress: (e) => types.push(e.type),
    })
    expect(types).toEqual(['start', 'milestone-start', 'milestone-done', 'complete'])
  })

  it('includes the user refinement prompt in the standalone turn prompt', async () => {
    const myPrompt = 'The wireframe is missing the mobile layout'
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: myPrompt,
      mode: 'edit-only',
      onProgress: () => {},
    })
    const call = vi.mocked(runStandaloneTurn).mock.calls[0]![0]
    expect(call.prompt).toContain(myPrompt)
  })

  it('includes the existing spec content in the prompt', async () => {
    await refineSpec({
      projectPath: projectDir,
      projectId: 'proj-1',
      milestoneId: 'add-search-functionality',
      refinementPrompt: 'Add more',
      mode: 'edit-only',
      onProgress: () => {},
    })
    const call = vi.mocked(runStandaloneTurn).mock.calls[0]![0]
    expect(call.prompt).toContain('Original spec content.')
  })
})
