# Tasks — Phase 4: Feature Parity

---

## TASK-11: Implement PomodoroManager in Rust
**Status**: ⬜ TODO
**Phase**: 4
**Depends on**: TASK-10
**Blocks**: TASK-17

### Goal
Port `src/main/pet/pomodoro-manager.ts` sang Rust. Timer chạy background, broadcast tick mỗi giây.

### File: `src-tauri/src/pet/pomodoro.rs`

```rust
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio::task::JoinHandle;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PomodoroStatus {
    Idle,
    Focus,
    Break,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PomodoroState {
    #[serde(rename = "timeLeft")]
    pub time_left: u32,
    #[serde(rename = "isWorkSession")]
    pub is_work_session: bool,
    pub status: PomodoroStatus,
    #[serde(rename = "focusMinutes")]
    pub focus_minutes: u32,
    #[serde(rename = "breakMinutes")]
    pub break_minutes: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished: Option<bool>,
}

pub struct PomodoroManager {
    pub time_left: u32,
    pub is_work_session: bool,
    pub focus_minutes: u32,
    pub break_minutes: u32,
    pub status: PomodoroStatus,
    timer_handle: Option<JoinHandle<()>>,
}

impl PomodoroManager {
    pub fn new() -> Self {
        Self {
            time_left: 25 * 60,
            is_work_session: true,
            focus_minutes: 25,
            break_minutes: 5,
            status: PomodoroStatus::Idle,
            timer_handle: None,
        }
    }

    pub fn get_state(&self) -> PomodoroState {
        PomodoroState {
            time_left: self.time_left,
            is_work_session: self.is_work_session,
            status: self.status.clone(),
            focus_minutes: self.focus_minutes,
            break_minutes: self.break_minutes,
            finished: None,
        }
    }

    pub fn start(shared: Arc<Mutex<Self>>, app: AppHandle) {
        let mut mgr = shared.lock().unwrap();
        if mgr.timer_handle.is_some() { return; }

        if mgr.status == PomodoroStatus::Idle {
            mgr.time_left = if mgr.is_work_session {
                mgr.focus_minutes * 60
            } else {
                mgr.break_minutes * 60
            };
        }
        mgr.status = if mgr.is_work_session {
            PomodoroStatus::Focus
        } else {
            PomodoroStatus::Break
        };

        let shared_clone = Arc::clone(&shared);
        let app_clone = app.clone();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(
                std::time::Duration::from_secs(1)
            );
            loop {
                interval.tick().await;
                let mut mgr = shared_clone.lock().unwrap();
                if mgr.timer_handle.is_none() { break; }

                if mgr.time_left > 0 {
                    mgr.time_left -= 1;
                    let state = mgr.get_state();
                    drop(mgr);
                    let _ = app_clone.emit("pomo:tick", state);
                } else {
                    // Session ended
                    mgr.timer_handle = None;
                    let _ = app_clone.emit("pet:start-alarm", ());
                    mgr.is_work_session = !mgr.is_work_session;
                    mgr.time_left = if mgr.is_work_session {
                        mgr.focus_minutes * 60
                    } else {
                        mgr.break_minutes * 60
                    };
                    mgr.status = PomodoroStatus::Idle;
                    let mut finished_state = mgr.get_state();
                    finished_state.finished = Some(true);
                    drop(mgr);
                    let _ = app_clone.emit("pomo:tick", finished_state);
                    break;
                }
            }
        });

        shared.lock().unwrap().timer_handle = Some(handle);
    }

    pub fn pause(&mut self) {
        if let Some(handle) = self.timer_handle.take() {
            handle.abort();
        }
        self.status = PomodoroStatus::Idle;
    }

    pub fn reset(&mut self, app: &AppHandle) {
        self.pause();
        self.is_work_session = true;
        self.time_left = self.focus_minutes * 60;
        self.status = PomodoroStatus::Idle;
        let _ = app.emit("pomo:tick", self.get_state());
    }

    pub fn update_config(&mut self, focus: u32, break_min: u32, app: &AppHandle) {
        self.focus_minutes = focus;
        self.break_minutes = break_min;
        if self.status == PomodoroStatus::Idle {
            self.time_left = if self.is_work_session {
                focus * 60
            } else {
                break_min * 60
            };
            let _ = app.emit("pomo:tick", self.get_state());
        }
    }
}
```

