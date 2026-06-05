use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

const OVERLAY_WIDTH: f64 = 320.0;
const OVERLAY_HEIGHT: f64 = 320.0;

/// Clamps a logical position so the window (width x height) stays within
/// the monitor's work area (excludes Dock on macOS, Taskbar on Windows).
fn clamp_to_screen(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let wa = monitor.work_area();
        // work_area is in physical pixels — convert to logical
        let wa_x = wa.position.x as f64 / scale;
        let wa_y = wa.position.y as f64 / scale;
        let wa_w = wa.size.width as f64 / scale;
        let wa_h = wa.size.height as f64 / scale;
        let clamped_x = x.max(wa_x).min((wa_x + wa_w - width).max(wa_x));
        let clamped_y = y.max(wa_y).min((wa_y + wa_h - height).max(wa_y));
        return (clamped_x, clamped_y);
    }
    (x, y)
}

pub fn create(app: &AppHandle, instance_id: &str, x: f64, y: f64) -> Result<(), String> {
    let label = format!("overlay-{}", instance_id);

    // Check if window already exists
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    // Clamp spawn position so pet never starts off-screen
    let (safe_x, safe_y) = clamp_to_screen(app, x, y, OVERLAY_WIDTH, OVERLAY_HEIGHT);

    // 1. Create Pet Overlay Window
    let url = WebviewUrl::App(format!("renderer/overlay/index.html?id={}", instance_id).into());
    let win = WebviewWindowBuilder::new(app, &label, url)
        .title(format!("MiniPet-{}", instance_id))
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .position(safe_x, safe_y)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .build()
        .map_err(|e| e.to_string())?;

    let _ = win.set_position(LogicalPosition::new(safe_x, safe_y));

    // 2. Create Speech Bubble Window
    let speech_label = format!("speech-{}", instance_id);
    if app.get_webview_window(&speech_label).is_none() {
        let speech_y = (safe_y - 160.0).max(0.0);
        let speech_url = WebviewUrl::App(format!("renderer/speech/index.html?id={}", instance_id).into());
        let speech_win = WebviewWindowBuilder::new(app, &speech_label, speech_url)
            .title(format!("Speech-{}", instance_id))
            .inner_size(260.0, 160.0)
            .position(safe_x, speech_y)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .accept_first_mouse(false)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;

        let _ = speech_win.set_ignore_cursor_events(true);
    }

    Ok(())
}

pub fn resize_keep_bottom(
    app: &AppHandle,
    instance_id: &str,
    width: f64,
    height: f64,
) -> Result<LogicalPosition<f64>, String> {
    let label = format!("overlay-{}", instance_id);
    if let Some(win) = app.get_webview_window(&label) {
        let scale_factor = win.scale_factor().map_err(|e| e.to_string())?;

        let current_pos = win.outer_position().map_err(|e| e.to_string())?;
        let current_size = win.inner_size().map_err(|e| e.to_string())?;

        let logical_pos = current_pos.to_logical::<f64>(scale_factor);
        let logical_size = current_size.to_logical::<f64>(scale_factor);

        // Skip if size hasn't changed — avoids unnecessary move+resize that causes flicker
        let size_unchanged = (logical_size.width - width).abs() < 1.0
            && (logical_size.height - height).abs() < 1.0;
        if size_unchanged {
            return Ok(logical_pos);
        }

        let delta_h = height - logical_size.height;
        let delta_w = width - logical_size.width;

        let new_y = logical_pos.y - delta_h;
        let new_x = logical_pos.x - (delta_w / 2.0);

        let (clamped_x, clamped_y) = clamp_to_screen(app, new_x, new_y, width, height);
        let new_pos = LogicalPosition::new(clamped_x, clamped_y);

        // Move then resize atomically
        let _ = win.set_position(new_pos);
        let _ = win.set_size(LogicalSize::new(width, height));

        return Ok(new_pos);
    }
    Err("Window not found".to_string())
}

/// Re-raises the overlay window to always_on_top (safe, no NSWindow hacks).
pub fn re_raise_window(app: &AppHandle, instance_id: &str) {
    let label = format!("overlay-{}", instance_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_always_on_top(true);
    }
    let speech_label = format!("speech-{}", instance_id);
    if let Some(win) = app.get_webview_window(&speech_label) {
        let _ = win.set_always_on_top(true);
    }
}

pub fn destroy(app: &AppHandle, instance_id: &str) {
    let label = format!("overlay-{}", instance_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    let speech_label = format!("speech-{}", instance_id);
    if let Some(win) = app.get_webview_window(&speech_label) {
        let _ = win.close();
    }
}
// ... rest of the file ...

pub fn destroy_all(app: &AppHandle) {
    let windows: Vec<_> = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with("overlay-") || k.starts_with("speech-"))
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
