mod commands;
mod intelligence;
mod pet;
mod tray;
mod window;

use tauri_plugin_deep_link::DeepLinkExt;

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
    pub last_clipboard: Mutex<String>,
    pub reqwest_client: reqwest::Client,
    pub llama_process: Mutex<Option<std::process::Child>>,
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
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in args {
                if arg.starts_with("minipet://") {
                    eprintln!("[DeepLink] Received: {}", arg);
                    let _ = app.emit("single-instance://deep-link", arg);
                    break;
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            app.deep_link().register_all().unwrap_or_else(|e| {
                eprintln!("[DeepLink] Failed to register: {}", e);
            });

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

            let reqwest_client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default();

            let state = AppState {
                pet_manager: Mutex::new(pet_manager),
                pomodoro: Mutex::new(pomodoro),
                pomo_state,
                last_clipboard: Mutex::new(String::new()),
                reqwest_client,
                llama_process: Mutex::new(None),
            };

            app.manage(state);

            // Initialize pet manager and spawn windows
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let (default_x, default_y) = if let Ok(Some(monitor)) = handle.primary_monitor() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let screen_w = size.width as f64 / scale;
                    let screen_h = size.height as f64 / scale;
                    ((screen_w - 320.0) / 2.0, (screen_h - 320.0) / 2.0)
                } else {
                    (1400.0, 700.0)
                };

                let state: tauri::State<'_, AppState> = handle.state();
                let mut mgr = state.pet_manager.lock().await;
                if let Err(e) = mgr.init(&resource_dir, default_x, default_y).await {
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
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    if let Ok(text) = cb_handle.clipboard().read_text() {
                        // Skip if text is empty or too long (> 5000 chars), but always allow deep links
                        if text.is_empty() {
                            continue;
                        }

                        let state: tauri::State<'_, AppState> = cb_handle.state();
                        let mut last_cb = state.last_clipboard.lock().await;

                        if text != *last_cb {
                            *last_cb = text.clone();
                            let trimmed = text.trim();
                            // Deep link URL pasted (dev mode fallback)
                            if trimmed.starts_with("minipet://") {
                                eprintln!("[Clipboard] Deep link detected: {}", &trimmed[..trimmed.len().min(80)]);
                                let _ = cb_handle.emit("single-instance://deep-link", trimmed);
                            }
                            // Check for Object ID (0x + 64 hex) or Coin Type (0x...::...::...)
                            else if trimmed.len() <= 2000 && ((trimmed.starts_with("0x") && trimmed.len() == 66) || 
                               (trimmed.starts_with("0x") && trimmed.contains("::"))) {
                                let _ = cb_handle.emit("clipboard://sui-address-copied", trimmed);
                            }
                        }
                    }
                }
            });

            tray::create(app.handle()).map_err(|e| {
                Box::new(std::io::Error::other(e))
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
            commands::get_active_app,
            commands::get_browser_tab,
            commands::get_browser_url,
            commands::check_model_exists,
            commands::delete_model,
            commands::download_model,
            commands::start_ai_server,
            commands::generate_agent_keypair,
            commands::re_raise_window,
            commands::get_monitor_work_area,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| match event {
            tauri::RunEvent::Reopen { .. } => {
                let _ = crate::window::settings::open(app_handle);
            }            tauri::RunEvent::ExitRequested { .. } => {
                let state = app_handle.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    // Use timeout to prevent deadlocks during exit
                    let save_future = async {
                        if let Ok(mut mgr) = tokio::time::timeout(
                            std::time::Duration::from_secs(2),
                            state.pet_manager.lock()
                        ).await {
                            if mgr.is_dirty {
                                mgr.save_settings().await;
                            }
                        }
                    };
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), save_future).await;

                    // Kill llama process
                    if let Ok(mut process_lock) = tokio::time::timeout(
                        std::time::Duration::from_secs(1),
                        state.llama_process.lock()
                    ).await {
                        if let Some(mut child) = process_lock.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                });
            }
            _ => {}
        });
}
