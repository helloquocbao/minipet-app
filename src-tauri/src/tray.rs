use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle,
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
