//! Update progress card: a small frameless, always-on-top window in the top-right corner
//! (where macOS notifications appear) that shows the app-styled download/install/restart
//! progress of a desktop self-update. Replaces the old `osascript display notification`,
//! which was posted as Script Editor and could be neither branded nor animated.
//!
//! The page (`public/update-progress.html`) is loaded from the bundled frontend, a local
//! origin, so it can reach the custom commands below without a capability. Rust pushes
//! updates with `eval`; the page also pulls the current state on load, since pushes sent
//! before it finishes loading are dropped.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "update-progress";

// The card is inset by a margin inside the transparent window so its CSS shadow isn't clipped.
const WIDTH: f64 = 392.0;
const HEIGHT: f64 = 144.0;
// Gap below the menu bar / from the screen edge, roughly where Notification Center banners sit.
const TOP_OFFSET: f64 = 30.0;
const RIGHT_OFFSET: f64 = 4.0;

#[derive(Clone, Serialize)]
pub struct HudState {
    pub version: String,
    /// "downloading" | "installing" | "restarting"
    pub phase: &'static str,
    pub downloaded: u64,
    pub total: Option<u64>,
}

static STATE: Mutex<HudState> = Mutex::new(HudState {
    version: String::new(),
    phase: "downloading",
    downloaded: 0,
    total: None,
});

fn push(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let state = STATE.lock().unwrap().clone();
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = w.eval(format!("window.mtxUpdate && window.mtxUpdate.render({json});"));
    }
}

/// Show the card in its "downloading" state for `version`.
pub fn show(app: &AppHandle, version: &str) {
    *STATE.lock().unwrap() = HudState {
        version: version.to_string(),
        phase: "downloading",
        downloaded: 0,
        total: None,
    };

    if let Some(w) = app.get_webview_window(LABEL) {
        push(app);
        let _ = w.show();
        return;
    }

    let (x, y) = match app.primary_monitor().ok().flatten() {
        Some(m) => {
            let scale = m.scale_factor();
            let pos = m.position();
            let size = m.size();
            (
                (pos.x as f64 + size.width as f64) / scale - WIDTH - RIGHT_OFFSET,
                pos.y as f64 / scale + TOP_OFFSET,
            )
        }
        None => (100.0, TOP_OFFSET),
    };

    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("update-progress.html".into()))
        .title("Meowtrix Update")
        .inner_size(WIDTH, HEIGHT)
        .position(x, y)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .build();
    if let Err(e) = built {
        log::warn!("Failed to open update progress window: {e}");
    }
}

/// Report download progress. Callers throttle; this always pushes.
pub fn progress(app: &AppHandle, downloaded: u64, total: Option<u64>) {
    {
        let mut st = STATE.lock().unwrap();
        st.downloaded = downloaded;
        st.total = total;
    }
    push(app);
}

pub fn set_phase(app: &AppHandle, phase: &'static str) {
    STATE.lock().unwrap().phase = phase;
    push(app);
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

#[tauri::command]
pub fn update_hud_state() -> HudState {
    STATE.lock().unwrap().clone()
}

/// The card's × button. Only hides the card; the update keeps going in the background.
#[tauri::command]
pub fn dismiss_update_hud(app: AppHandle) {
    close(&app);
}
