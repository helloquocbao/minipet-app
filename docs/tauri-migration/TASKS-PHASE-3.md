# Tasks — Phase 3: Window Management & IPC

---

## TASK-07: Implement OverlayWindow in Rust
**Status**: ⬜ TODO
**Phase**: 3
**Depends on**: TASK-04, TASK-05, TASK-06
**Blocks**: TASK-10, TASK-13

### Goal
Port `src/main/windows/overlay-window.ts` sang Rust. Tạo transparent, always-on-top, click-through window cho mỗi pet instance.

### File: `src-tauri/src/window/overlay.rs`

```rust
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder, Manager};

pub fn create_overlay_window(
    app: &AppHandle,
    instance_id: &str,
    x: f64,
    y: f64,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    // Nếu window đã tồn tại thì show lại
    if let Some(win) = app.get_webview_window(instance_id) {
        let _ = win.show();
        return Ok(win);
    }

    let url = format!("overlay.html?id={}", instance_id);

    let win = WebviewWindowBuilder::new(
        app,
        instance_id,
        WebviewUrl::App(url.into()),
    )
    .title(format!("MiniPet-{}", instance_id))
    .inner_size(400.0, 440.0)
    .position(x, y)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .build()?;

    // Click-through mặc định khi mới tạo
    let _ = win.set_ignore_cursor_events(true);

    Ok(win)
}

pub fn get_all_overlay_windows(app: &AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .filter(|w| w.label().starts_with("pet-") || w.label() == "overlay")
        .collect()
}

pub fn destroy_overlay_window(app: &AppHandle, instance_id: &str) {
    if let Some(win) = app.get_webview_window(instance_id) {
        let _ = win.close();
    }
}

pub fn destroy_all_overlay_windows(app: &AppHandle) {
    for win in get_all_overlay_windows(app) {
        let _ = win.close();
    }
}

pub fn move_window(win: &tauri::WebviewWindow, delta_x: f64, delta_y: f64) {
    if let Ok(pos) = win.outer_position() {
        let _ = win.set_position(tauri::PhysicalPosition::new(
            pos.x + delta_x as i32,
            pos.y + delta_y as i32,
        ));
    }
}

pub fn resize_window(win: &tauri::WebviewWindow, width: f64, height: f64) {
    if let (Ok(size), Ok(pos)) = (win.outer_size(), win.outer_position()) {
        let new_w = width.max(50.0) as u32;
        let new_h = height.max(50.0) as u32;
        if new_w == size.width && new_h == size.height { return; }

        // Anchor bottom: giữ cạnh dưới cố định
        let delta_h = new_h as i32 - size.height as i32;
        let delta_w = new_w as i32 - size.width as i32;
        let _ = win.set_position(tauri::PhysicalPosition::new(
            pos.x - delta_w / 2,
            pos.y - delta_h,
        ));
        let _ = win.set_size(tauri::PhysicalSize::new(new_w, new_h));
    }
}
```

### macOS: Ẩn Dock Icon
Trong `lib.rs`:
```rust
#[cfg(target_os = "macos")]
fn hide_dock_icon(app: &AppHandle) {
    use tauri::ActivationPolicy;
    app.set_activation_policy(ActivationPolicy::Accessory);
}
```

### Window Label Convention
- Overlay windows: label = `"pet-{instanceId}"` (ví dụ: `"pet-abc123"`)
- Settings window: label = `"settings"`

### Done Criteria
- [ ] Overlay window hiện transparent, không có frame
- [ ] Always-on-top hoạt động (nằm trên các app khác)
- [ ] Click-through mặc định (setIgnoreCursorEvents = true)
- [ ] Dock icon ẩn trên macOS
- [ ] `move_window()` di chuyển đúng
- [ ] `resize_window()` resize với anchor bottom đúng

---

## TASK-08: Implement SettingsWindow in Rust
**Status**: ⬜ TODO
**Phase**: 3
**Depends on**: TASK-04
**Blocks**: TASK-10, TASK-14

### Goal
Port `src/main/windows/settings-window.ts` sang Rust. Hide-on-close behavior.

### File: `src-tauri/src/window/settings.rs`

