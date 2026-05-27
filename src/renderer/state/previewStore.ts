import { create } from 'zustand'
import type { DeviceSize, PreviewStatus, PreviewStatusEvent } from '../../shared/types'

interface PreviewState {
  status: PreviewStatus
  url: string | null
  stderrTail: string[]
  deviceSize: DeviceSize
  logsExpanded: boolean
  awaitingSetupComplete: boolean
  settingUp: boolean
  /** The webContentsId of the currently-mounted webview (set by PreviewPanel). */
  webContentsId: number | null

  handleStatusEvent: (event: PreviewStatusEvent, activeProjectId: string | null) => void
  setDeviceSize: (size: DeviceSize) => void
  setLogsExpanded: (v: boolean) => void
  setAwaitingSetupComplete: (v: boolean) => void
  setSettingUp: (v: boolean) => void
  setWebContentsId: (id: number | null) => void
  reset: () => void
}

const INITIAL: Pick<PreviewState, 'status' | 'url' | 'stderrTail' | 'awaitingSetupComplete' | 'settingUp' | 'webContentsId'> = {
  status: 'idle',
  url: null,
  stderrTail: [],
  awaitingSetupComplete: false,
  settingUp: false,
  webContentsId: null,
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
  setAwaitingSetupComplete: (v: boolean) => set({ awaitingSetupComplete: v }),
  setSettingUp: (v: boolean) => set({ settingUp: v }),
  setWebContentsId: (id: number | null) => set({ webContentsId: id }),

  reset: () => set({ ...INITIAL }),
}))