### Commands trong `commands.rs`
```rust
#[tauri::command]
pub fn pomo_get_state(state: State<'_, AppState>) -> PomodoroState {
    state.pomodoro.lock().unwrap().get_state()
}

#[tauri::command]
pub fn pomo_start(app: AppHandle, state: State<'_, AppState>, focus: u32, break_min: u32) {
    {
        let mut mgr = state.pomodoro.lock().unwrap();
        mgr.focus_minutes = focus;
        mgr.break_minutes = break_min;
    }
    PomodoroManager::start(state.pomodoro_arc.clone(), app);
}

#[tauri::command]
pub fn pomo_pause(state: State<'_, AppState>) {
    state.pomodoro.lock().unwrap().pause();
}

#[tauri::command]
pub fn pomo_reset(app: AppHandle, state: State<'_, AppState>) {
    state.pomodoro.lock().unwrap().reset(&app);
}

#[tauri::command]
pub fn pomo_update_config(app: AppHandle, state: State<'_, AppState>, focus: u32, break_min: u32) {
    state.pomodoro.lock().unwrap().update_config(focus, break_min, &app);
}
```

### AppState update (cần Arc cho Pomodoro)
```rust
pub struct AppState {
    pub pet_manager: Mutex<PetManager>,
    pub pomodoro: Mutex<PomodoroManager>,
    pub pomodoro_arc: Arc<Mutex<PomodoroManager>>,
}
```

### Done Criteria
- [ ] Timer đếm ngược đúng 1 giây/lần
- [ ] `pomo:tick` event emit mỗi giây với state đúng
- [ ] Hết giờ → `pet:start-alarm` emit + toggle session
- [ ] Pause → timer dừng, state = Idle
- [ ] Reset → về 25:00, isWorkSession = true

---

## TASK-12: Implement IntelligenceManager in Rust
**Status**: ⬜ TODO
**Phase**: 4
**Depends on**: TASK-10
**Blocks**: TASK-17

### Goal
Port `src/main/pet/intelligence-manager.ts` sang Rust. Detect app đang dùng, generate comment, broadcast qua `pet:say` event.

### File: `src-tauri/src/intelligence.rs`

