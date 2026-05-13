use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

pub fn create(app: &AppHandle) -> Result<(), String> {
    let header_item = MenuItemBuilder::with_id("header", "🐾 MiniPet Control")
        .enabled(false)
        .build(app)
        .map_err(|e| e.to_string())?;

    let toggle_item = MenuItemBuilder::with_id("toggle", "Show/Hide Pet")
        .build(app)
        .map_err(|e| e.to_string())?;

    let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
        .build(app)
        .map_err(|e| e.to_string())?;

    let pomo_start = MenuItemBuilder::with_id("pomo_start", "Start Pomodoro ▶")
        .build(app)
        .map_err(|e| e.to_string())?;

    let pomo_stop = MenuItemBuilder::with_id("pomo_stop", "Stop Pomodoro ⏹")
        .build(app)
        .map_err(|e| e.to_string())?;

    let quit_item = MenuItemBuilder::with_id("quit", "Quit MiniPet")
        .accelerator("Cmd+Q")
        .build(app)
        .map_err(|e| e.to_string())?;

    let sep1 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&header_item)
        .item(&sep1)
        .item(&toggle_item)
        .item(&settings_item)
        .item(&sep2)
        .item(&pomo_start)
        .item(&pomo_stop)
        .item(&sep2) // reuse sep2 for consistency or add sep3
        .item(&quit_item)
        .build()
        .map_err(|e| e.to_string())?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
        .map_err(|e| e.to_string())?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("MiniPet")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => {
                let _ = crate::commands::toggle_visibility(app.clone());
            }
            "settings" => {
                let _ = super::window::settings::open(app);
            }
            "pomo_start" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state: tauri::State<'_, crate::AppState> = app.state();
                    let mut pomo = state.pomodoro.lock().await;
                    pomo.start(25, 5, state.pomo_state.clone(), app.clone());
                });
            }
            "pomo_stop" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state: tauri::State<'_, crate::AppState> = app.state();
                    let mut pomo = state.pomodoro.lock().await;
                    pomo.reset(&state.pomo_state, &app);
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left click on macOS opens settings
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let _ = super::window::settings::open(app);
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}
