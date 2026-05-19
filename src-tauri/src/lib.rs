mod commands;
mod intelligence;
mod pet;
mod tray;
mod window;

use pet::manager::PetManager;
use pet::pomodoro::{PomodoroManager, PomodoroState};
use std::sync::Arc;
use tauri::{Manager, Emitter};
use tokio::sync::Mutex;
use tauri_plugin_clipboard_manager::ClipboardExt;

pub struct AppState {
    pub pet_manager: Mutex<PetManager>,
    pub pomodoro: Mutex<PomodoroManager>,
    pub pomo_state: Arc<Mutex<PomodoroState>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");

            std::fs::create_dir_all(&app_data_dir).ok();

            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to get resource dir");

            let pet_manager = PetManager::new(app_data_dir);
            let pomodoro = PomodoroManager::new();
            let pomo_state = Arc::new(Mutex::new(crate::pet::pomodoro::PomodoroState {
                is_work_session: true,
                time_left: 25 * 60,
                focus_minutes: 25,
                break_minutes: 5,
                status: "idle".to_string(),
                finished: false,
            }));

            let state = AppState {
                pet_manager: Mutex::new(pet_manager),
                pomodoro: Mutex::new(pomodoro),
                pomo_state,
            };

            app.manage(state);

            // Initialize pet manager and spawn windows
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: tauri::State<'_, AppState> = handle.state();
                let mut mgr = state.pet_manager.lock().await;
                if let Err(e) = mgr.init(&resource_dir).await {
                    eprintln!("[MiniPet] PetManager init failed: {}", e);
                    return;
                }

                eprintln!("[MiniPet] Pets loaded: {}", mgr.pets.len());
                eprintln!("[MiniPet] Active pets: {}", mgr.settings.active_pets.len());
                for inst in &mgr.settings.active_pets {
                    eprintln!(
                        "[MiniPet] Spawning: {} at ({}, {})",
                        inst.slug, inst.x, inst.y
                    );
                }

                // Spawn overlay windows for all active pets
                let active_pets = mgr.settings.active_pets.clone();
                drop(mgr);

                for inst in &active_pets {
                    match window::overlay::create(&handle, &inst.id, inst.x, inst.y) {
                        Ok(_) => eprintln!("[MiniPet] Window created: {}", inst.id),
                        Err(e) => eprintln!("[MiniPet] Window create failed: {}", e),
                    }
                }

                // Start SUI Blockchain Monitor (Disabled - Moving to Frontend TS SDK)
                // let monitor = blockchain::SuiMonitor::new(handle);
                // monitor.start_monitoring().await;
            });

            // Start Lightweight Clipboard Monitor for Security Agent
            let cb_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last_clipboard = String::new();
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if let Ok(text) = cb_handle.clipboard().read_text() {
                        // Tối ưu: Bỏ qua nếu text quá dài (> 500 ký tự) để tránh tốn CPU/RAM
                        if text.len() > 500 {
                            continue;
                        }

                        if text != last_clipboard {
                            last_clipboard = text.clone();
                            let trimmed = text.trim();
                            // Check for Object ID (0x + 64 hex) or Coin Type (0x...::...::...)
                            if (trimmed.starts_with("0x") && trimmed.len() == 66) || 
                               (trimmed.starts_with("0x") && trimmed.contains("::")) {
                                let _ = cb_handle.emit("clipboard://sui-address-copied", trimmed);
                            }
                        }
                    }
                }
            });

            // Create system tray
            tray::create(app.handle()).map_err(|e| {
                Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
                    as Box<dyn std::error::Error>
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_installed_pets,
            commands::get_pet_instance_config,
            commands::spawn_pet,
            commands::remove_pet,
            commands::get_spritesheet_url,
            commands::get_spritesheet_data,
            commands::get_settings,
            commands::update_settings,
            commands::save_position,
            commands::set_drag_mode,
            commands::open_settings,
            commands::open_url,
            commands::sui_rpc_call,
            commands::eat_files,
            commands::import_pet,
            commands::delete_pet,
            commands::pomo_get_state,
            commands::pomo_start,
            commands::pomo_pause,
            commands::pomo_reset,
            commands::pomo_update_config,
            commands::broadcast_pet_event,
            commands::debug_log,
            commands::resize_window_keep_bottom,
            commands::toggle_visibility,
            commands::exit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = crate::window::settings::open(app_handle);
            }
        });
}
