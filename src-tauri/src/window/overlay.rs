use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, LogicalPosition, LogicalSize};

const OVERLAY_WIDTH: f64 = 192.0;
const OVERLAY_HEIGHT: f64 = 208.0;

const SPEECH_WIDTH: f64 = 300.0;
const SPEECH_HEIGHT: f64 = 80.0;

pub fn create(app: &AppHandle, instance_id: &str, x: f64, y: f64) -> Result<(), String> {
    let label = format!("overlay-{}", instance_id);
    let speech_label = format!("speech-{}", instance_id);

    // Check if window already exists
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    // 1. Create Pet Overlay Window
    let url = WebviewUrl::App(format!("renderer/overlay/index.html?id={}", instance_id).into());
    let win = WebviewWindowBuilder::new(app, &label, url)
        .title(&format!("MiniPet-{}", instance_id))
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .position(x, y)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .build()
        .map_err(|e| e.to_string())?;
    
    let _ = win.set_position(LogicalPosition::new(x, y));

    // 2. Create Separate Speech Window
    let speech_url = WebviewUrl::App(format!("renderer/speech/index.html?id={}", instance_id).into());
    let speech_win = WebviewWindowBuilder::new(app, &speech_label, speech_url)
        .title(&format!("MiniPet-Speech-{}", instance_id))
        .inner_size(SPEECH_WIDTH, SPEECH_HEIGHT)
        // Position above pet: center horizontally relative to pet width
        .position(x - (SPEECH_WIDTH - OVERLAY_WIDTH) / 2.0, y - SPEECH_HEIGHT)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // Hidden by default
        .build()
        .map_err(|e| e.to_string())?;

    let _ = speech_win.set_position(LogicalPosition::new(x - (SPEECH_WIDTH - OVERLAY_WIDTH) / 2.0, y - SPEECH_HEIGHT));
    let _ = speech_win.set_ignore_cursor_events(true);

    Ok(())
}

pub fn resize_keep_bottom(app: &AppHandle, instance_id: &str, width: f64, height: f64) -> Result<LogicalPosition<f64>, String> {
    let label = format!("overlay-{}", instance_id);
    if let Some(win) = app.get_webview_window(&label) {
        let scale_factor = win.scale_factor().map_err(|e| e.to_string())?;
        
        let current_pos = win.outer_position().map_err(|e| e.to_string())?;
        let current_size = win.inner_size().map_err(|e| e.to_string())?;

        let logical_pos = current_pos.to_logical::<f64>(scale_factor);
        let logical_size = current_size.to_logical::<f64>(scale_factor);

        // Calculate deltas to keep bottom-center fixed
        let delta_h = height - logical_size.height;
        let delta_w = width - logical_size.width;
        
        let new_y = logical_pos.y - delta_h;
        let new_x = logical_pos.x - (delta_w / 2.0);
        
        let new_pos = LogicalPosition::new(new_x, new_y);

        // Perform move and resize. 
        // Swap order: move first, then resize to minimize jump artifacts.
        let _ = win.set_position(new_pos);
        let _ = win.set_size(LogicalSize::new(width, height));
        
        return Ok(new_pos);
    }
    Err("Window not found".to_string())
}

pub fn destroy(app: &AppHandle, instance_id: &str) {
    let label = format!("overlay-{}", instance_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
}
// ... rest of the file ...


pub fn destroy_all(app: &AppHandle) {
    let windows: Vec<_> = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with("overlay-"))
        .cloned()
        .collect();

    for label in windows {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    }
}

pub fn set_drag_mode(app: &AppHandle, instance_id: &str, enabled: bool) {
    let label = format!("overlay-{}", instance_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_ignore_cursor_events(!enabled);
    }
}
