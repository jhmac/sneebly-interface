// In-memory electron-store mock for tests — singleton data map shared across all instances
let data: Record<string, unknown> = {}

function getNestedKey(obj: Record<string, unknown>, parts: string[]): unknown {
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function setNestedKey(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (current[part] == null || typeof current[part] !== 'object') current[part] = {}
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]!] = value
}

export default class Store {
  get(key: string, defaultValue?: unknown): unknown {
    const result = getNestedKey(data, key.split('.'))
    return result === undefined ? defaultValue : result
  }

  set(key: string, value: unknown): void {
    setNestedKey(data, key.split('.'), value)
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): void {
    this.set(key, undefined)
  }

  clear(): void {
    data = {}
  }

  static _reset(): void {
    data = {}
  }
}
