import { create } from 'zustand'
import type { DeviceSize, PreviewStatus, PreviewStatusEvent } from '../../shared/types'

interface PreviewState {
  status: PreviewStatus
  url: string | null
  stderrTail: string[]
  deviceSize: DeviceSize
  logsExpanded: boolean

  handleStatusEvent: (event: PreviewStatusEvent, activeProjectId: string | null) => void
  setDeviceSize: (size: DeviceSize) => void
  setLogsExpanded: (v: boolean) => void
  reset: () => void
}

const INITIAL: Pick<PreviewState, 'status' | 'url' | 'stderrTail'> = {
  status: 'idle',
  url: null,
  stderrTail: [],
}

export const usePreviewStore = create<PreviewState>((set) => ({
  ...INITIAL,
  deviceSize: 'desktop',
  logsExpanded: false,

  handleStatusEvent: (event: PreviewStatusEvent, activeProjectId: string | null) => {
    if (event.projectId !== activeProjectId) return
    set({
      status: event.type,
      url: event.url ?? null,
      stderrTail: event.stderrTail ?? [],
    })
  },

  setDeviceSize: (size: DeviceSize) => set({ deviceSize: size }),
  setLogsExpanded: (v: boolean) => set({ logsExpanded: v }),

  reset: () => set({ ...INITIAL }),
}))
