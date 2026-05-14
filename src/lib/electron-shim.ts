/**
 * Electron API Shim for Tauri — provides window.electronAPI compatibility.
 * Import and call setupElectronShim() before any overlay/settings code runs.
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/window';

console.log('[Shim] electron-shim.ts module loaded');

// Convert absolute file path to asset:// URL without double-encoding slashes
function toAssetUrl(path: string): string {
  if (!path) return path;
  // Encode only special chars, NOT forward slashes
  const encoded = path.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return `asset://localhost${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

export function setupElectronShim() {
  console.log('[Shim] setupElectronShim() called');
  const win = getCurrentWebviewWindow();
  // Cache logical position to avoid async outerPosition() race conditions
  let cachedX: number | null = null;
  let cachedY: number | null = null;

  // Sync cache from actual window position on init
  win.outerPosition().then(pos => {
    const dpr = window.devicePixelRatio || 1;
    cachedX = pos.x / dpr;
    cachedY = pos.y / dpr;
  });


  console.log('[Shim] Setting window.electronAPI');
  (window as any).electronAPI = {
    // --- Pet ---
    getActivePet: () => invoke('get_installed_pets'),
    getPetList: async () => {
      const pets: any[] = await invoke('get_installed_pets');
      // Convert each thumbnail path to base64 data URL
      return Promise.all(pets.map(async p => ({
        ...p,
        thumbnailPath: await invoke('get_spritesheet_data', { slug: p.slug }).catch(() => ''),
      })));
    },
    setActivePet: (slug: string) => invoke('spawn_pet', { slug }),
    loadSpritesheet: (petSlug: string) => invoke('get_spritesheet_url', { slug: petSlug }),
    getInstanceConfig: async (id: string) => {
      const config: any = await invoke('get_pet_instance_config', { instanceId: id });
      if (config?.spritesheetPath) {
        // Load spritesheet as base64 data URL - works in both dev and production
        config.spritesheetPath = await invoke('get_spritesheet_data', { slug: config.slug }).catch(() => '');
      }
      return config;
    },
    spawnPet: (slug: string) => invoke('spawn_pet', { slug }),
    removePet: (id: string) => invoke('remove_pet', { instanceId: id }),

    // --- Settings ---
    getSettings: () => invoke('get_settings'),
    updateSettings: (settings: any) => invoke('update_settings', { settings }),
    importPet: async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'MiniPet', extensions: ['zip', 'json', 'png', 'webp'] }],
      });
      if (selected) return invoke('import_pet', { sourcePath: selected });
      return null;
    },
    importFolder: async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (selected) return invoke('import_pet', { sourcePath: selected });
      return null;
    },
    deletePet: (slug: string) => invoke('delete_pet', { slug }),

    // --- Window ---
    setIgnoreMouseEvents: (ignore: boolean, _options?: { forward: boolean }) => {
      win.setIgnoreCursorEvents(ignore);
    },
    focus: () => {
      win.setFocus().catch(() => {});
    },
    setDragMode: (instanceId: string, enabled: boolean) => {
      invoke('set_drag_mode', { instanceId, enabled });
    },
    moveWindow: async (deltaX: number, deltaY: number) => {
      const dpr = window.devicePixelRatio || 1;
      if (cachedX === null || cachedY === null) {
        const pos = await win.outerPosition();
        cachedX = pos.x / dpr;
        cachedY = pos.y / dpr;
      }
      cachedX += deltaX;
      cachedY += deltaY;
      // Use round to avoid sub-pixel jitter in window position
      const rx = Math.round(cachedX);
      const ry = Math.round(cachedY);
      await win.setPosition(new LogicalPosition(rx, ry));
    },
    resizeWindow: async (width: number, height: number) => {
      await win.setSize(new LogicalSize(Math.max(50, width), Math.max(50, height)));
    },
    startDragging: () => win.startDragging(),
    // Atomic resize+move to keep bottom edge fixed (used by syncWindowSize)
    resizeKeepBottom: async (width: number, height: number) => {
      const params = new URLSearchParams(window.location.search);
      const instanceId = params.get('id');
      if (instanceId) {
        const newPos: any = await invoke('resize_window_keep_bottom', { instanceId, width, height });
        if (newPos) {
          cachedX = newPos.x;
          cachedY = newPos.y;
        }
      } else {
        const dpr = window.devicePixelRatio || 1;
        if (cachedX === null || cachedY === null) {
          const pos = await win.outerPosition();
          cachedX = pos.x / dpr;
          cachedY = pos.y / dpr;
        }
        const oldH = window.innerHeight;
        const deltaH = height - oldH;
        cachedY -= deltaH;
        await win.setPosition(new LogicalPosition(cachedX, cachedY));
        await win.setSize(new LogicalSize(Math.max(50, width), Math.max(50, height)));
      }
    },
    updateSpeech: (text: string, visible: boolean, x: number, y: number) => {
      const params = new URLSearchParams(window.location.search);
      const instanceId = params.get('id');
      if (instanceId) {
        invoke('update_speech_window', { instanceId, text, visible, x, y });
      }
    },
    toggleVisibility: () => invoke('toggle_visibility'),
    exitApp: () => invoke('exit_app'),
    openSettings: () => invoke('open_settings'),
    open_url: (url: string) => invoke('open_url', { url }),
    suiRpcCall: (method: string, params: any[], rpc_url: string) => invoke('sui_rpc_call', { method, params, rpcUrl: rpc_url }),
    savePosition: (instanceId: string, x?: number, y?: number) => {
      const dpr = window.devicePixelRatio || 1;
      // Heuristic: if x/y are missing or seem physical (> screen width), use cache or convert.
      // window.screenX can be physical on some platforms in WRY/Tauri.
      const screenW = window.screen.width;
      
      let finalX = (x !== undefined) ? x : (cachedX || 0);
      let finalY = (y !== undefined) ? y : (cachedY || 0);

      if (finalX > screenW) finalX /= dpr;
      if (finalY > window.screen.height) finalY /= dpr;

      cachedX = finalX;
      cachedY = finalY;
      invoke('save_position', { instanceId, x: finalX, y: finalY });
    },
    getLogicalPosition: () => ({ x: cachedX, y: cachedY }),

    // --- Events ---
    onSettingsUpdate: (cb: (data: any) => void) => {
      listen('settings:update', (e) => cb({ settings: e.payload }));
    },
    onNotification: (_cb: (payload: any) => void) => {},
    onPing: (cb: () => void) => { listen('pet:ping', () => cb()); },
    onStartAlarm: (cb: () => void) => { listen('pet:start-alarm', () => cb()); },
    onStopAlarm: (cb: () => void) => { listen('pet:stop-alarm', () => cb()); },
    onPositionsUpdate: (cb: (data: any) => void) => {
      listen('pets:positions-updated', (e) => cb({ positions: e.payload }));
    },
    onPomoTick: (cb: (state: any) => void) => { listen('pomo:tick', (e) => cb(e.payload)); },
    onPomoFinished: (cb: (sessionType: string) => void) => { listen('pomo:finished', (e) => cb(e.payload as string)); },
    onPetSay: (cb: (text: string) => void) => { listen('pet:say', (e) => cb(e.payload as string)); },
    onSomeoneSpeaking: (cb: () => void) => { listen('pet:someone-speaking', () => cb()); },
    onWindowMoved: (cb: (x: number, y: number) => void) => {
      win.onMoved((event) => {
        const pos = event.payload;
        const dpr = window.devicePixelRatio || 1;
        cachedX = pos.x / dpr;
        cachedY = pos.y / dpr;
        cb(cachedX, cachedY);
      });
    },
    onBlockchainEvent: (cb: (event: any) => void) => { listen('blockchain:event', (e) => cb(e.payload)); },

    // --- Pomodoro ---
    startPomo: (focus: number, breakMin: number) => invoke('pomo_start', { focus, breakMin }),
    pausePomo: () => invoke('pomo_pause'),
    resetPomo: () => invoke('pomo_reset'),
    updatePomoConfig: (focus: number, breakMin: number) => invoke('pomo_update_config', { focus, breakMin }),
    getPomoState: () => invoke('pomo_get_state'),

    // --- File Eating ---
    eatFile: (paths: string[]) => invoke('eat_files', { paths }),
    getPathForFile: (file: File) => (file as any).path || '',

    onDragDrop: (cb: (type: string, paths: string[]) => void) => {
      win.onDragDropEvent((event) => {
        if (event.payload.type === 'enter') cb('enter', event.payload.paths);
        else if (event.payload.type === 'leave') cb('leave', []);
        else if (event.payload.type === 'drop') cb('drop', event.payload.paths);
      });
    },

    // --- Broadcast ---
    pingPet: () => emit('pet:ping'),
    startAlarm: () => invoke('broadcast_pet_event', { event: 'pet:start-alarm', payload: {} }),
    stopAlarm: () => invoke('broadcast_pet_event', { event: 'pet:stop-alarm', payload: {} }),
    notifySpeaking: () => invoke('broadcast_pet_event', { event: 'pet:someone-speaking', payload: {} }),
    broadcastPetEvent: (event: string, payload: any) => 
      invoke('broadcast_pet_event', { event, payload })
        .catch(err => console.error(`[Shim] broadcastPetEvent failed for ${event}:`, err)),
  };
}
