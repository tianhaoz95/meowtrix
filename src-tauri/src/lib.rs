mod server;

use server::{ServerManager, ServerState};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_manager = ServerManager::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(server_manager) as ServerState)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Ensure the Node backend is running
            let state = app.state::<ServerState>();
            let port = {
                let mut manager = state.lock().unwrap();
                manager
                    .ensure_started(app.handle())
                    .map_err(|e| Box::<dyn std::error::Error>::from(e))?
            };

            // Navigate the main window to the local server
            if let Some(window) = app.get_webview_window("main") {
                let target_url = format!("http://127.0.0.1:{port}");
                log::info!("Navigating main window to {target_url}");
                if let Ok(url) = target_url.parse() {
                    let _ = window.navigate(url);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            log::info!("Tauri app exiting, stopping background server...");
            if let Some(state) = app_handle.try_state::<ServerState>() {
                if let Ok(mut manager) = state.lock() {
                    manager.stop();
                }
            }
        }
    });
}
