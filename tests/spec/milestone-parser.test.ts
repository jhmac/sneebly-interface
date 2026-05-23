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
})
