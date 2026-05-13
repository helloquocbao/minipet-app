/**
 * Tauri API adapter — drop-in replacement for window.electronAPI
 * Import this instead of using window.electronAPI directly.
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

// --- Pet ---
export const getInstalledPets = () => invoke('get_installed_pets');
export const getPetInstanceConfig = (instanceId: string) =>
  invoke('get_pet_instance_config', { instanceId });
export const spawnPet = (slug: string) => invoke('spawn_pet', { slug });
export const removePet = (instanceId: string) => invoke('remove_pet', { instanceId });
export const getSpritesheetUrl = (slug: string) => invoke('get_spritesheet_url', { slug });
export const setActive = (slug: string) => invoke('spawn_pet', { slug }); // legacy

// --- Settings ---
export const getSettings = () => invoke('get_settings');
export const updateSettings = (settings: Record<string, unknown>) =>
  invoke('update_settings', { settings });

// --- Window ---
export const setIgnoreMouseEvents = async (ignore: boolean, options?: { forward: boolean }) => {
  const win = getCurrentWebviewWindow();
  await win.setIgnoreCursorEvents(ignore);
};

export const setDragMode = (instanceId: string, enabled: boolean) =>
  invoke('set_drag_mode', { instanceId, enabled });

export const moveWindow = async (deltaX: number, deltaY: number) => {
  const win = getCurrentWebviewWindow();
  const pos = await win.outerPosition();
  await win.setPosition({ type: 'Physical', x: pos.x + Math.round(deltaX), y: pos.y + Math.round(deltaY) });
};

export const resizeWindow = async (width: number, height: number, _anchorBottom = true) => {
  const win = getCurrentWebviewWindow();
  await win.setSize({ type: 'Logical', width: Math.max(50, Math.round(width)), height: Math.max(50, Math.round(height)) });
};

export const savePosition = (instanceId: string, x: number, y: number) =>
  invoke('save_position', { instanceId, x, y });

export const openSettings = () => invoke('open_settings');

// --- File Eating ---
export const eatFiles = (paths: string[]) => invoke('eat_files', { paths });

// --- Pet Import/Delete ---
export const importPet = (sourcePath: string) => invoke('import_pet', { sourcePath });
export const deletePet = (slug: string) => invoke('delete_pet', { slug });

// --- Pomodoro ---
export const pomoGetState = () => invoke('pomo_get_state');
export const pomoStart = (focus: number, breakMin: number) =>
  invoke('pomo_start', { focus, breakMin });
export const pomoPause = () => invoke('pomo_pause');
export const pomoReset = () => invoke('pomo_reset');
export const pomoUpdateConfig = (focus: number, breakMin: number) =>
  invoke('pomo_update_config', { focus, breakMin });

// --- Events ---
export const onSettingsUpdate = (cb: (data: any) => void): Promise<UnlistenFn> =>
  listen('settings:update', (e) => cb(e.payload));

export const onPomoTick = (cb: (data: any) => void): Promise<UnlistenFn> =>
  listen('pomo:tick', (e) => cb(e.payload));

export const onPetSay = (cb: (text: string) => void): Promise<UnlistenFn> =>
  listen('pet:say', (e) => cb(e.payload as string));

export const onPetStartAlarm = (cb: () => void): Promise<UnlistenFn> =>
  listen('pet:start-alarm', () => cb());

export const onPetStopAlarm = (cb: () => void): Promise<UnlistenFn> =>
  listen('pet:stop-alarm', () => cb());

export const onPetPing = (cb: () => void): Promise<UnlistenFn> =>
  listen('pet:ping', () => cb());

export const onPositionsUpdated = (cb: (positions: any[]) => void): Promise<UnlistenFn> =>
  listen('pets:positions-updated', (e) => cb(e.payload as any[]));

export const onSomeoneSpeaking = (cb: () => void): Promise<UnlistenFn> =>
  listen('pet:someone-speaking', () => cb());

// --- Broadcast ---
export const broadcastPetEvent = (event: string, payload: any = {}) =>
  invoke('broadcast_pet_event', { event, payload });

export const emitSpeaking = () => emit('pet:speaking');
