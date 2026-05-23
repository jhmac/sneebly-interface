import { describe, it, expect } from 'vitest'
import { injectSpecLinks, parseMilestones } from '../../src/main/services/spec/milestone-parser'

const BASE_GOALS = `# Mission

Ship it.

## Roadmap

### Phase 1: Foundation

- [ ] Set up database schema
- [x] Create user authentication
- [ ] Build REST API endpoints

### Phase 2: Core Features

- [ ] Add search functionality
- [ ] Implement dashboard UI
`

describe('injectSpecLinks', () => {
  it('adds spec links to unchecked milestones', () => {
    const links = new Map([
      ['set-up-database-schema', 'SET_UP_DATABASE_SCHEMA'],
      ['build-rest-api-endpoints', 'BUILD_REST_API_ENDPOINTS'],
    ])
    const result = injectSpecLinks(BASE_GOALS, links)
    expect(result).toContain('Set up database schema → [Detailed spec](./specs/SPEC_SET_UP_DATABASE_SCHEMA.md)')
    expect(result).toContain('Build REST API endpoints → [Detailed spec](./specs/SPEC_BUILD_REST_API_ENDPOINTS.md)')
  })

  it('also adds links to checked milestones', () => {
    const links = new Map([['create-user-authentication', 'CREATE_USER_AUTHENTICATION']])
    const result = injectSpecLinks(BASE_GOALS, links)
    expect(result).toContain('Create user authentication → [Detailed spec](./specs/SPEC_CREATE_USER_AUTHENTICATION.md)')
  })

  it('leaves milestones without a link entry unchanged', () => {
    const links = new Map([['set-up-database-schema', 'SET_UP_DATABASE_SCHEMA']])
    const result = injectSpecLinks(BASE_GOALS, links)
    // These should not have links injected
    expect(result).toContain('- [ ] Build REST API endpoints\n')
    expect(result).toContain('- [ ] Add search functionality\n')
  })

  it('is idempotent — running twice produces no duplicates', () => {
    const links = new Map([
      ['set-up-database-schema', 'SET_UP_DATABASE_SCHEMA'],
      ['add-search-functionality', 'ADD_SEARCH_FUNCTIONALITY'],
    ])
    const once = injectSpecLinks(BASE_GOALS, links)
    const twice = injectSpecLinks(once, links)
    expect(twice).toBe(once)
  })

  it('does not touch lines that already have a spec link', () => {
    const withExisting = BASE_GOALS.replace(
      '- [ ] Build REST API endpoints',
      '- [ ] Build REST API endpoints → [Detailed spec](./specs/SPEC_BUILD_REST_API_ENDPOINTS.md)',
    )
    const links = new Map([['build-rest-api-endpoints', 'SOMETHING_DIFFERENT']])
    const result = injectSpecLinks(withExisting, links)
    // Original link preserved, not overwritten
    expect(result).toContain('SPEC_BUILD_REST_API_ENDPOINTS.md')
    expect(result).not.toContain('SOMETHING_DIFFERENT')
  })

  it('preserves all non-milestone lines verbatim', () => {
    const links = new Map<string, string>()
    const result = injectSpecLinks(BASE_GOALS, links)
    expect(result).toContain('# Mission')
    expect(result).toContain('Ship it.')
    expect(result).toContain('## Phase 1: Foundation')
    expect(result).toContain('## Phase 2: Core Features')
  })

  it('preserves line count when no links are injected', () => {
    const links = new Map<string, string>()
    const result = injectSpecLinks(BASE_GOALS, links)
    expect(result.split('\n')).toHaveLength(BASE_GOALS.split('\n').length)
  })

  it('round-trips with parseMilestones — injected links are detected on re-parse', () => {
    const links = new Map([
      ['set-up-database-schema', 'SET_UP_DATABASE_SCHEMA'],
      ['add-search-functionality', 'ADD_SEARCH_FUNCTIONALITY'],
    ])
    const updated = injectSpecLinks(BASE_GOALS, links)
    const refs = parseMilestones(updated)

    const dbRef = refs.find((r) => r.id === 'set-up-database-schema')
    expect(dbRef!.specPath).toBe('./specs/SPEC_SET_UP_DATABASE_SCHEMA.md')
    expect(dbRef!.text).not.toContain('→')

    const searchRef = refs.find((r) => r.id === 'add-search-functionality')
    expect(searchRef!.specPath).toBe('./specs/SPEC_ADD_SEARCH_FUNCTIONALITY.md')
  })
})
