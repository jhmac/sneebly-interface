import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
  outDir: 'dist',
  packagerConfig: {
    appBundleId: 'com.scuild.sneebly-interface',
    appCategoryType: 'public.app-category.developer-tools',
    icon: 'resources/icon',
    asar: true,
    // Exclude source files, dev tooling, and temp build artifacts from the bundle
    ignore: [
      /^\/src\//,
      /^\/\.git\//,
      /^\/\.gitignore$/,
      /^\/electron\.vite\.config/,
      /^\/tsconfig/,
      /^\/forge\.config/,
      /^\/README\.md$/,
      /^\/SPEC\.md$/,
      /^\/ROADMAP\.md$/,
      /^\/CLAUDE\.md$/,
      /^\/.npmrc$/,
      /^\/resources\/icon\.iconset\//,
    ],
    // Code signing — only active when APPLE_ID env var is set
    ...(process.env['APPLE_ID']
      ? {
          osxSign: {
            identity: `Developer ID Application: ${process.env['APPLE_TEAM_ID']}`,
          },
          osxNotarize: {
            appleId: process.env['APPLE_ID']!,
            appleIdPassword: process.env['APPLE_PASSWORD']!,
            teamId: process.env['APPLE_TEAM_ID']!,
          },
        }
      : {}),
  },

  makers: [
    new MakerDMG({
      name: 'SneeblyInterface',
      icon: 'resources/icon.icns',
      overwrite: true,
    }),
    new MakerZIP({}, ['darwin']),
  ],

  // Build with `npm run build` before running `npm run make`.
  // The make script in package.json handles this: "electron-vite build && electron-forge make"
}

export default config
