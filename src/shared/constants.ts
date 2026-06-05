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
  { row: number; frameCount: number; fps: number; loop: boolean; canMove?: boolean; speed?: number }
> = {
  // Row 0 — Idle: đứng yên, trạng thái mặc định
  idle:       { row: 0, frameCount: 8, fps: 4,  loop: true  },

  // Row 1 — Run: di chuyển/tuần tra
  walk:       { row: 1, frameCount: 8, fps: 5,  loop: true,  canMove: true, speed: 0.9 },
  run:        { row: 1, frameCount: 8, fps: 8,  loop: true,  canMove: true, speed: 1.8 },

  // Row 2 — Angry: bị click nhiều, cảnh báo bảo mật
  angry:      { row: 2, frameCount: 8, fps: 6,  loop: true  },

  // Row 3 — Greet: vẫy tay chào khi mới bật / click lần đầu
  greet:      { row: 3, frameCount: 8, fps: 6,  loop: false },
  happy:      { row: 3, frameCount: 8, fps: 6,  loop: false }, // alias

  // Row 4 — Sad: thị trường tụt, tài khoản bị trừ tiền, lỗi giao dịch
  sad:        { row: 4, frameCount: 8, fps: 5,  loop: false },
  stun:       { row: 4, frameCount: 8, fps: 5,  loop: false }, // alias

  // Row 5 — Dazed: bị kéo drag liên tục
  dazed:      { row: 5, frameCount: 8, fps: 7,  loop: true  },
  drag:       { row: 5, frameCount: 8, fps: 7,  loop: true  }, // alias

  // Row 6 — Save Money: nhặt coin, được cộng tiền, nhận quà
  save_money: { row: 6, frameCount: 8, fps: 6,  loop: false },
  eat:        { row: 6, frameCount: 8, fps: 6,  loop: false }, // alias

  // Row 7 — Thinking: Pomodoro focus, treo máy lâu
  think:      { row: 7, frameCount: 8, fps: 4,  loop: true  },

  // Row 8 — Bonk: bị gõ đầu qua blockchain event
  bonk:       { row: 8, frameCount: 8, fps: 8,  loop: false },
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
  SPEECH_SYNC_COOLDOWN: 15000,
  MAX_ACTIVE_PETS: 5,
  RANDOM_SPEECH_CHANCE: 0.05,
  RANDOM_SPEECH_INTERVAL: 60000,
} as const;

/** Blockchain Network & Package Configurations */
export const SUI_CONFIG = {
  NETWORK: 'testnet',
  RPC_URL: 'https://fullnode.testnet.sui.io:443',
  PACKAGE_ID: '0x01c0738baab1aa8413d6b450420f3085a670733416aa1dcdbaa2dabc05303f24',
  GLOBAL_CONFIG_ID: '0xe17fdfe50e0a04341dedaef56fe598293bf0317ed3b1f7541ab1421409d2c3ce',
  TOKEN_PACKAGE_ID: '0x86d199f688b48c1af1bbead183e9bcb080d1cc9cd600161421a0b189b95bc588',
  TOKEN_TYPE: '0x86d199f688b48c1af1bbead183e9bcb080d1cc9cd600161421a0b189b95bc588::pet_token::PET_TOKEN',
  USDC_TYPE: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  TREASURY_ADDRESS: '0xffc5bb02aa137b5df823f9a241196866a827f352b80c8c5d88e757d6a3e667f8',
} as const;

/** Local AI Configurations */
export const AI_CONFIG = {
  MODEL_NAME: 'minipet-qwen-model-SUI.gguf',
  MODEL_DOWNLOAD_URL: 'https://huggingface.co/iamquocbao/minipet-qwen-model-SUI/resolve/main/qwen-sui-q4_k_m.gguf',
  SERVER_PORT: 8080,
  CHAT_ENDPOINT: 'http://127.0.0.1:8080/v1/chat/completions',
} as const;