```rust
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use crate::pet::manager::PetManager;

pub struct IntelligenceManager {
    last_app: String,
    last_tab_title: String,
}

impl IntelligenceManager {
    pub fn new() -> Self {
        Self {
            last_app: String::new(),
            last_tab_title: String::new(),
        }
    }

    pub fn start(app: AppHandle, pet_manager: Arc<Mutex<PetManager>>) {
        tokio::spawn(async move {
            let state = Arc::new(Mutex::new(IntelligenceManager::new()));
            loop {
                // Random delay 30-60 giây
                let delay = 30 + (rand::random::<u64>() % 31);
                tokio::time::sleep(std::time::Duration::from_secs(delay)).await;

                let lang = pet_manager.lock().unwrap()
                    .get_settings().language.clone();

                let mut mgr = state.lock().unwrap();

                #[cfg(target_os = "macos")]
                {
                    if let Some(text) = mgr.check_context_mac(&lang) {
                        let _ = app.emit("pet:say", text);
                    }
                }

                if let Some(text) = mgr.check_time(&lang) {
                    let _ = app.emit("pet:say", text);
                }
            }
        });
    }

    #[cfg(target_os = "macos")]
    fn check_context_mac(&mut self, lang: &str) -> Option<String> {
        let output = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to get name of first process whose frontmost is true")
            .output()
            .ok()?;

        let current_app = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if current_app.is_empty()
            || current_app == "Electron"
            || current_app == "MiniPet" { return None; }

        let is_browser = current_app.contains("Chrome")
            || current_app.contains("Safari")
            || current_app.contains("Arc");

        if current_app != self.last_app {
            self.last_app = current_app.clone();
            if is_browser {
                return self.check_browser_tab(&current_app, lang);
            }
            return self.generate_app_comment(&current_app, lang);
        } else if is_browser && rand::random::<f64>() < 0.4 {
            return self.check_browser_tab(&current_app, lang);
        } else if rand::random::<f64>() < 0.3 {
            return self.generate_app_comment(&current_app, lang);
        }
        None
    }

    #[cfg(target_os = "macos")]
    fn check_browser_tab(&mut self, browser: &str, lang: &str) -> Option<String> {
        let script = if browser.contains("Chrome") {
            "tell application \"Google Chrome\" to get title of active tab of front window"
        } else if browser.contains("Safari") {
            "tell application \"Safari\" to get name of current tab of front window"
        } else if browser.contains("Arc") {
            "tell application \"Arc\" to get title of active tab of front window"
        } else {
            return None;
        };

        let output = Command::new("osascript")
            .arg("-e").arg(script)
            .output().ok()?;

        let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if title.is_empty() { return None; }

        if title != self.last_tab_title || rand::random::<f64>() < 0.4 {
            self.last_tab_title = title.clone();
            return self.generate_browser_comment(&title, lang);
        }
        None
    }

    fn generate_app_comment(&self, app_name: &str, lang: &str) -> Option<String> {
        // Load translations từ embedded JSON hoặc hardcode key mapping
        // Map app name → translation key → pick random string
        let key = if app_name.contains("Code") || app_name.contains("Cursor") || app_name.contains("Zed") {
            "intelAppCode"
        } else if app_name.contains("Spotify") || app_name.contains("Music") {
            "intelAppMusic"
        } else if app_name.contains("Slack") || app_name.contains("Telegram") {
            "intelAppChat"
        } else if app_name.contains("Terminal") || app_name.contains("iTerm") {
            "intelAppTerminal"
        } else if app_name.contains("Figma") || app_name.contains("Photoshop") {
            "intelAppDesign"
        } else if app_name.contains("Zoom") || app_name.contains("Teams") {
            "intelAppMeeting"
        } else if app_name.contains("Notion") || app_name.contains("Obsidian") {
            "intelAppProductivity"
        } else if app_name.contains("Finder") {
            "intelAppFinder"
        } else {
            "intelAppDefault"
        };
        pick_random_translation(lang, key)
    }

    fn generate_browser_comment(&self, title: &str, lang: &str) -> Option<String> {
        let lower = title.to_lowercase();
        let key = if lower.contains("youtube") {
            "intelWebYoutube"
        } else if lower.contains("facebook") || lower.contains("tiktok") || lower.contains("twitter") {
            "intelWebSocial"
        } else if lower.contains("github") || lower.contains("stackoverflow") {
            "intelWebDev"
        } else if lower.contains("chatgpt") || lower.contains("claude") || lower.contains("gemini") {
            "intelWebAI"
        } else if lower.contains("figma") || lower.contains("canva") {
            "intelWebDesign"
        } else {
            "intelAppWeb"
        };
        pick_random_translation(lang, key)
    }

    fn check_time(&self, lang: &str) -> Option<String> {
        let hour = chrono::Local::now().hour();
        if (hour >= 23 || hour < 5) && rand::random::<f64>() < 0.1 {
            return pick_random_translation(lang, "intelTimeLate");
        }
        if hour == 12 && rand::random::<f64>() < 0.1 {
            return pick_random_translation(lang, "intelTimeLunch");
        }
        None
    }
}

// Load translations từ embedded file
fn pick_random_translation(lang: &str, key: &str) -> Option<String> {
    // Embed translations.json tại compile time
    static TRANSLATIONS: &str = include_str!("../../src/shared/i18n/translations.json");
    let data: serde_json::Value = serde_json::from_str(TRANSLATIONS).ok()?;
    let choices = data.get(lang)?.get(key)?.as_array()?;
    if choices.is_empty() { return None; }
    let idx = rand::random::<usize>() % choices.len();
    choices[idx].as_str().map(|s| s.to_string())
}
```

### Cần tạo thêm: `src/shared/i18n/translations.json`
Convert `translations.ts` sang JSON để Rust có thể embed:
```bash
# Tạo script convert TS → JSON
node -e "
const t = require('./src/shared/i18n/translations');
const fs = require('fs');
fs.writeFileSync('./src/shared/i18n/translations.json', JSON.stringify(t.translations, null, 2));
"
```

### Thêm dependency vào Cargo.toml
```toml
chrono = { version = "0.4", features = ["clock"] }
```

### Done Criteria
- [ ] `pet:say` event emit sau 30-60 giây
- [ ] Comment đúng ngôn ngữ theo settings
- [ ] AppleScript detect app đúng trên macOS
- [ ] Không crash khi AppleScript fail

---

## TASK-13: Migrate Frontend — overlay.ts
**Status**: ⬜ TODO
**Phase**: 4
**Depends on**: TASK-07, TASK-10
**Blocks**: TASK-17

