import { describe, it, expect } from 'vitest'
import {
  parseMilestones,
  toKebabSlug,
  toUpperSnakeSlug,
} from '../../src/main/services/spec/milestone-parser'

const SAMPLE_GOALS = `# Mission

Build a great product.

## Roadmap

### Phase 1: Foundation

- [ ] Set up database schema
- [x] Create user authentication
- [ ] Build REST API endpoints → [Detailed spec](./specs/SPEC_BUILD_REST_API_ENDPOINTS.md)

### Phase 2: Core Features

- [ ] Add search functionality
- [ ] Implement dashboard UI
- [x] Wire up payment processing
`

describe('toKebabSlug', () => {
  it('lowercases and hyphenates words', () => {
    expect(toKebabSlug('Set up database schema')).toBe('set-up-database-schema')
  })

  it('removes special characters', () => {
    expect(toKebabSlug('Build REST API endpoints!')).toBe('build-rest-api-endpoints')
  })

  it('collapses multiple spaces/hyphens', () => {
    expect(toKebabSlug('foo  --  bar')).toBe('foo-bar')
  })

  it('handles empty string', () => {
    expect(toKebabSlug('')).toBe('')
  })
})

describe('toUpperSnakeSlug', () => {
  it('uppercases and underscores words', () => {
    expect(toUpperSnakeSlug('Set up database schema')).toBe('SET_UP_DATABASE_SCHEMA')
  })

  it('removes special characters', () => {
    expect(toUpperSnakeSlug('Build REST API endpoints!')).toBe('BUILD_REST_API_ENDPOINTS')
  })

  it('collapses underscores', () => {
    expect(toUpperSnakeSlug('foo  --  bar')).toBe('FOO_BAR')
  })
})

describe('parseMilestones', () => {
  it('returns one entry per milestone across all phases', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    expect(refs).toHaveLength(6)
  })

  it('assigns the correct phase label to each milestone', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const phase1 = refs.filter((r) => r.phase === 'Phase 1: Foundation')
    const phase2 = refs.filter((r) => r.phase === 'Phase 2: Core Features')
    expect(phase1).toHaveLength(3)
    expect(phase2).toHaveLength(3)
  })

  it('correctly identifies checked vs unchecked milestones', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const checked = refs.filter((r) => r.checked)
    const unchecked = refs.filter((r) => !r.checked)
    expect(checked).toHaveLength(2)
    expect(unchecked).toHaveLength(4)
  })

  it('strips spec link from milestone text', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const apiRef = refs.find((r) => r.id === 'build-rest-api-endpoints')
    expect(apiRef).toBeDefined()
    expect(apiRef!.text).toBe('Build REST API endpoints')
    expect(apiRef!.text).not.toContain('→')
  })

  it('detects existing spec links and stores relative path', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const apiRef = refs.find((r) => r.id === 'build-rest-api-endpoints')
    expect(apiRef!.specPath).toBe('./specs/SPEC_BUILD_REST_API_ENDPOINTS.md')
  })

  it('sets specPath to null for milestones without links', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const dbRef = refs.find((r) => r.id === 'set-up-database-schema')
    expect(dbRef!.specPath).toBeNull()
  })

  it('generates correct specSlug', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const searchRef = refs.find((r) => r.phase === 'Phase 2: Core Features' && r.text.includes('search'))
    expect(searchRef!.specSlug).toBe('ADD_SEARCH_FUNCTIONALITY')
  })

  it('generates correct id (kebab slug)', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    const uiRef = refs.find((r) => r.text === 'Implement dashboard UI')
    expect(uiRef!.id).toBe('implement-dashboard-ui')
  })

  it('returns empty array for goals with no milestones', () => {
    const refs = parseMilestones('# Mission\n\nNo phases here.\n')
    expect(refs).toHaveLength(0)
  })

  it('skipped is false for normal milestones', () => {
    const refs = parseMilestones(SAMPLE_GOALS)
    for (const ref of refs) {
      expect(ref.skipped).toBe(false)
      expect(ref.skipReason).toBeUndefined()
    }
  })
})

const SKIPPED_GOALS = `# Mission

Build a great product.

## Roadmap

### Phase 1: Foundation

- [ ] Set up database schema (skipped)
- [ ] Create user authentication (skipped: waiting on design handoff)
- [x] Bootstrap project structure
- [ ] Wire up REST API
`

describe('parseMilestones — skipped annotation', () => {
  it('detects bare (skipped) annotation', () => {
    const refs = parseMilestones(SKIPPED_GOALS)
    const db = refs.find((r) => r.id === 'set-up-database-schema')
    expect(db).toBeDefined()
    expect(db!.skipped).toBe(true)
    expect(db!.skipReason).toBeUndefined()
    expect(db!.checked).toBe(false)
  })

  it('detects (skipped: reason) annotation and captures reason', () => {
    const refs = parseMilestones(SKIPPED_GOALS)
    const auth = refs.find((r) => r.id === 'create-user-authentication')
    expect(auth).toBeDefined()
    expect(auth!.skipped).toBe(true)
    expect(auth!.skipReason).toBe('waiting on design handoff')
    expect(auth!.checked).toBe(false)
  })

  it('strips the (skipped) annotation from the milestone text', () => {
    const refs = parseMilestones(SKIPPED_GOALS)
    const db = refs.find((r) => r.id === 'set-up-database-schema')
    expect(db!.text).toBe('Set up database schema')
    expect(db!.text).not.toContain('skipped')
  })

  it('strips the (skipped: reason) annotation from the text', () => {
    const refs = parseMilestones(SKIPPED_GOALS)
    const auth = refs.find((r) => r.id === 'create-user-authentication')
    expect(auth!.text).toBe('Create user authentication')
    expect(auth!.text).not.toContain('skipped')
  })

  it('does not mark checked milestones as skipped', () => {
    const refs = parseMilestones(SKIPPED_GOALS)
    const bootstrap = refs.find((r) => r.id === 'bootstrap-project-structure')
    expect(bootstrap!.checked).toBe(true)
    expect(bootstrap!.skipped).toBe(false)
  })

  it('does not mark normal unchecked milestones as skipped', () => {
    const refs = parseMilestones(SKIPPED_GOALS)
    const api = refs.find((r) => r.id === 'wire-up-rest-api')
    expect(api!.skipped).toBe(false)
    expect(api!.checked).toBe(false)
  })
})
