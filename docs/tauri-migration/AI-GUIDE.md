# AI Guide — Tauri Migration

Đây là hướng dẫn cho AI khi làm việc trên migration tasks.
Đọc file này TRƯỚC KHI bắt đầu bất kỳ task nào.

---

## Quy trình làm mỗi task

```
1. Đọc task definition trong TASKS-PHASE-X.md
2. Đọc Electron source tương ứng để hiểu logic gốc
3. Implement Rust/TS code theo spec
4. Chạy cargo build để verify không lỗi
5. Update status trong PLAN.md: ⬜ → ✅
6. Báo cáo done criteria đã pass
```

---

## Mapping file: Electron → Tauri

| Electron file | Tauri file |
|---|---|
| `src/main/main.ts` | `src-tauri/src/main.rs` + `lib.rs` |
| `src/main/preload.ts` | KHÔNG CÓ (dùng @tauri-apps/api trực tiếp) |
| `src/main/ipc/ipc-handlers.ts` | `src-tauri/src/commands.rs` |
| `src/main/pet/pet-manager.ts` | `src-tauri/src/pet/manager.rs` |
| `src/main/pet/pet-loader.ts` | `src-tauri/src/pet/loader.rs` |
| `src/main/pet/pomodoro-manager.ts` | `src-tauri/src/pet/pomodoro.rs` |
| `src/main/pet/intelligence-manager.ts` | `src-tauri/src/intelligence.rs` |
| `src/main/windows/overlay-window.ts` | `src-tauri/src/window/overlay.rs` |
| `src/main/windows/settings-window.ts` | `src-tauri/src/window/settings.rs` |
| `src/main/tray/system-tray.ts` | `src-tauri/src/tray.rs` |
| `src/renderer/overlay/overlay.ts` | `src/renderer/overlay/overlay.ts` (sửa API calls) |
| `src/renderer/settings/settings.ts` | `src/renderer/settings/settings.ts` (sửa API calls) |

---

## Rust Coding Rules

```rust
// ✅ ĐÚNG
pub async fn spawn_pet(&mut self, slug: &str) -> Result<PetInstance, String> {
    let pet = self.pets.iter().find(|p| p.manifest.slug.as_deref() == Some(slug))
        .ok_or_else(|| format!("Pet not found: {}", slug))?;
    // ...
}

// ❌ SAI — không dùng unwrap()
pub fn get_pet(&self, slug: &str) -> PetInstance {
    self.pets.iter().find(|p| ...).unwrap() // KHÔNG
}

// ✅ State management
pub struct AppState {
    pub pet_manager: Mutex<PetManager>,
    pub pomodoro: Mutex<PomodoroManager>,
    pub pomodoro_arc: Arc<Mutex<PomodoroManager>>,
}

// ✅ Command signature chuẩn
#[tauri::command]
pub async fn my_command(
    app: AppHandle,
    state: State<'_, AppState>,
    param: String,
) -> Result<ReturnType, String> {
    // ...
}
```

---

## TypeScript Coding Rules

```typescript
// ✅ ĐÚNG — dùng tauriAPI adapter
import { tauriAPI } from '../../lib/tauri-api'
const settings = await tauriAPI.getSettings()

// ❌ SAI — không dùng window.electronAPI
const settings = await window.electronAPI.getSettings()

// ✅ Event listener (async trong Tauri)
const unlisten = await tauriAPI.onPing(() => {
  stateMachine.notify()
})
// Cleanup khi cần: unlisten()

// ✅ Invoke command
await tauriAPI.moveWindow(deltaX, deltaY)

// ❌ SAI — không emit trực tiếp từ frontend cho backend commands
import { emit } from '@tauri-apps/api/event'
emit('window:move', ...) // KHÔNG — dùng invoke thay thế
```

---

## Serde JSON Naming Convention

Frontend TypeScript dùng `camelCase`, Rust dùng `snake_case`.
Luôn dùng `#[serde(rename = "camelCase")]` hoặc `#[serde(rename_all = "camelCase")]`:

```rust
// ✅ ĐÚNG
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub active_pets: Vec<PetInstance>,    // → "activePets" trong JSON
    pub enable_walking: bool,             // → "enableWalking" trong JSON
    pub launch_at_startup: bool,          // → "launchAtStartup" trong JSON
}

// ✅ Hoặc rename từng field
#[derive(Serialize, Deserialize)]
pub struct PetInstance {
    pub id: String,
    pub slug: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    // Không cần rename vì đã lowercase
}
```

