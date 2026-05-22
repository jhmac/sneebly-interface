import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Mock electron so cycle modules can import without a running Electron process
    alias: {
      electron: '/Users/mister/sneebly-interface/tests/__mocks__/electron.ts',
      'electron-store': '/Users/mister/sneebly-interface/tests/__mocks__/electron-store.ts',
      keytar: '/Users/mister/sneebly-interface/tests/__mocks__/keytar.ts',
    },
  },
})
