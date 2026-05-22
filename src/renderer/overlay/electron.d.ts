export interface ElectronAPI {
  getActivePet: () => Promise<any>;
  getPetList: () => Promise<any[]>;
  setActivePet: (slug: string) => Promise<void>;
  loadSpritesheet: (petSlug: string) => Promise<string>;
  getSettings: () => Promise<any>;
  updateSettings: (settings: Partial<any>) => Promise<void>;
  importPet: () => Promise<any[]>;
  importFolder: () => Promise<any[]>;
  deletePet: (slug: string) => Promise<any[]>;
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
  focus: () => void;
  setDragMode: (instanceId: string, enabled: boolean) => void;
  moveWindow: (deltaX: number, deltaY: number) => void;
  resizeWindow: (width: number, height: number, anchorBottom?: boolean) => void;
  startDragging: () => void;
  openSettings: () => void;
  onSettingsUpdate: (callback: (data: any) => void) => void;
  onNotification: (callback: (payload: any) => void) => void;
  
  // --- New Methods ---
  pingPet: () => void;
  onPing: (cb: () => void) => void;
  startAlarm: () => void;
  stopAlarm: () => void;
  onStartAlarm: (cb: () => void) => void;
  onStopAlarm: (cb: () => void) => void;
  savePosition: (instanceId: string, x?: number, y?: number) => void;
  getLogicalPosition: () => { x: number | null, y: number | null };
  resizeKeepBottom: (width: number, height: number) => void;
  updateSpeech: (text: string, visible: boolean, x: number, y: number) => void;
  toggleVisibility: () => void;
  exitApp: () => void;
  
  // --- Multi-Pet ---
  getInstanceConfig: (id: string) => Promise<any>;
  spawnPet: (slug: string) => Promise<any>;
  removePet: (id: string) => Promise<void>;
  onPositionsUpdate: (cb: (data: any) => void) => void;

  // --- Pomodoro ---
  startPomo: (focus: number, breakMin: number) => void;
  pausePomo: () => void;
  resetPomo: () => void;
  updatePomoConfig: (focus: number, breakMin: number) => void;
  getPomoState: () => Promise<any>;
  onPomoTick: (cb: (state: any) => void) => void;
  onPomoFinished: (cb: (sessionType: string) => void) => void;
  onPetSay: (cb: (text: string) => void) => void;
  eatFile: (paths: string[]) => Promise<{ success: boolean; error?: string }>;
  getPathForFile: (file: File) => string;

  // --- Intelligence ---
  getActiveApp: () => Promise<string | null>;
  getBrowserTab: (browser: string) => Promise<string | null>;

  // --- Speech synchronization ---
  notifySpeaking: () => void;
  onSomeoneSpeaking: (cb: () => void) => void;
  onWindowMoved: (cb: (x: number, y: number) => void) => void;
  onDragDrop: (cb: (type: string, paths: string[]) => void) => void;
  onBlockchainEvent: (cb: (event: any) => void) => void;
  broadcastPetEvent: (event: string, payload: any) => Promise<void>;
}
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
