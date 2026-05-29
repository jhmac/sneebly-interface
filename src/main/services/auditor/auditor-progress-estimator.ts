interface ProgressSample {
  ts: number
  filesProcessed: number
}

export class ProgressEstimator {
  private samples: ProgressSample[] = []
  private totalFiles: number

  constructor(totalFiles: number) {
    this.totalFiles = totalFiles
    this.samples.push({ ts: Date.now(), filesProcessed: 0 })
  }

  update(filesProcessed: number): void {
    this.samples.push({ ts: Date.now(), filesProcessed })
    // Keep only last 20 samples for rolling average
    if (this.samples.length > 20) this.samples.shift()
  }

  estimateRemainingMs(filesProcessed: number): number {
    if (this.samples.length < 2 || filesProcessed === 0) return 0

    const oldest = this.samples[0]!
    const newest = this.samples[this.samples.length - 1]!
    const elapsedMs = newest.ts - oldest.ts
    const processed = newest.filesProcessed - oldest.filesProcessed

    if (processed === 0 || elapsedMs === 0) return 0

    const ratePerMs = processed / elapsedMs
    const remaining = this.totalFiles - filesProcessed
    return Math.ceil(remaining / ratePerMs)
  }
}
