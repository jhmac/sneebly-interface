// Auto-update via electron-updater pointing at GitHub Releases.
// Uncomment and configure once a GitHub release workflow is set up.
//
// import { autoUpdater } from 'electron-updater'
// import { app } from 'electron'
//
// autoUpdater.setFeedURL({
//   provider: 'github',
//   owner: 'jhmac',
//   repo: 'sneebly-interface',
// })
//
// export function initAutoUpdater(): void {
//   if (!app.isPackaged) return  // only run in packaged builds
//
//   autoUpdater.checkForUpdatesAndNotify()
//
//   autoUpdater.on('update-downloaded', (info) => {
//     console.log('[Sneebly] Update downloaded:', info.version)
//     // autoUpdater.quitAndInstall()  // uncomment to auto-install
//   })
//
//   autoUpdater.on('error', (err) => {
//     console.error('[Sneebly] Auto-updater error:', err.message)
//   })
// }

export function initAutoUpdater(): void {
  // No-op until GitHub Releases workflow is configured.
  // See README §Building a signed release.
}
