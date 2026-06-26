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
  /** SUI Blockchain Integration */
  suiAddress: string;
  suiRpcUrl: string;
  suiEnabled: boolean;
  geminiApiKey: string;
  aiEnabled: boolean;
  fastTransferWallets?: { alias: string; address: string }[];
  agentAddress?: string;
  agentSecretKey?: string;
  zkLoginSession?: any;
  /** Simulated auto-trade configuration, keyed by wallet ('pet' | 'agent') */
  autoTrade?: Partial<Record<AutoTradeWallet, AutoTradeConfig>>;
}

/** Which wallet an auto-trade strategy runs on */
export type AutoTradeWallet = 'pet' | 'agent';

/** Simulated auto-trade strategy config for a single wallet */
export interface AutoTradeConfig {
  /** Whether the auto-trade loop is currently enabled (simulated) */
  enabled: boolean;
  /** Trade direction */
  action?: 'buy' | 'sell';
  /** Token symbol to trade (e.g. 'SUI') */
  token?: string;
  /** Amount per trade tick */
  amount?: number;
  /** Interval between trades, in minutes */
  interval_minutes?: number;
  /** On-chain environment the desired trade executes against */
  env?: 'testnet' | 'mainnet';
  /** Execution model when the owner activates the trade */
  mode?: 'once' | 'recurring';
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
  suiAddress: '',
  suiRpcUrl: 'https://fullnode.mainnet.sui.io:443',
  suiEnabled: true,
  geminiApiKey: '',
  aiEnabled: true,
};
