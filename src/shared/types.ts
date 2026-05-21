export interface PongPayload {
  message: string
  timestamp: number
}

export interface ElectronAPI {
  ping: () => Promise<PongPayload>
}