---

## Event Names (phải match giữa Rust và TypeScript)

| Event | Rust emit | TypeScript listen |
|---|---|---|
| Pet ping | `app.emit("pet:ping", ())` | `listen("pet:ping", cb)` |
| Start alarm | `app.emit("pet:start-alarm", ())` | `listen("pet:start-alarm", cb)` |
| Stop alarm | `app.emit("pet:stop-alarm", ())` | `listen("pet:stop-alarm", cb)` |
| Pomodoro tick | `app.emit("pomo:tick", state)` | `listen("pomo:tick", e => cb(e.payload))` |
| Settings update | `app.emit("settings:update", json)` | `listen("settings:update", e => cb(e.payload))` |
| Pet say | `app.emit("pet:say", text)` | `listen("pet:say", e => cb(e.payload))` |
| Positions update | `app.emit("pets:positions-updated", data)` | `listen("pets:positions-updated", cb)` |
| Someone speaking | `app.emit("pet:someone-speaking", ())` | `listen("pet:someone-speaking", cb)` |

---

## Command Names (phải match giữa Rust và TypeScript)

| TypeScript invoke | Rust command |
|---|---|
| `invoke('get_pet_list')` | `#[tauri::command] fn get_pet_list` |
| `invoke('get_instance_config', {id})` | `fn get_instance_config(id: String)` |
| `invoke('spawn_pet', {slug})` | `fn spawn_pet(slug: String)` |
| `invoke('remove_pet', {id})` | `fn remove_pet(id: String)` |
| `invoke('get_settings')` | `fn get_settings` |
| `invoke('update_settings', {settings})` | `fn update_settings(settings: Value)` |
| `invoke('set_ignore_cursor_events', {ignore})` | `fn set_ignore_cursor_events(ignore: bool)` |
| `invoke('move_window', {deltaX, deltaY})` | `fn move_window(delta_x: f64, delta_y: f64)` |
| `invoke('resize_window', {width, height})` | `fn resize_window(width: f64, height: f64)` |
| `invoke('save_position', {instanceId, x, y})` | `fn save_position(instance_id: String, x: f64, y: f64)` |
| `invoke('open_settings')` | `fn open_settings` |
| `invoke('ping_pet')` | `fn ping_pet` |
| `invoke('start_alarm')` | `fn start_alarm` |
| `invoke('stop_alarm')` | `fn stop_alarm` |
| `invoke('eat_file', {paths})` | `fn eat_file(paths: Vec<String>)` |
| `invoke('notify_speaking')` | `fn notify_speaking` |
| `invoke('pomo_get_state')` | `fn pomo_get_state` |
| `invoke('pomo_start', {focus, breakMin})` | `fn pomo_start(focus: u32, break_min: u32)` |
| `invoke('pomo_pause')` | `fn pomo_pause` |
| `invoke('pomo_reset')` | `fn pomo_reset` |
| `invoke('pomo_update_config', {focus, breakMin})` | `fn pomo_update_config(focus: u32, break_min: u32)` |
| `invoke('import_pet')` | `fn import_pet` |
| `invoke('delete_pet', {slug})` | `fn delete_pet(slug: String)` |
| `invoke('get_spritesheet_url', {slug})` | `fn get_spritesheet_url(slug: String)` |

---

## Window Label Convention

```
Overlay windows: "pet-{instanceId}"   ví dụ: "pet-abc123def"
Settings window: "settings"
```

Khi filter overlay windows:
```rust
w.label().starts_with("pet-")
```

---

## Không được làm

- ❌ Sửa bất kỳ file nào trong `src/renderer/overlay/engine/`
- ❌ Sửa `src/shared/types/` và `src/shared/constants.ts`
- ❌ Dùng `unwrap()` trong Rust code
- ❌ Dùng `window.electronAPI` trong TypeScript sau TASK-13/14
- ❌ Xóa Electron source (`minipet-app/`) cho đến khi TASK-17 pass hoàn toàn
- ❌ Thay đổi JSON format của `settings.json`

---

## Cách update Progress Tracker

Sau khi hoàn thành task, mở `docs/tauri-migration/PLAN.md` và đổi:
```
| 1 | TASK-01 | ⬜ TODO | Scaffold Tauri project |
→
| 1 | TASK-01 | ✅ DONE | Scaffold Tauri project |
```
