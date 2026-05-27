use crate::pet::manager::{PetInstance, PetListItem, UserSettings};
use crate::pet::pomodoro::PomodoroState;
use crate::AppState;
use tauri::{AppHandle, Emitter, Manager, State};

// --- Pet Commands ---

#[tauri::command]
pub async fn get_installed_pets(state: State<'_, AppState>) -> Result<Vec<PetListItem>, String> {
    let mgr = state.pet_manager.lock().await;
    Ok(mgr.get_installed_pets())
}

#[tauri::command]
pub async fn get_pet_instance_config(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<serde_json::Value, String> {
    let mgr = state.pet_manager.lock().await;
    mgr.get_pet_instance_config(&instance_id).await
        .ok_or_else(|| "Instance not found".to_string())
}

#[tauri::command]
pub async fn spawn_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    slug: String,
) -> Result<PetInstance, String> {
    let mut mgr = state.pet_manager.lock().await;
    
    // Destroy existing pet windows since we only allow 1 pet
    crate::window::overlay::destroy_all(&app);
    
    let instance = mgr.spawn_pet(&slug).await?;
    crate::window::overlay::create(&app, &instance.id, instance.x, instance.y)?;
    // Notify settings window
    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(instance)
}

#[tauri::command]
pub async fn remove_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    instance_id: String,
) -> Result<(), String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.remove_pet(&instance_id).await?;
    crate::window::overlay::destroy(&app, &instance_id);
    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(())
}

#[tauri::command]
pub async fn get_spritesheet_url(
    state: State<'_, AppState>,
    slug: String,
) -> Result<String, String> {
    let mgr = state.pet_manager.lock().await;
    mgr.get_spritesheet_url(&slug)
        .ok_or_else(|| "Pet not found".to_string())
}

