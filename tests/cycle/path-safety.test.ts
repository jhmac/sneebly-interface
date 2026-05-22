import { describe, it, expect } from 'vitest'
import { isPathSafe, parseSafePaths, parseProtectedPaths, matchesPathList } from '../../src/main/services/cycle/path-safety'

const REPO_ROOT = '/fake/repo'

describe('isPathSafe', () => {
  const safePaths = ['src/**', 'tests/**']
  const protectedPaths = ['.env*', 'package.json']

  it('allows files in safe paths', () => {
    expect(isPathSafe('src/App.tsx', safePaths, protectedPaths, REPO_ROOT)).toBe(true)
    expect(isPathSafe('src/components/Button.tsx', safePaths, protectedPaths, REPO_ROOT)).toBe(true)
    expect(isPathSafe('tests/cycle/identity.test.ts', safePaths, protectedPaths, REPO_ROOT)).toBe(true)
  })

  it('blocks protected paths even if they would match safe patterns', () => {
    expect(isPathSafe('.env', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
    expect(isPathSafe('.env.local', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
    expect(isPathSafe('package.json', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
  })

  it('blocks files not in safe list', () => {
    expect(isPathSafe('docs/README.md', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
    expect(isPathSafe('scripts/deploy.sh', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
  })

  it('blocks path traversal attempts', () => {
    expect(isPathSafe('../secret.txt', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
    expect(isPathSafe('../../etc/passwd', safePaths, protectedPaths, REPO_ROOT)).toBe(false)
  })
})

describe('matchesPathList', () => {
  it('matches exact paths', () => {
    expect(matchesPathList('package.json', ['package.json'])).toBe(true)
  })

  it('matches prefix patterns (sans glob)', () => {
    expect(matchesPathList('src/App.tsx', ['src/**'])).toBe(true)
    expect(matchesPathList('src/deep/nested/file.ts', ['src/**'])).toBe(true)
  })

  it('does not match unrelated paths', () => {
    expect(matchesPathList('docs/README.md', ['src/**'])).toBe(false)
  })
})

describe('parseSafePaths / parseProtectedPaths', () => {
  const agentsContent = `
## Safe Paths
\`\`\`
src/**
tests/**
\`\`\`

## Protected Paths
\`\`\`
.env*
package.json
shared/schema.ts
\`\`\`
`

  it('parseSafePaths extracts safe paths from AGENTS.md', () => {
    const safe = parseSafePaths(agentsContent)
    expect(safe).toContain('src/**')
    expect(safe).toContain('tests/**')
  })

  it('parseProtectedPaths extracts protected paths', () => {
    const protected_ = parseProtectedPaths(agentsContent)
    expect(protected_).toContain('.env*')
    expect(protected_).toContain('package.json')
    expect(protected_).toContain('shared/schema.ts')
  })

  it('returns empty array when section missing', () => {
    expect(parseSafePaths('## No paths section')).toHaveLength(0)
    expect(parseProtectedPaths('## No paths section')).toHaveLength(0)
  })
})
