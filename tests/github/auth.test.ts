import { describe, it, expect, beforeEach } from 'vitest'
import { getStoredToken, storeToken, clearToken } from '../../src/main/services/github-auth'

// keytar is aliased to tests/__mocks__/keytar.ts in vitest.config.ts
// @octokit/* are not exercised here — they need a live token
import * as keytarMock from '../__mocks__/keytar'

beforeEach(() => {
  keytarMock.__reset()
})

describe('token storage', () => {
  it('returns null when no token stored', async () => {
    const token = await getStoredToken()
    expect(token).toBeNull()
  })

  it('stores and retrieves a token', async () => {
    await storeToken('ghp_test123')
    const token = await getStoredToken()
    expect(token).toBe('ghp_test123')
  })

  it('overwrites existing token', async () => {
    await storeToken('ghp_first')
    await storeToken('ghp_second')
    const token = await getStoredToken()
    expect(token).toBe('ghp_second')
  })

  it('clearToken removes the stored token', async () => {
    await storeToken('ghp_test456')
    await clearToken()
    const token = await getStoredToken()
    expect(token).toBeNull()
  })

  it('clearToken is safe when no token exists', async () => {
    await expect(clearToken()).resolves.not.toThrow()
    expect(await getStoredToken()).toBeNull()
  })
})
