export interface PongPayload {
  message: string
  timestamp: number
}

export interface LayoutSizes {
  vertical: Record<string, number>
  horizontal: Record<string, number>
}

export interface ElectronAPI {
  ping: () => Promise<PongPayload>
  layoutGetSizes: () => Promise<LayoutSizes | null>
  layoutSetSizes: (sizes: LayoutSizes) => Promise<void>
}
