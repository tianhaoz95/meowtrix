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
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|arg| arg == "infer" || arg == "--infer") {
        let rt = tokio::runtime::Runtime::new().expect("Failed to start Tokio runtime for CLI inference");
        if let Err(e) = rt.block_on(ai::run_cli_infer(&args)) {
            eprintln!("Error running inference: {e:#}");
            std::process::exit(1);
        }
        std::process::exit(0);
    }

    let is_headless = args.iter().any(|arg| arg == "--headless" || arg == "daemon");

    let server_manager = ServerManager::new();
    let ai_engine: SharedAiEngine = Arc::new(tokio::sync::Mutex::new(AiEngine::new()));

    let ai_engine_clone = Arc::clone(&ai_engine);
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

            // Start native Mistral.rs AI daemon on free or preferred port
            let ai_port = ai::start_ai_server(ai_engine_clone, 9124, Some(app.handle().clone()))
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            log::info!("AI inference daemon listening on port {ai_port}");

            // Ensure the backend server is running, passing ai_port to Node
            let state = app.state::<ServerState>();
            let port = {
                let mut manager = state.lock().unwrap();
                manager
                    .ensure_started(app.handle(), ai_port)
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
            let check_update_item = MenuItemBuilder::with_id("check_update", "🔄 Check for Updates...").build(app)?;
            let update_restart_item = MenuItemBuilder::with_id("update_restart", "🚀 Update & Restart").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "⏹️ Quit Meowtrix").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&open_item)
                .separator()
                .item(&url_item)
                .item(&copy_item)
                .separator()
                .item(&check_update_item)
                .item(&update_restart_item)
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
                        "check_update" => {
                            check_for_updates(app.clone());
                        }
                        "update_restart" => {
                            update_and_restart(app.clone());
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

fn check_for_updates(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.eval("if (typeof checkForUpdateNow === 'function') { checkForUpdateNow(); }");
        }

        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => {
                    log::info!("Update available: v{}", update.version);
                    #[cfg(target_os = "macos")]
                    {
                        let script = format!(
                            "display alert \"Update Available\" message \"Meowtrix v{} is available.\\n\\nSelect 'Update & Restart' from the tray menu to install.\" as informational buttons {{\"OK\"}} default button \"OK\"",
                            update.version.replace('"', "\\\"")
                        );
                        let _ = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(script)
                            .spawn();
                    }
                }
                Ok(None) => {
                    log::info!("Meowtrix is up to date");
                    #[cfg(target_os = "macos")]
                    {
                        let cur_ver = app.package_info().version.to_string();
                        let script = format!(
                            "display alert \"Meowtrix is up to date\" message \"You are running the latest version (v{}).\" as informational buttons {{\"OK\"}} default button \"OK\"",
                            cur_ver
                        );
                        let _ = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(script)
                            .spawn();
                    }
                }
                Err(e) => {
                    log::error!("Failed to check for updates: {e}");
                    #[cfg(target_os = "macos")]
                    {
                        let err_msg = e.to_string();
                        let script = format!(
                            "display alert \"Update Check Failed\" message \"{}\" as warning buttons {{\"OK\"}} default button \"OK\"",
                            err_msg.replace('"', "\\\"")
                        );
                        let _ = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(script)
                            .spawn();
                    }
                }
            },
            Err(e) => {
                log::error!("Failed to initialize updater: {e}");
            }
        }
    });
}

fn update_and_restart(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.eval("if (typeof applyUpdateNow === 'function') { applyUpdateNow(); }");
        }

        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => {
                    log::info!("Downloading and applying update v{}...", update.version);
                    #[cfg(target_os = "macos")]
                    {
                        let script = format!(
                            "display notification \"Downloading Meowtrix v{}... The app will restart automatically once completed.\" with title \"Meowtrix Update\"",
                            update.version
                        );
                        let _ = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(script)
                            .spawn();
                    }

                    let app_clone = app.clone();
                    match update.download_and_install(|_downloaded, _total| {}, || {}).await {
                        Ok(()) => {
                            log::info!("Update installed. Restarting Meowtrix...");
                            if let Some(state) = app_clone.try_state::<ServerState>() {
                                if let Ok(mut manager) = state.lock() {
                                    manager.stop();
                                }
                            }
                            app_clone.restart();
                        }
                        Err(e) => {
                            log::error!("Failed to install update: {e}");
                            #[cfg(target_os = "macos")]
                            {
                                let err_msg = e.to_string();
                                let script = format!(
                                    "display alert \"Update Failed\" message \"{}\" as critical buttons {{\"OK\"}} default button \"OK\"",
                                    err_msg.replace('"', "\\\"")
                                );
                                let _ = std::process::Command::new("osascript")
                                    .arg("-e")
                                    .arg(script)
                                    .spawn();
                            }
                        }
                    }
                }
                Ok(None) => {
                    log::info!("No update available. Asking if user wants to restart...");
                    #[cfg(target_os = "macos")]
                    {
                        let cur_ver = app.package_info().version.to_string();
                        let script = format!(
                            "display alert \"No Updates Available\" message \"Meowtrix v{} is already up to date. Do you want to restart Meowtrix anyway?\" buttons {{\"Cancel\", \"Restart\"}} default button \"Cancel\"",
                            cur_ver
                        );
                        if let Ok(out) = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(script)
                            .output()
                        {
                            let stdout = String::from_utf8_lossy(&out.stdout);
                            if stdout.contains("button returned:Restart") {
                                if let Some(state) = app.try_state::<ServerState>() {
                                    if let Ok(mut manager) = state.lock() {
                                        manager.stop();
                                    }
                                }
                                app.restart();
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Update check before install failed: {e}");
                    #[cfg(target_os = "macos")]
                    {
                        let err_msg = e.to_string();
                        let script = format!(
                            "display alert \"Update Check Failed\" message \"{}\" as warning buttons {{\"OK\"}} default button \"OK\"",
                            err_msg.replace('"', "\\\"")
                        );
                        let _ = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(script)
                            .spawn();
                    }
                }
            },
            Err(e) => {
                log::error!("Failed to initialize updater: {e}");
            }
        }
    });
}
