# MiniPet — Tauri Migration Plan

## Overview
- **From**: Electron + Vite + TypeScript (~128MB DMG)
- **To**: Tauri v2 + Rust + Vite + TypeScript (~8MB DMG)
- **Total Phases**: 5
- **Total Tasks**: 18

## Progress Tracker

| Phase | Task | Status | Description |
|---|---|---|---|
| 1 | TASK-01 | ✅ DONE | Scaffold Tauri project |
| 1 | TASK-02 | ✅ DONE | Configure tauri.conf.json |
| 1 | TASK-03 | ✅ DONE | Setup Cargo.toml dependencies |
| 2 | TASK-04 | ✅ DONE | Implement PetManager in Rust |
| 2 | TASK-05 | ✅ DONE | Implement PetLoader in Rust |
| 2 | TASK-06 | ✅ DONE | Implement Settings persistence |
| 3 | TASK-07 | ✅ DONE | Implement OverlayWindow |
| 3 | TASK-08 | ✅ DONE | Implement SettingsWindow |
| 3 | TASK-09 | ✅ DONE | Implement SystemTray |
| 3 | TASK-10 | ✅ DONE | Implement Tauri Commands (IPC) |
| 4 | TASK-11 | ✅ DONE | Implement PomodoroManager in Rust |
| 4 | TASK-12 | ✅ DONE | Implement IntelligenceManager in Rust |
| 4 | TASK-13 | ✅ DONE | Migrate Frontend overlay.ts |
| 4 | TASK-14 | ✅ DONE | Migrate Frontend settings.ts |
| 5 | TASK-15 | ✅ DONE | File eating (trash) feature |
| 5 | TASK-16 | ✅ DONE | Pet import (ZIP/folder) feature |
| 5 | TASK-17 | ⬜ TODO | End-to-end testing |
| 5 | TASK-18 | ✅ DONE | Build & package optimization |

---

## Phase Dependencies

```
Phase 1 (Setup) → Phase 2 (Core) → Phase 3 (Windows/IPC) → Phase 4 (Features) → Phase 5 (Polish)

TASK-01 → TASK-02 → TASK-03
TASK-03 → TASK-04, TASK-05, TASK-06 (parallel)
TASK-04 + TASK-05 + TASK-06 → TASK-07, TASK-08, TASK-09, TASK-10 (parallel)
TASK-07 + TASK-10 → TASK-13
TASK-08 + TASK-10 → TASK-14
TASK-10 → TASK-11, TASK-12 (parallel)
TASK-13 + TASK-14 + TASK-11 + TASK-12 → TASK-15, TASK-16 (parallel)
TASK-15 + TASK-16 → TASK-17 → TASK-18
```

---

## Electron → Tauri API Mapping (Quick Reference)

| Electron | Tauri v2 |
|---|---|
| `BrowserWindow` | `WebviewWindowBuilder` |
| `ipcMain.handle()` | `#[tauri::command]` |
| `ipcMain.on()` | `#[tauri::command]` hoặc Event |
| `ipcRenderer.invoke()` | `invoke('cmd', args)` |
| `ipcRenderer.on(ch, cb)` | `listen('event', cb)` |
| `win.webContents.send()` | `app.emit()` hoặc `window.emit()` |
| `contextBridge` | Không cần — dùng `@tauri-apps/api` |
| `app.getPath('userData')` | `app.path().app_data_dir()` |
| `shell.trashItem()` | `trash` crate |
| `dialog.showOpenDialog()` | `tauri-plugin-dialog` |
| `app.setLoginItemSettings()` | `tauri-plugin-autostart` |
| `win.setIgnoreMouseEvents()` | `window.set_ignore_cursor_events()` |
| `win.setAlwaysOnTop()` | `window.set_always_on_top()` |
| `Tray + Menu` | `TrayIconBuilder` |
| `screen.getPrimaryDisplay()` | `app.primary_monitor()` |
| `exec('osascript')` | `std::process::Command` |

---

## Target Directory Structure

```
minipet-tauri/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs
│   │   ├── tray.rs
│   │   ├── intelligence.rs
│   │   ├── pet/
│   │   │   ├── mod.rs
│   │   │   ├── manager.rs
│   │   │   ├── loader.rs
│   │   │   └── pomodoro.rs
│   │   └── window/
│   │       ├── mod.rs
│   │       ├── overlay.rs
│   │       └── settings.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── src/
│   ├── renderer/         ← UNCHANGED từ Electron
│   │   ├── overlay/
│   │   └── settings/
│   ├── shared/           ← UNCHANGED từ Electron
│   ├── assets/           ← UNCHANGED từ Electron
│   └── lib/
│       └── tauri-api.ts  ← NEW adapter layer
├── package.json
└── vite.config.ts
```
