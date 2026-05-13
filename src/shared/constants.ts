/** PetDex spritesheet standard dimensions */
export const PETDEX_SPRITE = {
  FRAME_WIDTH: 192,
  FRAME_HEIGHT: 208,
  COLUMNS: 8,
  ROWS: 9,
  TOTAL_FRAMES: 72,
  SHEET_WIDTH: 1536, // 192 * 8
  SHEET_HEIGHT: 1872, // 208 * 9
} as const;

/** Default animation mapping for the spritesheet */
export const DEFAULT_ANIMATIONS: Record<
  string,
  { row: number; frameCount: number; fps: number; loop: boolean }
> = {
  idle: { row: 0, frameCount: 6, fps: 3, loop: true },
  walk: { row: 1, frameCount: 8, fps: 5, loop: true },
  run: { row: 2, frameCount: 8, fps: 8, loop: true },
  jump: { row: 4, frameCount: 5, fps: 4, loop: false },
  fall: { row: 4, frameCount: 5, fps: 4, loop: false },
  drag: { row: 5, frameCount: 8, fps: 3, loop: true },
  sleep: { row: 6, frameCount: 6, fps: 1, loop: true },
  notify: { row: 3, frameCount: 4, fps: 4, loop: false },
  happy: { row: 3, frameCount: 4, fps: 5, loop: false },
  eat: { row: 7, frameCount: 8, fps: 12, loop: false },
};

/** Overlay window dimensions (Enough for 2x scale: 384x416) */
export const OVERLAY_WINDOW = {
  WIDTH: 400,
  HEIGHT: 440,
  DEFAULT_X: 200,
  DEFAULT_Y: 200,
} as const;

/** Settings window dimensions */
export const SETTINGS_WINDOW = {
  WIDTH: 720,
  HEIGHT: 500,
} as const;

/** Shared App Paths */
export const APP_PATHS = {
  PETS_DIR: 'pets',
  SETTINGS_FILE: 'settings.json',
  DEFAULT_PETS_ASSETS: 'default-pets',
  ICONS_ASSETS: 'icons',
} as const;

/** Interaction Constants */
export const INTERACTION = {
  SPEECH_DURATION_DEFAULT: 4000,
  SPEECH_DURATION_LONG: 30000,
  SPEECH_SYNC_COOLDOWN: 10000,
  MAX_ACTIVE_PETS: 5,
  RANDOM_SPEECH_CHANCE: 0.1,
  RANDOM_SPEECH_INTERVAL: 15000,
} as const;