```rust
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder, Manager};

pub fn open_settings_window(app: &AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    // Nếu đã tồn tại thì show và focus
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("settings.html".into()),
    )
    .title("MiniPet Settings")
    .inner_size(720.0, 500.0)
    .resizable(false)
    .maximizable(false)
    .build()?;

    Ok(win)
}
```

### Hide-on-close (trong `lib.rs` setup)
```rust
// Lắng nghe close-requested event để hide thay vì destroy
app.on_window_event(|window, event| {
    if window.label() == "settings" {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    }
});
```

### Done Criteria
- [ ] Settings window mở đúng kích thước 720x500
- [ ] Close button → hide (không destroy)
- [ ] Mở lại sau khi hide → focus vào window cũ
- [ ] Quit app → window đóng hẳn

---

## TASK-09: Implement SystemTray in Rust
**Status**: ⬜ TODO
**Phase**: 3
**Depends on**: TASK-07, TASK-08
**Blocks**: TASK-10

### Goal
Port `src/main/tray/system-tray.ts` sang Rust.

### File: `src-tauri/src/tray.rs`

```rust
use tauri::{
    AppHandle, Manager,
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    menu::{Menu, MenuItem, PredefinedMenuItem},
};

pub fn create_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let show_hide = MenuItem::with_id(app, "toggle", "Show/Hide Pet", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit MiniPet", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "title", "🐾 MiniPet Control", false, None::<&str>)?,
        &separator,
        &show_hide,
        &settings,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("MiniPet Control Center")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_all_pets(app),
            "settings" => {
                let _ = super::window::settings::open_settings_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn toggle_all_pets(app: &AppHandle) {
    let overlays = super::window::overlay::get_all_overlay_windows(app);
    if overlays.is_empty() { return; }
    let any_visible = overlays.iter().any(|w| w.is_visible().unwrap_or(false));
    for win in overlays {
        if any_visible { let _ = win.hide(); }
        else { let _ = win.show(); }
    }
}
```

### Done Criteria
- [ ] Tray icon hiện trong menu bar macOS
- [ ] Click "Show/Hide Pet" → toggle tất cả overlay windows
- [ ] Click "Settings..." → mở settings window
- [ ] Click "Quit MiniPet" → app thoát hoàn toàn

---

## TASK-10: Implement Tauri Commands (IPC)
**Status**: ⬜ TODO
**Phase**: 3
**Depends on**: TASK-07, TASK-08, TASK-09
**Blocks**: TASK-11, TASK-12, TASK-13, TASK-14

### Goal
Port tất cả `ipc-handlers.ts` sang Tauri commands. Đây là bridge giữa frontend TypeScript và Rust backend.

### File: `src-tauri/src/commands.rs`

