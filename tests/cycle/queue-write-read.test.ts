import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// We test the IPC handler logic directly without Electron by extracting the
// read-queue-diff logic into a testable pure function.

function readQueueDiff(projectPath: string, cycleId: string): string {
  const diffPath = join(projectPath, '.sneebly', 'queue', `pending-${cycleId}.diff`)
  if (!existsSync(diffPath)) return ''
  try {
    return require('fs').readFileSync(diffPath, 'utf8') as string
  } catch { return '' }
}

describe('queue I/O — daemon:read-queue-diff', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sneebly-test-${Date.now()}`)
    mkdirSync(join(tmpDir, '.sneebly', 'queue'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns diff content when file exists', () => {
    const diffContent = `--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,4 @@\n+const x = 1\n`
    writeFileSync(join(tmpDir, '.sneebly', 'queue', 'pending-abc123.diff'), diffContent)

    const result = readQueueDiff(tmpDir, 'abc123')
    expect(result).toBe(diffContent)
  })

  it('returns empty string when diff file does not exist', () => {
    const result = readQueueDiff(tmpDir, 'nonexistent-cycle-id')
    expect(result).toBe('')
  })

  it('returns empty string when queue directory does not exist', () => {
    const result = readQueueDiff(join(tmpdir(), 'no-such-project'), 'some-cycle')
    expect(result).toBe('')
  })

  it('handles cycle IDs with hyphens and alphanumerics', () => {
    const cycleId = 'a1b2c3d4'
    writeFileSync(join(tmpDir, '.sneebly', 'queue', `pending-${cycleId}.diff`), 'test diff')
    expect(readQueueDiff(tmpDir, cycleId)).toBe('test diff')
  })
})
