use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_WIDTH: f64 = 1080.0;
const SETTINGS_HEIGHT: f64 = 720.0;
const LABEL: &str = "settings";

pub fn open(app: &AppHandle) -> Result<(), String> {
    // If already exists, just show and focus
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let url = WebviewUrl::App("renderer/settings/index.html".into());

    WebviewWindowBuilder::new(app, LABEL, url)
        .title("MiniPet Settings")
        .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .accept_first_mouse(true)
        .devtools(cfg!(debug_assertions))
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