```rust
use tauri::{AppHandle, State, Manager, WebviewWindow};
use crate::AppState;

// ─── Pet Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn get_pet_list(state: State<'_, AppState>) -> Result<Vec<crate::pet::manager::PetListItem>, String> {
    Ok(state.pet_manager.lock().unwrap().get_installed_pets())
}

#[tauri::command]
pub async fn get_instance_config(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<serde_json::Value>, String> {
    Ok(state.pet_manager.lock().unwrap().get_pet_instance_config(&id))
}

#[tauri::command]
pub async fn spawn_pet(
    app: AppHandle,
    state: State<'_, AppState>,
    slug: String,
) -> Result<Option<crate::pet::manager::PetInstance>, String> {
    let instance = {
        let mut mgr = state.pet_manager.lock().unwrap();
        mgr.spawn_pet(&slug).await
    };
    if let Some(ref inst) = instance {
        crate::window::overlay::create_overlay_window(&app, &format!("pet-{}", inst.id), inst.x, inst.y)
            .map_err(|e| e.to_string())?;
        // Broadcast settings update
        let settings = state.pet_manager.lock().unwrap().get_settings();
        let _ = app.emit("settings:update", serde_json::json!({ "settings": settings }));
    }
    Ok(instance)
}

#[tauri::command]
pub async fn remove_pet(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.pet_manager.lock().unwrap().remove_pet(&id).await;
    crate::window::overlay::destroy_overlay_window(&app, &format!("pet-{}", id));
    let settings = state.pet_manager.lock().unwrap().get_settings();
    let _ = app.emit("settings:update", serde_json::json!({ "settings": settings }));
    Ok(())
}

#[tauri::command]
pub async fn get_spritesheet_url(
    state: State<'_, AppState>,
    slug: String,
) -> Result<Option<String>, String> {
    Ok(state.pet_manager.lock().unwrap().get_spritesheet_url(&slug))
}

#[tauri::command]
pub async fn delete_pet(
    app: AppHandle,
    state: State<'_, AppState>,
    slug: String,
) -> Result<Vec<crate::pet::manager::PetListItem>, String> {
    let result = state.pet_manager.lock().unwrap().delete_pet(&slug).await?;
    crate::window::overlay::destroy_all_overlay_windows(&app);
    // Respawn remaining pets
    let instances: Vec<_> = state.pet_manager.lock().unwrap().settings.active_pets.clone();
    for inst in instances {
        let _ = crate::window::overlay::create_overlay_window(
            &app, &format!("pet-{}", inst.id), inst.x, inst.y
        );
    }
    Ok(result)
}

// ─── Settings Commands ──────────────────────────────────────

#[tauri::command]
pub async fn get_settings(
    state: State<'_, AppState>,
) -> Result<crate::pet::manager::UserSettings, String> {
    Ok(state.pet_manager.lock().unwrap().get_settings())
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: serde_json::Value,
) -> Result<(), String> {
    state.pet_manager.lock().unwrap().update_settings(settings).await;
    let updated = state.pet_manager.lock().unwrap().get_settings();
    let _ = app.emit("settings:update", serde_json::json!({ "settings": updated }));
    Ok(())
}

// ─── Window Commands ────────────────────────────────────────

#[tauri::command]
pub fn set_ignore_cursor_events(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_window(window: WebviewWindow, delta_x: f64, delta_y: f64) {
    crate::window::overlay::move_window(&window, delta_x, delta_y);
}

#[tauri::command]
pub fn resize_window(window: WebviewWindow, width: f64, height: f64) {
    crate::window::overlay::resize_window(&window, width, height);
}

#[tauri::command]
pub async fn save_position(
    state: State<'_, AppState>,
    instance_id: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    state.pet_manager.lock().unwrap()
        .update_instance_position(&instance_id, x, y).await;
    Ok(())
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    crate::window::settings::open_settings_window(&app).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Pet Interaction Commands ───────────────────────────────

#[tauri::command]
pub fn ping_pet(app: AppHandle) {
    let _ = app.emit("pet:ping", ());
}

#[tauri::command]
pub fn start_alarm(app: AppHandle) {
    let _ = app.emit("pet:start-alarm", ());
}

#[tauri::command]
pub fn stop_alarm(app: AppHandle) {
    let _ = app.emit("pet:stop-alarm", ());
}

#[tauri::command]
pub fn notify_speaking(app: AppHandle) {
    let _ = app.emit("pet:someone-speaking", ());
}

#[tauri::command]
pub async fn eat_file(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    state.pet_manager.lock().unwrap().eat_files(paths).await
}
```

### Registration trong `lib.rs`
```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        commands::get_pet_list,
        commands::get_instance_config,
        commands::spawn_pet,
        commands::remove_pet,
        commands::get_spritesheet_url,
        commands::delete_pet,
        commands::get_settings,
        commands::update_settings,
        commands::set_ignore_cursor_events,
        commands::move_window,
        commands::resize_window,
        commands::save_position,
        commands::open_settings,
        commands::ping_pet,
        commands::start_alarm,
        commands::stop_alarm,
        commands::notify_speaking,
        commands::eat_file,
        // Pomodoro (TASK-11)
        commands::pomo_start,
        commands::pomo_pause,
        commands::pomo_reset,
        commands::pomo_update_config,
        commands::pomo_get_state,
        // Import (TASK-16)
        commands::import_pet,
    ])
```

### Done Criteria
- [ ] `cargo build` không lỗi compile
- [ ] Tất cả commands đăng ký trong `invoke_handler![]`
- [ ] `get_pet_list` trả về đúng JSON từ frontend test
- [ ] `spawn_pet` tạo được overlay window mới
- [ ] `update_settings` persist và broadcast đúng
