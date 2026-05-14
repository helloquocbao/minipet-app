use std::process::Command;
use tauri::{AppHandle, Emitter};

#[allow(dead_code)]
pub fn get_active_app() -> Option<String> {
    if cfg!(target_os = "macos") {
        let output = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to get name of first process whose frontmost is true")
            .output()
            .ok()?;
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    } else {
        None
    }
}

#[allow(dead_code)]
pub fn get_browser_tab(browser: &str) -> Option<String> {
    if cfg!(target_os = "macos") {
        let script = match browser {
            b if b.contains("Chrome") => {
                "tell application \"Google Chrome\" to get title of active tab of front window"
            }
            b if b.contains("Safari") => {
                "tell application \"Safari\" to get name of current tab of front window"
            }
            b if b.contains("Arc") => {
                "tell application \"Arc\" to get title of active tab of front window"
            }
            _ => return None,
        };

        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .ok()?;
        let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if title.is_empty() {
            None
        } else {
            Some(title)
        }
    } else {
        None
    }
}

/// Emits a "pet:say" event to all overlay windows with a context-aware comment
#[allow(dead_code)]
pub fn emit_context_comment(app: &AppHandle, text: &str) {
    let _ = app.emit("pet:say", text);
}
