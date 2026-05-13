export type PetPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export interface PetInstance {
  /** Unique ID for the specific pet instance */
  id: string;
  /** Slug of the pet type */
  slug: string;
  /** X coordinate on screen */
  x: number;
  /** Y coordinate on screen */
  y: number;
  /** Custom scale for this instance */
  scale: number;
}

export interface UserSettings {
  /** List of currently active pet instances (Multi-Pet support) */
  activePets: PetInstance[];
  /** Primary pet slug (legacy support) */
  activePetSlug: string | null;
  /** Default pet screen corner position */
  position: PetPosition;
  /** Global scale factor (0.5 to 2.0) */
  scale: number;
  /** Whether pets can wander around the screen */
  enableWalking: boolean;
  /** Legacy auto-start setting */
  autoStart: boolean;
  /** Whether to show speech bubble notifications */
  enableNotifications: boolean;
  /** Whether the app should launch at system startup */
  launchAtStartup: boolean;
  /** Last known X coordinate of the primary pet */
  lastX: number | null;
  /** Last known Y coordinate of the primary pet */
  lastY: number | null;
  /** App display language */
  language: 'en' | 'vi' | 'fr' | 'zh' | 'it';
}

export const DEFAULT_SETTINGS: UserSettings = {
  activePets: [],
  activePetSlug: null,
  position: 'bottom-right',
  scale: 1.0,
  enableWalking: true,
  autoStart: false,
  enableNotifications: true,
  launchAtStartup: false,
  lastX: null,
  lastY: null,
  language: 'en',
};
