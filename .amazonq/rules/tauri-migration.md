# MiniPet — Tauri Migration Rules

## Project Context
Migrating MiniPet from Electron to Tauri v2.
- Old stack: Electron + Vite + TypeScript
- New stack: Tauri v2 (Rust backend) + Vite + TypeScript (frontend unchanged)
- Goal: Reduce app size from ~128MB DMG → ~8MB

## Directory Structure (Target)
```
minipet-tauri/
├── src-tauri/                  # Rust backend (replaces src/main/)
│   ├── src/
│   │   ├── main.rs             # Entry point (replaces main.ts)
│   │   ├── lib.rs              # App setup & plugin registration
│   │   ├── pet/
│   │   │   ├── mod.rs
│   │   │   ├── manager.rs      # replaces pet-manager.ts
│   │   │   ├── loader.rs       # replaces pet-loader.ts
│   │   │   └── pomodoro.rs     # replaces pomodoro-manager.ts
│   │   ├── window/
│   │   │   ├── mod.rs
│   │   │   ├── overlay.rs      # replaces overlay-window.ts
│   │   │   └── settings.rs     # replaces settings-window.ts
│   │   ├── tray.rs             # replaces system-tray.ts
│   │   ├── intelligence.rs     # replaces intelligence-manager.ts
│   │   └── commands.rs         # replaces ipc-handlers.ts (Tauri commands)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── src/                        # Frontend (KEEP AS-IS from Electron)
│   ├── renderer/               # UNCHANGED — overlay & settings UI
│   ├── shared/                 # UNCHANGED — types, constants, i18n
│   └── assets/                 # UNCHANGED — spritesheets, icons
├── package.json
└── vite.config.ts
```

## Electron → Tauri Mapping

| Electron | Tauri v2 |
|---|---|
| `BrowserWindow` | `tauri::WebviewWindow` |
| `ipcMain.handle()` | `#[tauri::command]` + `invoke_handler` |
| `ipcMain.on()` | `#[tauri::command]` hoặc Tauri Events |
| `ipcRenderer.invoke()` | `invoke('command_name', args)` |
| `ipcRenderer.send()` | `emit('event_name', payload)` |
| `win.webContents.send()` | `window.emit('event', payload)` |
| `contextBridge.exposeInMainWorld` | Không cần — dùng `@tauri-apps/api` trực tiếp |
| `app.getPath('userData')` | `tauri::path::app_data_dir()` |
| `shell.trashItem()` | `trash` crate hoặc `tauri-plugin-trash` |
| `dialog.showOpenDialog()` | `tauri-plugin-dialog` |
| `app.setLoginItemSettings()` | `tauri-plugin-autostart` |
| `win.setIgnoreMouseEvents()` | `window.set_ignore_cursor_events()` |
| `win.setAlwaysOnTop()` | `window.set_always_on_top()` |
| `Tray` + `Menu` | `tauri::tray::TrayIconBuilder` |
| `screen.getPrimaryDisplay()` | `tauri::monitor::primary_monitor()` |
| `exec('osascript')` | `std::process::Command` |

## Frontend API Migration

Thay `window.electronAPI.xxx()` bằng Tauri API:

```typescript
// OLD (Electron)
window.electronAPI.getSettings()
window.electronAPI.spawnPet(slug)
window.electronAPI.moveWindow(dx, dy)

// NEW (Tauri)
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

invoke('get_settings')
invoke('spawn_pet', { slug })
getCurrentWindow().setPosition(...)
```

## Coding Rules

### Rust (src-tauri/)
- Dùng `snake_case` cho tất cả functions, variables, files
- Mỗi Tauri command phải có `#[tauri::command]` decorator
- State management dùng `tauri::State<Mutex<T>>`
- Error handling: trả về `Result<T, String>` cho tất cả commands
- Không dùng `unwrap()` — dùng `?` operator hoặc `map_err()`
- Mỗi module có file `mod.rs` riêng

### TypeScript (src/)
- Giữ nguyên toàn bộ logic trong `src/renderer/` và `src/shared/`
- Chỉ thay đổi API calls: `window.electronAPI.xxx` → `invoke('xxx')`
- Tạo file `src/lib/tauri-api.ts` làm adapter layer — KHÔNG sửa trực tiếp overlay.ts hay settings.ts
- Event listeners: `ipcRenderer.on(channel, cb)` → `listen('channel', cb)`

### General
- Mỗi task PHẢI có file test hoặc manual test checklist
- Commit sau mỗi task hoàn thành
- Không xóa Electron source cho đến Phase 5 (verification)

## Tauri Plugins Required
```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-autostart = "2"
tauri-plugin-single-instance = "2"
```

## Pet State Machine & Animation
- Toàn bộ `src/renderer/overlay/engine/` KHÔNG thay đổi
- Canvas rendering, AnimationController, PetStateMachine giữ nguyên 100%
- Chỉ thay đổi cách nhận events từ backend

## Settings File Format
Giữ nguyên JSON format của `settings.json` để tương thích với data người dùng cũ.