#[tauri::command]
pub async fn get_spritesheet_data(
    state: State<'_, AppState>,
    slug: String,
) -> Result<String, String> {
    let mgr = state.pet_manager.lock().await;
    let path = mgr
        .get_spritesheet_path(&slug)
        .ok_or_else(|| "Pet not found".to_string())?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("webp");
    let mime = if ext == "png" {
        "image/png"
    } else {
        "image/webp"
    };
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 {
            chunk[1] as usize
        } else {
            0
        };
        let b2 = if chunk.len() > 2 {
            chunk[2] as usize
        } else {
            0
        };
        out.push(CHARS[b0 >> 2] as char);
        out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 {
            CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[b2 & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

// --- Settings Commands ---

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<UserSettings, String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.load_settings().await;
    Ok(mgr.get_settings())
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    app: AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.update_settings(settings.clone()).await;

    // Reset last_clipboard if settings contains empty SUI address (disconnect)
    if let Some(sui_addr) = settings.get("suiAddress") {
        if sui_addr.as_str().map(|s| s.is_empty()).unwrap_or(false) {
            let mut last_cb = state.last_clipboard.lock().await;
            *last_cb = String::new();
        }
    }

    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(())
}

// --- Window Commands ---

#[tauri::command]
pub async fn save_position(
    state: State<'_, AppState>,
    app: AppHandle,
    instance_id: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.update_instance_position(&instance_id, x, y).await;
    let positions = mgr.get_positions();
    let _ = app.emit("pets:positions-updated", positions);
    Ok(())
}

#[tauri::command]
pub fn resize_window_keep_bottom(
    app: AppHandle,
    instance_id: String,
    width: f64,
    height: f64,
) -> Result<tauri::LogicalPosition<f64>, String> {
    crate::window::overlay::resize_keep_bottom(&app, &instance_id, width, height)
}

#[tauri::command]
pub fn toggle_visibility(app: AppHandle) -> Result<(), String> {
    let mut visible = true;
    // Check first pet window to determine current state
    if let Some(win) = app
        .webview_windows()
        .values()
        .find(|w| w.label().starts_with("overlay-"))
    {
        visible = !win.is_visible().unwrap_or(true);
    }

    for window in app.webview_windows().values() {
        let label = window.label();
        if label.starts_with("overlay-") {
            if visible {
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn set_drag_mode(app: AppHandle, instance_id: String, enabled: bool) {
    crate::window::overlay::set_drag_mode(&app, &instance_id, enabled);
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    crate::window::settings::open(&app)
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sui_rpc_call(
    method: String,
    params: serde_json::Value,
    rpc_url: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    });

    let res = client
        .post(&rpc_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

// --- File Eating ---

#[tauri::command]
pub async fn eat_files(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    let mgr = state.pet_manager.lock().await;
    mgr.eat_files(paths).await
}

// --- Pet Import/Delete ---

#[tauri::command]
pub async fn import_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    source_path: String,
) -> Result<Vec<PetListItem>, String> {
    let mut mgr = state.pet_manager.lock().await;
    let result = mgr.import_pet(&source_path).await?;
    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(result)
}

#[tauri::command]
pub async fn delete_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    slug: String,
) -> Result<Vec<PetListItem>, String> {
    let mut mgr = state.pet_manager.lock().await;
    let result = mgr.delete_pet(&slug).await?;

    // Re-spawn windows
    crate::window::overlay::destroy_all(&app);
    for inst in &mgr.settings.active_pets {
        let _ = crate::window::overlay::create(&app, &inst.id, inst.x, inst.y);
    }

    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(result)
}

// --- Pomodoro Commands ---

#[tauri::command]
pub async fn pomo_get_state(state: State<'_, AppState>) -> Result<PomodoroState, String> {
    let s = state.pomo_state.lock().await;
    Ok(s.clone())
}

#[tauri::command]
pub async fn pomo_start(
    state: State<'_, AppState>,
    app: AppHandle,
    focus: i32,
    #[allow(non_snake_case)] breakMin: i32,
) -> Result<(), String> {
    let mut pomo = state.pomodoro.lock().await;
    pomo.start(focus, breakMin, state.pomo_state.clone(), app);
    Ok(())
}

#[tauri::command]
pub async fn pomo_pause(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut pomo = state.pomodoro.lock().await;
    pomo.pause(&state.pomo_state, &app);
    Ok(())
}

#[tauri::command]
pub async fn pomo_reset(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut pomo = state.pomodoro.lock().await;
    pomo.reset(&state.pomo_state, &app);
    Ok(())
}

#[tauri::command]
pub async fn pomo_update_config(
    state: State<'_, AppState>,
    app: AppHandle,
    focus: i32,
    #[allow(non_snake_case)] breakMin: i32,
) -> Result<(), String> {
    let mut pomo = state.pomodoro.lock().await;
    pomo.update_config(focus, breakMin, &state.pomo_state, &app);
    Ok(())
}

// --- Broadcast Commands ---

#[tauri::command]
pub fn broadcast_pet_event(app: AppHandle, event: String, payload: serde_json::Value) {
    let _ = app.emit(&event, payload);
}

#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[WebView] {}", message);
}

#[tauri::command]
pub fn get_active_app() -> Option<String> {
    crate::intelligence::get_active_app()
}

#[tauri::command]
pub fn get_browser_tab(browser: String) -> Option<String> {
    crate::intelligence::get_browser_tab(&browser)
}

#[tauri::command]
pub fn get_browser_url(browser: String) -> Option<String> {
    crate::intelligence::get_browser_url(&browser)
}

// --- Local AI Commands ---

#[tauri::command]
pub fn check_model_exists(app: AppHandle) -> bool {
    let app_data_dir = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir.join("qwen2.5-1.5b-sui.gguf");
    model_path.exists()
}

#[tauri::command]
pub async fn download_model(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir.join("qwen2.5-1.5b-sui.gguf");
    
    if model_path.exists() {
        return Ok(());
    }
    
    let url = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf";
    
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let total_size = response.content_length().unwrap_or(0);
    
    use futures_util::StreamExt;
    use std::io::Write;
    
    let mut file = std::fs::File::create(&model_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        
        let _ = app.emit("model-download-progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total_size,
            "progress": progress
        }));
    }
    
    Ok(())
}

#[tauri::command]
pub fn start_ai_server(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir.join("qwen2.5-1.5b-sui.gguf");
    
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let mut bin_path = resource_dir.join("bin/llama-server-aarch64-apple-darwin");
    
    if !bin_path.exists() {
        let candidates = vec![
            resource_dir.join("../../bin/llama-server-aarch64-apple-darwin"),
            resource_dir.join("../../../bin/llama-server-aarch64-apple-darwin"),
            std::env::current_dir().unwrap_or_default().join("bin/llama-server-aarch64-apple-darwin"),
            std::env::current_dir().unwrap_or_default().join("src-tauri/bin/llama-server-aarch64-apple-darwin"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                bin_path = candidate;
                break;
            }
        }
    }
    
    eprintln!("[Rust Local AI] Starting AI server...");
    eprintln!("[Rust Local AI] Binary path: {:?}", bin_path);
    eprintln!("[Rust Local AI] Model path: {:?}", model_path);
    eprintln!("[Rust Local AI] Binary exists: {}", bin_path.exists());
    eprintln!("[Rust Local AI] Model exists: {}", model_path.exists());
    
    let child = std::process::Command::new(&bin_path)
        .arg("-m")
        .arg(&model_path)
        .arg("--port")
        .arg("8080")
        .arg("-c")
        .arg("2048")
        .spawn();
        
    match child {
        Ok(c) => {
            eprintln!("[Rust Local AI] Server successfully spawned with PID: {}", c.id());
            Ok(())
        }
        Err(e) => {
            eprintln!("[Rust Local AI] Failed to spawn server: {:?}", e);
            Err(e.to_string())
        }
    }
}

