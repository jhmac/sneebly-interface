const store = new Map<string, string>()

export function getPassword(service: string, account: string): Promise<string | null> {
  return Promise.resolve(store.get(`${service}:${account}`) ?? null)
}

export function setPassword(service: string, account: string, password: string): Promise<void> {
  store.set(`${service}:${account}`, password)
  return Promise.resolve()
}

export function deletePassword(service: string, account: string): Promise<boolean> {
  const key = `${service}:${account}`
  const existed = store.has(key)
  store.delete(key)
  return Promise.resolve(existed)
}

export function __reset() {
  store.clear()
}

export default { getPassword, setPassword, deletePassword }
