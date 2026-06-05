use tokio::process::Command;
use tauri::{AppHandle, Emitter};

use std::sync::Mutex;
use std::time::{Duration, Instant};

struct AppCache {
    name: Option<String>,
    last_updated: Instant,
}

static CACHE: Mutex<Option<AppCache>> = Mutex::new(None);
const CACHE_DURATION: Duration = Duration::from_secs(2);

#[allow(dead_code)]
pub async fn get_active_app() -> Option<String> {
    if cfg!(target_os = "macos") {
        {
            let cache = CACHE.lock().unwrap();
            if let Some(c) = &*cache {
                if c.last_updated.elapsed() < CACHE_DURATION {
                    return c.name.clone();
                }
            }
        } // Lock dropped here

        let output = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to get name of first process whose frontmost is true")
            .output()
            .await
            .ok()?;

        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let result = if name.is_empty() { None } else { Some(name) };

        {
            let mut cache = CACHE.lock().unwrap();
            *cache = Some(AppCache {
                name: result.clone(),
                last_updated: Instant::now(),
            });
        }

        result
    } else {
        None
    }
}

#[allow(dead_code)]
pub async fn get_browser_tab(browser: &str) -> Option<String> {
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
            .await
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

#[allow(dead_code)]
pub async fn get_browser_url(browser: &str) -> Option<String> {
    if cfg!(target_os = "macos") {
        let script = match browser {
            b if b.contains("Chrome") => {
                "tell application \"Google Chrome\" to get URL of active tab of front window"
            }
            b if b.contains("Safari") => {
                "tell application \"Safari\" to get URL of front document"
            }
            b if b.contains("Arc") => {
                "tell application \"Arc\" to get URL of active tab of front window"
            }
            _ => return None,
        };

        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .await
            .ok()?;
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if url.is_empty() {
            None
        } else {
            Some(url)
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
