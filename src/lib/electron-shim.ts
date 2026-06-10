/**
 * Electron API Shim for Tauri — provides window.electronAPI compatibility.
 * Import and call setupElectronShim() before any overlay/settings code runs.
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/window';

export function setupElectronShim() {
  const win = getCurrentWebviewWindow();
  // Cache logical position to avoid async outerPosition() race conditions
  // Using object property to avoid require-atomic-updates on plain let vars
  const cache = { x: null as number | null, y: null as number | null };

  // Sync cache from actual window position on init
  let cachedMonitorX = 0;
  let cachedMonitorY = 0;
  let cachedMonitorW = window.screen.availWidth;
  let cachedMonitorH = window.screen.availHeight;

  const updateMonitor = async () => {
    try {
      // Get work area from Rust — correctly excludes Dock (macOS) and Taskbar (Windows)
      const wa: any = await invoke('get_monitor_work_area');
      cachedMonitorX = wa.x;
      cachedMonitorY = wa.y;
      cachedMonitorW = wa.width;
      cachedMonitorH = wa.height;
    } catch {
      // fallback: use CSS screen dimensions
      const m = await (win as any).currentMonitor();
      if (m) {
        const dpr = window.devicePixelRatio || 1;
        cachedMonitorX = m.position.x / dpr;
        cachedMonitorY = m.position.y / dpr;
        cachedMonitorW = m.size.width / dpr;
        cachedMonitorH = m.size.height / dpr;
      }
    }
  };

  void win.outerPosition().then(pos => {
    const dpr = window.devicePixelRatio || 1;
    cache.x = pos.x / dpr;
    cache.y = pos.y / dpr;
  });
  void updateMonitor();


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
        if (!config.spritesheetPath.startsWith('http')) {
          // Load spritesheet as base64 data URL - works in both dev and production
          config.spritesheetPath = await invoke('get_spritesheet_data', { slug: config.slug }).catch(() => '');
        }
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

    // --- Window ---
    setIgnoreMouseEvents: (ignore: boolean, _options?: { forward: boolean }) => {
      void win.setIgnoreCursorEvents(ignore);
    },
    focus: () => {
      void win.setFocus().catch(() => {});
    },
    setDragMode: (instanceId: string, enabled: boolean) => {
      void invoke('set_drag_mode', { instanceId, enabled });
    },
    moveWindow: async (deltaX: number, deltaY: number) => {
      const dpr = window.devicePixelRatio || 1;
      // Snapshot before any await to avoid require-atomic-updates
      let snapX = cache.x;
      let snapY = cache.y;
      if (snapX === null || snapY === null) {
        const outerPos = await win.outerPosition();
        snapX = outerPos.x / dpr;
        snapY = outerPos.y / dpr;
      }
      const nextX = snapX + deltaX;
      const nextY = snapY + deltaY;
      // eslint-disable-next-line require-atomic-updates
      cache.x = nextX;
      // eslint-disable-next-line require-atomic-updates
      cache.y = nextY;
      // Use round to avoid sub-pixel jitter in window position
      const rx = Math.round(nextX);
      const ry = Math.round(nextY);
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
          cache.x = newPos.x;
          cache.y = newPos.y;
        }
      } else {
        const dpr = window.devicePixelRatio || 1;
        // Snapshot before any await to avoid require-atomic-updates
        let snapX = cache.x;
        let snapY = cache.y;
        if (snapX === null || snapY === null) {
          const outerPos = await win.outerPosition();
          snapX = outerPos.x / dpr;
          snapY = outerPos.y / dpr;
        }
        const oldH = window.innerHeight;
        const deltaH = height - oldH;
        const nextY = snapY - deltaH;
        // eslint-disable-next-line require-atomic-updates
        cache.x = snapX;
        // eslint-disable-next-line require-atomic-updates
        cache.y = nextY;
        await win.setPosition(new LogicalPosition(snapX, nextY));
        await win.setSize(new LogicalSize(Math.max(50, width), Math.max(50, height)));
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
      
      let finalX = (x !== undefined) ? x : (cache.x || 0);
      let finalY = (y !== undefined) ? y : (cache.y || 0);

      if (finalX > screenW) finalX /= dpr;
      if (finalY > window.screen.height) finalY /= dpr;

      cache.x = finalX;
      cache.y = finalY;
      void invoke('save_position', { instanceId, x: finalX, y: finalY });
    },
    getLogicalPosition: () => ({ x: cache.x, y: cache.y }),
    getMonitorBounds: () => ({ x: cachedMonitorX, y: cachedMonitorY, width: cachedMonitorW, height: cachedMonitorH }),

    // --- Events ---
    onSettingsUpdate: (cb: (data: any) => void) => {
      void listen('settings:update', (e) => cb({ settings: e.payload }));
    },
    onNotification: (_cb: (payload: any) => void) => {},
    onPing: (cb: () => void) => { void listen('pet:ping', () => cb()); },
    onStartAlarm: (cb: () => void) => { void listen('pet:start-alarm', () => cb()); },
    onStopAlarm: (cb: () => void) => { void listen('pet:stop-alarm', () => cb()); },
    onPositionsUpdate: (cb: (data: any) => void) => {
      void listen('pets:positions-updated', (e) => cb({ positions: e.payload }));
    },
    onPomoTick: (cb: (state: any) => void) => { void listen('pomo:tick', (e) => cb(e.payload)); },
    onPomoFinished: (cb: (sessionType: string) => void) => { void listen('pomo:finished', (e) => cb(e.payload as string)); },
    onPetSay: (cb: (payload: any) => void) => { void listen('pet:say', (e) => cb(e.payload)); },
    onSomeoneSpeaking: (cb: () => void) => { void listen('pet:someone-speaking', () => cb()); },
    onWindowMoved: (cb: (x: number, y: number) => void) => {
      void win.onMoved((event) => {
        void updateMonitor(); // refresh work area bounds (handles monitor switch)
        const pos = event.payload;
        const dpr = window.devicePixelRatio || 1;
        cache.x = pos.x / dpr;
        cache.y = pos.y / dpr;
        cb(cache.x, cache.y);
      });
    },
    onBlockchainEvent: (cb: (event: any) => void) => { void listen('blockchain:event', (e) => cb(e.payload)); },

    // --- Pomodoro ---
    startPomo: (focus: number, breakMin: number) => invoke('pomo_start', { focus, breakMin }),
    pausePomo: () => invoke('pomo_pause'),
    resetPomo: () => invoke('pomo_reset'),
    updatePomoConfig: (focus: number, breakMin: number) => invoke('pomo_update_config', { focus, breakMin }),
    getPomoState: () => invoke('pomo_get_state'),

    // --- File Eating ---
    eatFile: (paths: string[]) => invoke('eat_files', { paths }),
    getPathForFile: (file: File) => (file as any).path || '',

    // --- Intelligence ---
    getActiveApp: () => invoke('get_active_app'),
    getBrowserTab: (browser: string) => invoke('get_browser_tab', { browser }),
    getBrowserUrl: (browser: string) => invoke('get_browser_url', { browser }),

    onDragDrop: (cb: (type: string, paths: string[]) => void) => {
      void win.onDragDropEvent((event) => {
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
    reRaiseWindow: (instanceId: string) => invoke('re_raise_window', { instanceId }),
    onCustomEvent: (eventName: string, cb: (payload: any) => void) => {
      void listen(eventName, (e) => cb(e.payload));
    },
    broadcastPetEvent: (event: string, payload: any) => 
      invoke('broadcast_pet_event', { event, payload })
        .catch(err => console.error(`[Shim] broadcastPetEvent failed for ${event}:`, err)),
  };
}
