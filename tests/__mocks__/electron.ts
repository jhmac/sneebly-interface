// Minimal electron mock for vitest (Node environment, no Electron binary)
export const app = {
  getPath: (name: string) => `/tmp/sneebly-test/${name}`,
  getVersion: () => '0.2.0-alpha',
  isPackaged: false,
  on: () => {},
  whenReady: () => Promise.resolve(),
  quit: () => {},
}

export const BrowserWindow = {
  getAllWindows: () => [],
}

export const ipcMain = {
  handle: () => {},
  on: () => {},
}

export const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on: () => {},
  removeListener: () => {},
}

export const contextBridge = {
  exposeInMainWorld: () => {},
}

export const Notification = class {
  constructor(_opts: { title: string; body: string }) {}
  show() {}
}

export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
}

export const shell = {
  openExternal: () => Promise.resolve(),
}