### Goal
Thay toàn bộ `window.electronAPI.xxx` bằng Tauri API trong overlay. KHÔNG sửa engine code.

### Bước 1: Tạo adapter layer
**File mới**: `src/lib/tauri-api.ts`

```typescript
import { invoke } from '@tauri-apps/api/core'
import { emit, listen, UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export const tauriAPI = {
  // Pet
  getInstanceConfig: (id: string): Promise<any> =>
    invoke('get_instance_config', { id }),
  getSettings: (): Promise<any> =>
    invoke('get_settings'),
  spawnPet: (slug: string): Promise<any> =>
    invoke('spawn_pet', { slug }),
  removePet: (id: string): Promise<void> =>
    invoke('remove_pet', { id }),
  getPetList: (): Promise<any[]> =>
    invoke('get_pet_list'),
  deletePet: (slug: string): Promise<any[]> =>
    invoke('delete_pet', { slug }),
  importPet: (): Promise<any[]> =>
    invoke('import_pet'),
  getSpritesheetUrl: (slug: string): Promise<string | null> =>
    invoke('get_spritesheet_url', { slug }),

  // Settings
  updateSettings: (settings: Record<string, unknown>): Promise<void> =>
    invoke('update_settings', { settings }),

  // Window
  setIgnoreMouseEvents: (ignore: boolean): Promise<void> =>
    getCurrentWindow().setIgnoreCursorEvents(ignore),
  moveWindow: (deltaX: number, deltaY: number): Promise<void> =>
    invoke('move_window', { deltaX, deltaY }),
  resizeWindow: (width: number, height: number): Promise<void> =>
    invoke('resize_window', { width, height }),
  savePosition: (instanceId: string, x: number, y: number): Promise<void> =>
    invoke('save_position', { instanceId, x, y }),
  openSettings: (): Promise<void> =>
    invoke('open_settings'),

  // Pet interaction
  pingPet: (): Promise<void> => invoke('ping_pet'),
  startAlarm: (): Promise<void> => invoke('start_alarm'),
  stopAlarm: (): Promise<void> => invoke('stop_alarm'),
  eatFile: (paths: string[]): Promise<void> =>
    invoke('eat_file', { paths }),
  notifySpeaking: (): Promise<void> =>
    invoke('notify_speaking'),

  // File path (Tauri không cần webUtils, dùng path trực tiếp từ drop event)
  getPathForFile: (file: File): string =>
    (file as any).path ?? '',

  // Pomodoro
  getPomoState: (): Promise<any> => invoke('pomo_get_state'),
  startPomo: (focus: number, breakMin: number): Promise<void> =>
    invoke('pomo_start', { focus, breakMin }),
  pausePomo: (): Promise<void> => invoke('pomo_pause'),
  resetPomo: (): Promise<void> => invoke('pomo_reset'),
  updatePomoConfig: (focus: number, breakMin: number): Promise<void> =>
    invoke('pomo_update_config', { focus, breakMin }),

  // Event listeners — trả về UnlistenFn để cleanup
  onPing: (cb: () => void): Promise<UnlistenFn> =>
    listen('pet:ping', cb),
  onStartAlarm: (cb: () => void): Promise<UnlistenFn> =>
    listen('pet:start-alarm', cb),
  onStopAlarm: (cb: () => void): Promise<UnlistenFn> =>
    listen('pet:stop-alarm', cb),
  onPomoTick: (cb: (state: any) => void): Promise<UnlistenFn> =>
    listen('pomo:tick', e => cb(e.payload)),
  onSettingsUpdate: (cb: (data: any) => void): Promise<UnlistenFn> =>
    listen('settings:update', e => cb(e.payload)),
  onPetSay: (cb: (text: string) => void): Promise<UnlistenFn> =>
    listen('pet:say', e => cb(e.payload as string)),
  onPositionsUpdate: (cb: (data: any) => void): Promise<UnlistenFn> =>
    listen('pets:positions-updated', e => cb(e.payload)),
  onSomeoneSpeaking: (cb: () => void): Promise<UnlistenFn> =>
    listen('pet:someone-speaking', cb),
}
```

### Bước 2: Sửa `src/renderer/overlay/overlay.ts`

Thay tất cả `window.electronAPI` → `tauriAPI`:

