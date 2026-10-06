pub mod ai;
mod server;

use ai::{AiEngine, SharedAiEngine};
use server::{ServerManager, ServerState};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let is_headless = args.iter().any(|arg| arg == "--headless" || arg == "daemon");

    let server_manager = ServerManager::new();
    let ai_engine: SharedAiEngine = Arc::new(Mutex::new(AiEngine::new()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(server_manager) as ServerState)
        .manage(ai_engine)
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Ensure the backend server is running
            let state = app.state::<ServerState>();
            let port = {
                let mut manager = state.lock().unwrap();
                manager
                    .ensure_started(app.handle())
                    .map_err(|e| Box::<dyn std::error::Error>::from(e))?
            };

            let target_url = format!("http://127.0.0.1:{port}");
            log::info!("Backend server active at {target_url}");

            // Setup main window
            if let Some(window) = app.get_webview_window("main") {
                if is_headless {
                    let _ = window.hide();
                    println!("🐾 Meowtrix running in headless daemon mode");
                    println!("   Local server: http://127.0.0.1:{port}");
                    println!("   Background workspace engine active.");
                } else {
                    log::info!("Navigating main window to {target_url}");
                    if let Ok(url) = target_url.parse() {
                        let _ = window.navigate(url);
                    }

                    // Daemon-first: Hide on close instead of terminating the app
                    let window_clone = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = window_clone.hide();
                            log::info!("Window closed: hidden to background tray.");
                        }
                    });
                }
            }

            // Setup system tray / status bar icon
            let open_item = MenuItemBuilder::with_id("open", "🐾 Open Meowtrix Window").build(app)?;
            let url_item = MenuItemBuilder::with_id("url_info", format!("🌐 Web: http://127.0.0.1:{port}")).enabled(false).build(app)?;
            let copy_item = MenuItemBuilder::with_id("copy_url", "📋 Copy Web URL").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "⏹️ Quit Meowtrix").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&open_item)
                .separator()
                .item(&url_item)
                .item(&copy_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .unwrap_or_else(|| {
                    let rgba = vec![255u8; 32 * 32 * 4];
                    tauri::image::Image::new_owned(rgba, 32, 32)
                });

            let port_str = target_url.clone();
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip(format!("Meowtrix (Port {port})"))
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "copy_url" => {
                            #[cfg(target_os = "macos")]
                            {
                                use std::io::Write;
                                if let Ok(mut child) = std::process::Command::new("pbcopy")
                                    .stdin(std::process::Stdio::piped())
                                    .spawn()
                                {
                                    if let Some(mut stdin) = child.stdin.take() {
                                        let _ = stdin.write_all(port_str.as_bytes());
                                    }
                                    let _ = child.wait();
                                }
                            }
                        }
                        "quit" => {
                            log::info!("User requested Quit from tray menu.");
                            if let Some(state) = app.try_state::<ServerState>() {
                                if let Ok(mut manager) = state.lock() {
                                    manager.stop();
                                }
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

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
