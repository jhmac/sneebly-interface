export const IPC_CHANNELS = {
  PING: 'ping',
  LAYOUT_GET_SIZES: 'layout:get-sizes',
  LAYOUT_SET_SIZES: 'layout:set-sizes',
  PROJECT_LIST: 'project:list',
  PROJECT_OPEN_DIALOG: 'project:open-dialog',
  PROJECT_ACTIVATE: 'project:activate',
  PREVIEW_START: 'preview:start',
  PREVIEW_STOP: 'preview:stop',
  PREVIEW_RESTART: 'preview:restart',
  PREVIEW_GET_LOGS: 'preview:get-logs',
  PREVIEW_STATUS: 'preview:status',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
} as const
