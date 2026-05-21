import keytar from 'keytar'
import Store from 'electron-store'

const SERVICE = 'sneebly-interface'
const store = new Store()

function accountKey(projectId: string, name: string): string {
  return `${projectId}:${name}`
}

function indexKey(projectId: string): string {
  return `secrets.${projectId}`
}

function getIndex(projectId: string): string[] {
  return store.get(indexKey(projectId), []) as string[]
}

function setIndex(projectId: string, names: string[]): void {
  store.set(indexKey(projectId), [...new Set(names)])
}

export async function listSecretNames(projectId: string): Promise<string[]> {
  return getIndex(projectId)
}

export async function getSecret(projectId: string, name: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, accountKey(projectId, name))
}

export async function setSecret(projectId: string, name: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, accountKey(projectId, name), value)
  const names = getIndex(projectId)
  if (!names.includes(name)) setIndex(projectId, [...names, name])
}

export async function deleteSecret(projectId: string, name: string): Promise<void> {
  await keytar.deletePassword(SERVICE, accountKey(projectId, name))
  setIndex(projectId, getIndex(projectId).filter((n) => n !== name))
}

export async function getAllSecrets(projectId: string): Promise<Record<string, string>> {
  const names = getIndex(projectId)
  const entries = await Promise.all(
    names.map(async (name) => {
      const val = await keytar.getPassword(SERVICE, accountKey(projectId, name))
      return [name, val ?? ''] as [string, string]
    })
  )
  return Object.fromEntries(entries)
}
