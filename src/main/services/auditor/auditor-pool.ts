// Simple, correct concurrency pool with pause/resume/cancel.
// Avoids the ESM-only p-queue dependency while covering our specific needs.

type Task<T> = () => Promise<T>

interface QueueEntry<T> {
  task: Task<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class AuditorPool {
  private concurrency: number
  private running = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: Array<QueueEntry<any>> = []
  private _canceled = false
  private _paused = false

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, Math.min(concurrency, 8))
  }

  add<T>(task: Task<T>): Promise<T> {
    if (this._canceled) return Promise.reject(new Error('Pool canceled'))

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.tick()
    })
  }

  cancel(): void {
    this._canceled = true
    const pending = this.queue.splice(0)
    for (const entry of pending) {
      entry.reject(new Error('Audit canceled'))
    }
  }

  pause(): void {
    this._paused = true
  }

  resume(): void {
    this._paused = false
    this.tick()
  }

  get size(): number { return this.queue.length }
  get runningCount(): number { return this.running }
  get isCanceled(): boolean { return this._canceled }
  get isPaused(): boolean { return this._paused }

  private tick(): void {
    while (!this._paused && !this._canceled && this.running < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!
      this.running++
      entry.task().then(
        (value) => { this.running--; this.tick(); entry.resolve(value) },
        (err: unknown) => { this.running--; this.tick(); entry.reject(err) },
      )
    }
  }

  // Returns a promise that resolves when the queue is empty and all tasks complete.
  async idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.running === 0 && this.queue.length === 0) { resolve(); return }
        setTimeout(check, 50)
      }
      check()
    })
  }
}