```typescript
// TRƯỚC
import { ... } from '../../shared/...'
// THÊM VÀO ĐẦU FILE
import { tauriAPI } from '../../lib/tauri-api'

// Thay window.electronAPI.getInstanceConfig(instanceId)
// → tauriAPI.getInstanceConfig(instanceId)

// Thay window.electronAPI.getSettings()
// → tauriAPI.getSettings()

// Thay window.electronAPI.onPing(() => {...})
// → await tauriAPI.onPing(() => {...})
// (listen là async, cần await)

// Thay window.electronAPI.setIgnoreMouseEvents(true, { forward: true })
// → tauriAPI.setIgnoreMouseEvents(true)
// NOTE: Tauri không có { forward: true } option
```

### Bước 3: Sửa `electron.d.ts` → `tauri.d.ts`
Xóa `electron.d.ts`, tạo `src/renderer/overlay/tauri.d.ts`:
```typescript
// Không cần declare global vì dùng import trực tiếp
// File này chỉ để reference types nếu cần
export {}
```

### Điểm khác biệt quan trọng Electron → Tauri

| Electron | Tauri | Ghi chú |
|---|---|---|
| `setIgnoreMouseEvents(true, {forward:true})` | `setIgnoreCursorEvents(true)` | Tauri không có forward option |
| `ipcRenderer.on()` sync | `listen()` async, trả về UnlistenFn | Cần await |
| `webUtils.getPathForFile(file)` | `(file as any).path` | Tauri dùng path từ drop event |
| `ipcRenderer.send()` fire-and-forget | `invoke()` trả về Promise | Tất cả là async |

### Done Criteria
- [ ] Overlay load và hiện pet animation
- [ ] Click pet → speech bubble hiện
- [ ] Drag pet → window di chuyển
- [ ] Hover → click-through tắt; leave → bật lại
- [ ] Drag file vào pet → eat animation
- [ ] Pomodoro tick hiện đúng trong overlay

---

## TASK-14: Migrate Frontend — settings.ts
**Status**: ⬜ TODO
**Phase**: 4
**Depends on**: TASK-08, TASK-10
**Blocks**: TASK-17

### Goal
Thay toàn bộ `window.electronAPI.xxx` bằng `tauriAPI` trong settings UI.

### Sửa `src/renderer/settings/settings.ts`

```typescript
// THÊM import
import { tauriAPI } from '../../lib/tauri-api'

// Thay window.electronAPI.getPetList() → tauriAPI.getPetList()
// Thay window.electronAPI.getSettings() → tauriAPI.getSettings()
// Thay window.electronAPI.spawnPet(slug) → tauriAPI.spawnPet(slug)
// Thay window.electronAPI.removePet(id) → tauriAPI.removePet(id)
// Thay window.electronAPI.deletePet(slug) → tauriAPI.deletePet(slug)
// Thay window.electronAPI.importPet() → tauriAPI.importPet()
// Thay window.electronAPI.updateSettings(s) → tauriAPI.updateSettings(s)
// Thay window.electronAPI.pingPet() → tauriAPI.pingPet()
// Thay window.electronAPI.startPomo(f,b) → tauriAPI.startPomo(f,b)
// Thay window.electronAPI.pausePomo() → tauriAPI.pausePomo()
// Thay window.electronAPI.resetPomo() → tauriAPI.resetPomo()
// Thay window.electronAPI.getPomoState() → tauriAPI.getPomoState()
// Thay window.electronAPI.updatePomoConfig(f,b) → tauriAPI.updatePomoConfig(f,b)

// onSettingsUpdate là async trong Tauri:
// TRƯỚC: window.electronAPI.onSettingsUpdate(cb)
// SAU:   await tauriAPI.onSettingsUpdate(cb)

// onPomoTick là async:
// TRƯỚC: window.electronAPI.onPomoTick(cb)
// SAU:   await tauriAPI.onPomoTick(cb)
```

### Xóa `electron.d.ts` reference
Trong `settings.ts` không còn dùng `window.electronAPI` nên không cần type declaration.

### Done Criteria
- [ ] Pet gallery hiện đúng 6 default pets
- [ ] Click pet card → spawn pet mới trên màn hình
- [ ] Remove pet → pet biến mất
- [ ] Scale slider → pet resize realtime
- [ ] Walking toggle → pet dừng/đi
- [ ] Language select → text đổi ngôn ngữ
- [ ] Pomodoro start/pause/reset hoạt động
- [ ] Import pet button → file dialog mở
