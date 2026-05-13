/** Trạng thái animation của pet */
export type PetState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'fall'
  | 'drag'
  | 'sleep'
  | 'notify'
  | 'happy'
  | 'eat';

/** Cấu hình animation cho 1 state */
export interface AnimationConfig {
  /** Row index trong spritesheet (0-indexed) */
  row: number;
  /** Số frames trong row này */
  frameCount: number;
  /** Frames per second */
  fps: number;
  /** true = lặp vô hạn, false = chạy 1 lần rồi fallback */
  loop: boolean;
  /** State fallback khi animation kết thúc (chỉ dùng khi loop=false) */
  nextState?: PetState;
  /** Cho phép di chuyển cửa sổ khi play animation này */
  canMove?: boolean;
  /** Tốc độ di chuyển (mặc định 1.5) */
  speed?: number;
}

/** PetDex-compatible manifest (pet.json) */
export interface PetManifest {
  /** Tên hiển thị */
  displayName: string;
  /** Mô tả ngắn */
  description: string;
  /** Slug identifier (dùng làm folder name) */
  slug: string;
  /** Đường dẫn tới spritesheet (relative) */
  spritesheetPath: string;
  /** Kích thước 1 frame (pixel) */
  frameSize: {
    width: number; // PetDex standard: 192
    height: number; // PetDex standard: 208
  };
  /** Số cột trong spritesheet */
  columns: number; // PetDex standard: 8
  /** Số hàng trong spritesheet */
  rows: number; // PetDex standard: 9
  /** Map state → animation config. Nếu không có, dùng default mapping */
  animations?: Partial<Record<PetState, AnimationConfig>>;
  /** Credit info */
  author?: string;
  /** Tags */
  tags?: string[];
}

/** Runtime pet data (loaded + ready) */
export interface LoadedPet {
  manifest: PetManifest;
  /** Absolute path tới pet folder */
  basePath: string;
  /** Absolute path tới spritesheet file */
  spritesheetPath: string;
}

/** Pet trong gallery list */
export interface PetListItem {
  slug: string;
  displayName: string;
  description: string;
  /** Thumbnail preview (base64 hoặc path) */
  thumbnailPath: string;
  isActive: boolean;
  isDefault: boolean;
}
