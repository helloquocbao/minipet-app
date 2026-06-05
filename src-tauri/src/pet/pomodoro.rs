use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::{interval, Duration};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
    pub is_work_session: bool,
    pub time_left: i32,
    pub focus_minutes: i32,
    pub break_minutes: i32,
    pub status: String, // "idle", "focus", "break"
    pub finished: bool,
}

pub struct PomodoroManager {
    pub running: Arc<AtomicBool>,
    pub cancel_handle: Option<tokio::task::JoinHandle<()>>,
}

impl PomodoroManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            cancel_handle: None,
        }
    }

    pub fn start(
        &mut self,
        focus: i32,
        break_min: i32,
        shared_state: Arc<Mutex<PomodoroState>>,
        app_handle: AppHandle,
    ) {
        if self.running.load(Ordering::SeqCst) {
            return;
        }

        let running = self.running.clone();
        let handle = app_handle.clone();
        let shared = shared_state.clone();

        running.store(true, Ordering::SeqCst);

        self.cancel_handle = Some(tokio::spawn(async move {
            // Initial sync and start
            {
                let mut s = shared.lock().await;
                s.focus_minutes = focus;
                s.break_minutes = break_min;
                s.status = if s.is_work_session {
                    "focus".to_string()
                } else {
                    "break".to_string()
                };
                s.finished = false;

                // Only sync time_left if it's currently 0 (meaning a session just finished or was reset)
                if s.time_left <= 0 {
                    s.time_left = if s.is_work_session {
                        focus * 60
                    } else {
                        break_min * 60
                    };
                }
            }

            let _ = handle.emit("pomo:tick", shared.lock().await.clone());

            let mut ticker = interval(Duration::from_secs(1));
            // Skip the first immediate tick of interval
            ticker.tick().await;

            loop {
                ticker.tick().await;

                if !running.load(Ordering::SeqCst) {
                    break;
                }

                let mut s = shared.lock().await;
                s.time_left -= 1;

                if s.time_left <= 0 {
                    // Session finished
                    running.store(false, Ordering::SeqCst);
                    let _ = handle.emit("pet:start-alarm", ());

                    let finished_type = if s.is_work_session { "focus" } else { "break" };
                    let _ = handle.emit("pomo:finished", finished_type);

                    // Prepare for NEXT session
                    s.is_work_session = !s.is_work_session;
                    s.status = "idle".to_string();
                    s.time_left = if s.is_work_session {
                        s.focus_minutes * 60
                    } else {
                        s.break_minutes * 60
                    };
                    s.finished = true;

                    let _ = handle.emit("pomo:tick", s.clone());
                    break;
                }

                let _ = handle.emit("pomo:tick", s.clone());
            }
        }));
    }

    pub async fn pause(&mut self, shared_state: &Arc<Mutex<PomodoroState>>, app_handle: &AppHandle) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self.cancel_handle.take() {
            h.abort();
        }

        let mut s = shared_state.lock().await;
        s.status = "idle".to_string();
        let _ = app_handle.emit("pomo:tick", s.clone());
    }

    pub async fn reset(&mut self, shared_state: &Arc<Mutex<PomodoroState>>, app_handle: &AppHandle) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self.cancel_handle.take() {
            h.abort();
        }

        let mut s = shared_state.lock().await;
        s.is_work_session = true;
        s.status = "idle".to_string();
        s.time_left = s.focus_minutes * 60;
        s.finished = false;
        let _ = app_handle.emit("pomo:tick", s.clone());
    }

    pub async fn update_config(
        &mut self,
        focus: i32,
        break_min: i32,
        shared_state: &Arc<Mutex<PomodoroState>>,
        app_handle: &AppHandle,
    ) {
        let mut s = shared_state.lock().await;
        s.focus_minutes = focus;
        s.break_minutes = break_min;
        if s.status == "idle" {
            s.time_left = if s.is_work_session {
                focus * 60
            } else {
                break_min * 60
            };
        }
        let _ = app_handle.emit("pomo:tick", s.clone());
    }
}
