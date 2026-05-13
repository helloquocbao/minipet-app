/** IPC Channel names — dùng enum để tránh typo */
export const IPC_CHANNELS = {
  // Pet management
  PET_GET_LIST: 'pet:get-list',
  PET_GET_ACTIVE: 'pet:get-active',
  PET_SET_ACTIVE: 'pet:set-active',
  PET_LOAD_SPRITESHEET: 'pet:load-spritesheet',
  PET_IMPORT: 'pet:import',
  PET_DELETE: 'pet:delete',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Window control
  WINDOW_SET_IGNORE_MOUSE: 'window:set-ignore-mouse',
  WINDOW_OPEN_SETTINGS: 'window:open-settings',

  // Intelligence
  PET_SAY: 'pet:say',
  FILE_EAT: 'file:eat',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
