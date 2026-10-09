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
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone)]
pub struct QuickOverlayConfig {
    pub enabled: bool,
    pub shortcut: String,
    pub auto_claim: bool,
    pub dismiss_on_blur: bool,
    pub opacity: f64,
}

impl Default for QuickOverlayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: "Option+Space".to_string(),
            auto_claim: true,
            dismiss_on_blur: true,
            opacity: 1.0,
        }
    }
}

pub struct OverlayState {
    pub current_shortcut: Option<Shortcut>,
    pub enabled: bool,
    pub dismiss_on_blur: bool,
    pub auto_claim: bool,
    pub is_overlay_active: bool,
    pub normal_size: Option<(f64, f64)>,
    pub normal_position: Option<(f64, f64)>,
}

pub type SharedOverlayState = Arc<Mutex<OverlayState>>;

pub fn read_quick_overlay_config() -> QuickOverlayConfig {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let data_dir = std::env::var("MEOWTRIX_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from(home).join(".meowtrix"));
    let settings_path = data_dir.join("settings.json");
    if let Ok(content) = std::fs::read_to_string(settings_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            let opacity = v.get("quickOverlayOpacity")
                .and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse::<f64>().ok())))
                .unwrap_or(1.0)
                .clamp(0.1, 1.0);
            return QuickOverlayConfig {
                enabled: v.get("quickOverlayEnabled").and_then(|x| x.as_bool()).unwrap_or(true),
                shortcut: v.get("quickOverlayShortcut").and_then(|x| x.as_str()).unwrap_or("Option+Space").to_string(),
                auto_claim: v.get("quickOverlayAutoClaim").and_then(|x| x.as_bool()).unwrap_or(true),
                dismiss_on_blur: v.get("quickOverlayDismissOnBlur").and_then(|x| x.as_bool()).unwrap_or(true),
                opacity,
            };
        }
    }
    QuickOverlayConfig::default()
}

#[cfg(target_os = "macos")]
pub fn configure_macos_normal_window(window: &tauri::WebviewWindow) {
    if let Ok(ptr) = window.ns_window() {
        use objc2_app_kit::{
            NSApplication, NSNormalWindowLevel, NSWindow, NSWindowCollectionBehavior,
        };
        use objc2::MainThreadMarker;
        unsafe {
            let ns_window = &*(ptr as *mut NSWindow);
            ns_window.setLevel(NSNormalWindowLevel);
            let behavior = NSWindowCollectionBehavior::FullScreenPrimary
                | NSWindowCollectionBehavior::Managed;
            ns_window.setCollectionBehavior(behavior);
            ns_window.setHidesOnDeactivate(false);
            ns_window.setHasShadow(true);
            ns_window.setAlphaValue(1.0);
            if let Some(mtm) = MainThreadMarker::new() {
                let app_inst = NSApplication::sharedApplication(mtm);
                #[allow(deprecated)]
                app_inst.activateIgnoringOtherApps(true);
            }
            ns_window.makeKeyAndOrderFront(None);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn configure_macos_overlay_window(window: &tauri::WebviewWindow) {
    if let Ok(ptr) = window.ns_window() {
        use objc2_app_kit::{
            NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior,
        };
        unsafe {
            let ns_window = &*(ptr as *mut NSWindow);
            let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary;
            ns_window.setCollectionBehavior(behavior);
            ns_window.setLevel(NSStatusWindowLevel);
            ns_window.setHidesOnDeactivate(false);
            ns_window.setHasShadow(true);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn bring_macos_overlay_to_front(window: &tauri::WebviewWindow) {
    if let Ok(ptr) = window.ns_window() {
        use objc2_app_kit::{
            NSApplication, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior,
        };
        use objc2::MainThreadMarker;
        unsafe {
            let ns_window = &*(ptr as *mut NSWindow);
            let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary;
            ns_window.setCollectionBehavior(behavior);
            ns_window.setLevel(NSStatusWindowLevel);
            ns_window.setHidesOnDeactivate(false);
            ns_window.setHasShadow(true);
            ns_window.orderFrontRegardless();
            if let Some(mtm) = MainThreadMarker::new() {
                let app = NSApplication::sharedApplication(mtm);
                #[allow(deprecated)]
                app.activateIgnoringOtherApps(true);
            }
            ns_window.makeKeyAndOrderFront(None);
        }
    }
}

#[cfg(target_os = "macos")]
fn get_active_monitor_on_macos(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    if let Some(mtm) = MainThreadMarker::new() {
        if let Some(screen) = NSScreen::mainScreen(mtm) {
            let frame = screen.frame();
            let width = frame.size.width;
            let height = frame.size.height;
            if let Ok(monitors) = window.available_monitors() {
                for m in monitors {
                    let s = m.scale_factor();
                    let m_w = m.size().width as f64 / s;
                    let m_h = m.size().height as f64 / s;
                    if (m_w - width).abs() < 2.0 && (m_h - height).abs() < 2.0 {
                        return Some(m);
                    }
                }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub fn apply_macos_overlay_opacity(window: &tauri::WebviewWindow, opacity: f64) {
    if let Ok(ptr) = window.ns_window() {
        use objc2_app_kit::NSWindow;
        unsafe {
            let ns_window = &*(ptr as *mut NSWindow);
            ns_window.setAlphaValue(opacity);
        }
    }
}

pub fn open_normal_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let saved_bounds = {
        let state = app.state::<SharedOverlayState>();
        let mut st = state.lock().unwrap();
        st.is_overlay_active = false;
        (st.normal_size.take(), st.normal_position.take())
    };

    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);

    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        configure_macos_normal_window(window);
    }

    if let (Some((w, h)), Some((x, y))) = saved_bounds {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    } else {
        if let Ok(pos) = window.outer_position() {
            if let Ok(scale) = window.scale_factor() {
                let y = pos.y as f64 / scale;
                if y <= 5.0 {
                    let monitor = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten());
                    if let Some(m) = monitor {
                        let s = m.scale_factor();
                        let m_sz = m.size();
                        let m_p = m.position();
                        let scr_w = m_sz.width as f64 / s;
                        let scr_h = m_sz.height as f64 / s;
                        let nw = 1440.0f64.min(scr_w * 0.90).max(960.0f64);
                        let nh = 900.0f64.min(scr_h * 0.85).max(600.0f64);
                        let nx = (m_p.x as f64 / s) + (scr_w - nw) / 2.0;
                        let ny = (m_p.y as f64 / s) + (scr_h - nh) / 2.0;
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: nw, height: nh }));
                        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: nx, y: ny }));
                    }
                }
            }
        }
    }

    let _ = window.show();
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.set_focus();

    #[cfg(target_os = "macos")]
    configure_macos_normal_window(window);

    let _ = window.eval("if (typeof exitOverlayMode === 'function') { exitOverlayMode(); }");
}

pub fn summon_overlay_window(window: &tauri::WebviewWindow) {
    let cfg = read_quick_overlay_config();

    let _ = {
        let state = window.app_handle().state::<SharedOverlayState>();
        let mut st = state.lock().unwrap();
        let was = st.is_overlay_active;
        st.is_overlay_active = true;
        if !was {
            if let (Ok(size), Ok(pos)) = (window.inner_size(), window.outer_position()) {
                if let Ok(scale) = window.scale_factor() {
                    st.normal_size = Some((size.width as f64 / scale, size.height as f64 / scale));
                    st.normal_position = Some((pos.x as f64 / scale, pos.y as f64 / scale));
                }
            }
        }
        was
    };

    #[cfg(target_os = "macos")]
    apply_macos_overlay_opacity(window, cfg.opacity);

    #[cfg(target_os = "macos")]
    bring_macos_overlay_to_front(window);

    let monitor = {
        #[cfg(target_os = "macos")]
        {
            get_active_monitor_on_macos(window)
                .or_else(|| window.current_monitor().ok().flatten())
                .or_else(|| window.primary_monitor().ok().flatten())
        }
        #[cfg(not(target_os = "macos"))]
        {
            window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten())
        }
    };

    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let m_size = m.size();
        let m_pos = m.position();

        let screen_w = m_size.width as f64 / scale;
        let screen_h = m_size.height as f64 / scale;

        let target_w = 1120.0f64.min(screen_w * 0.90).max(840.0f64);
        let target_h = 700.0f64.min(screen_h * 0.78).max(500.0f64);
        let target_x = (m_pos.x as f64 / scale) + ((screen_w - target_w) / 2.0);
        let target_y = m_pos.y as f64 / scale;

        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: target_w, height: target_h }));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: target_x, y: target_y }));
    }

    let _ = window.show();
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    #[cfg(target_os = "macos")]
    bring_macos_overlay_to_front(window);

    let _ = window.eval("if (typeof summonQuickOverlay === 'function') { summonQuickOverlay(); }");
}

pub fn toggle_quick_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);
        let is_overlay = {
            let state = app.state::<SharedOverlayState>();
            let act = state.lock().unwrap().is_overlay_active;
            act
        };

        if is_visible && is_focused && is_overlay {
            let _ = window.eval("if (typeof dismissQuickOverlay === 'function') { dismissQuickOverlay(); } else { window.__meowtrixHide(); }");
        } else {
            summon_overlay_window(&window);
        }
    }
}

#[tauri::command]
fn hide_overlay(window: tauri::WebviewWindow) {
    {
        let state = window.app_handle().state::<SharedOverlayState>();
        state.lock().unwrap().is_overlay_active = false;
    }
    let _ = window.set_always_on_top(false);
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    configure_macos_normal_window(&window);
}

#[tauri::command]
fn show_overlay(window: tauri::WebviewWindow) {
    summon_overlay_window(&window);
}

#[tauri::command]
fn show_normal_window(window: tauri::WebviewWindow) {
    open_normal_window(window.app_handle(), &window);
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn maximize_window(window: tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            use objc2_app_kit::NSWindow;
            unsafe {
                let ns_window = &*(ptr as *mut NSWindow);
                ns_window.zoom(None);
                return;
            }
        }
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn set_overlay_opacity(window: tauri::WebviewWindow, opacity: f64) {
    #[cfg(target_os = "macos")]
    apply_macos_overlay_opacity(&window, opacity.clamp(0.1, 1.0));
}

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

    let overlay_state: SharedOverlayState = Arc::new(Mutex::new(OverlayState {
        current_shortcut: None,
        enabled: true,
        dismiss_on_blur: true,
        auto_claim: true,
        is_overlay_active: false,
        normal_size: None,
        normal_position: None,
    }));

    let ai_engine_clone = Arc::clone(&ai_engine);
    let overlay_state_clone = Arc::clone(&overlay_state);

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            hide_overlay,
            show_overlay,
            show_normal_window,
            set_overlay_opacity,
            start_window_drag,
            close_window,
            minimize_window,
            maximize_window
        ])
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick_overlay(app);
                    }
                })
                .build(),
        )
        .manage(Mutex::new(server_manager) as ServerState)
        .manage(ai_engine)
        .manage(overlay_state)
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Register initial shortcut from user settings
            let conf = read_quick_overlay_config();
            {
                let mut st = overlay_state_clone.lock().unwrap();
                st.enabled = conf.enabled;
                st.dismiss_on_blur = conf.dismiss_on_blur;
                st.auto_claim = conf.auto_claim;
            }

            if conf.enabled {
                if let Some(sc) = parse_shortcut_string(&conf.shortcut) {
                    if let Err(e) = app.global_shortcut().register(sc.clone()) {
                        log::warn!("Failed to register initial global shortcut {:?}: {e}", conf.shortcut);
                    } else {
                        log::info!("Registered global overlay shortcut: {:?}", conf.shortcut);
                        overlay_state_clone.lock().unwrap().current_shortcut = Some(sc);
                    }
                }
            }

            // Background watcher for ~/.meowtrix/settings.json updates
            let app_handle_for_watcher = app.handle().clone();
            let overlay_state_for_watcher = Arc::clone(&overlay_state_clone);
            std::thread::spawn(move || {
                let mut last_shortcut = String::new();
                let mut last_enabled = true;
                let mut last_blur = true;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let current_conf = read_quick_overlay_config();
                    if current_conf.shortcut != last_shortcut || current_conf.enabled != last_enabled || current_conf.dismiss_on_blur != last_blur {
                        last_shortcut = current_conf.shortcut.clone();
                        last_enabled = current_conf.enabled;
                        last_blur = current_conf.dismiss_on_blur;

                        let mut st = overlay_state_for_watcher.lock().unwrap();
                        st.enabled = current_conf.enabled;
                        st.dismiss_on_blur = current_conf.dismiss_on_blur;
                        st.auto_claim = current_conf.auto_claim;

                        if let Some(old_sc) = st.current_shortcut.take() {
                            let _ = app_handle_for_watcher.global_shortcut().unregister(old_sc);
                        }

                        if current_conf.enabled {
                            if let Some(new_sc) = parse_shortcut_string(&current_conf.shortcut) {
                                if let Ok(()) = app_handle_for_watcher.global_shortcut().register(new_sc.clone()) {
                                    log::info!("Updated global overlay shortcut to: {}", current_conf.shortcut);
                                    st.current_shortcut = Some(new_sc);
                                } else {
                                    log::warn!("Failed to register updated shortcut: {}", current_conf.shortcut);
                                }
                            }
                        }
                    }
                }
            });

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
                #[cfg(target_os = "macos")]
                configure_macos_normal_window(&window);

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
                    open_normal_window(app.handle(), &window);

                    // Window events: hide on close, dismiss on blur if in overlay mode
                    let window_clone = window.clone();
                    let window_for_blur = window.clone();
                    let overlay_state_for_blur = Arc::clone(&overlay_state_clone);

                    window.on_window_event(move |event| {
                        match event {
                            tauri::WindowEvent::CloseRequested { api, .. } => {
                                api.prevent_close();
                                let _ = window_clone.hide();
                                log::info!("Window closed: hidden to background tray.");
                            }
                            tauri::WindowEvent::Focused(false) => {
                                let dismiss = {
                                    let st = overlay_state_for_blur.lock().unwrap();
                                    st.is_overlay_active && st.enabled && st.dismiss_on_blur
                                };
                                if dismiss && window_for_blur.is_visible().unwrap_or(false) {
                                    let _ = window_for_blur.eval("if (typeof dismissQuickOverlay === 'function') { dismissQuickOverlay(); }");
                                }
                            }
                            _ => {}
                        }
                    });
                }
            }

            // Setup system tray / status bar icon
            let version_str = app.package_info().version.to_string();
            let version_item = MenuItemBuilder::with_id("version_info", format!("🐾 Meowtrix v{version_str}")).enabled(false).build(app)?;
            let open_item = MenuItemBuilder::with_id("open", "🪟 Open Meowtrix Window").build(app)?;
            let url_item = MenuItemBuilder::with_id("url_info", format!("🌐 Web: http://127.0.0.1:{port}")).enabled(false).build(app)?;
            let copy_item = MenuItemBuilder::with_id("copy_url", "📋 Copy Web URL").build(app)?;
            let check_update_item = MenuItemBuilder::with_id("check_update", "🔄 Check for Updates...").build(app)?;
            let update_restart_item = MenuItemBuilder::with_id("update_restart", "🚀 Update & Restart").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "⏹️ Quit Meowtrix").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&version_item)
                .separator()
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
                .tooltip(format!("Meowtrix v{version_str} (Port {port})"))
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(w) = app.get_webview_window("main") {
                                open_normal_window(app, &w);
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
                            let is_visible = w.is_visible().unwrap_or(false);
                            let is_focused = w.is_focused().unwrap_or(false);
                            let is_overlay = {
                                let state = app.state::<SharedOverlayState>();
                                let act = state.lock().unwrap().is_overlay_active;
                                act
                            };
                            if is_visible && is_focused && !is_overlay {
                                let _ = w.hide();
                            } else {
                                open_normal_window(app, &w);
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
        match event {
            RunEvent::Exit => {
                log::info!("Tauri app exiting, stopping background server...");
                if let Some(state) = app_handle.try_state::<ServerState>() {
                    if let Ok(mut manager) = state.lock() {
                        manager.stop();
                    }
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(w) = app_handle.get_webview_window("main") {
                    open_normal_window(app_handle, &w);
                }
            }
            _ => {}
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
                        let app_for_install = app.clone();
                        let version_str = update.version.clone();
                        let script = format!(
                            "button returned of (display alert \"Update Available\" message \"Meowtrix v{} is available.\\n\\nWould you like to update and restart now?\" as informational buttons {{\"Later\", \"Update & Restart\"}} default button \"Update & Restart\" cancel button \"Later\")",
                            version_str.replace('"', "\\\"")
                        );
                        std::thread::spawn(move || {
                            if let Ok(output) = std::process::Command::new("osascript")
                                .arg("-e")
                                .arg(script)
                                .output()
                            {
                                let result = String::from_utf8_lossy(&output.stdout);
                                if result.trim() == "Update & Restart" {
                                    update_and_restart(app_for_install);
                                }
                            }
                        });
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

pub fn parse_shortcut_string(s: &str) -> Option<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::Shortcut;
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(sc) = trimmed.parse::<Shortcut>() {
        return Some(sc);
    }

    let parts: Vec<&str> = trimmed.split('+').map(|p| p.trim()).collect();
    let mut normalized_parts: Vec<String> = Vec::new();

    for p in parts {
        let lower = p.to_lowercase();
        match lower.as_str() {
            "cmd" | "command" | "super" | "win" | "meta" => normalized_parts.push("CommandOrControl".to_string()),
            "ctrl" | "control" => normalized_parts.push("Control".to_string()),
            "alt" | "opt" | "option" => normalized_parts.push("Alt".to_string()),
            "shift" => normalized_parts.push("Shift".to_string()),
            _ => {
                if p.len() == 1 {
                    normalized_parts.push(p.to_uppercase());
                } else if lower == "space" {
                    normalized_parts.push("Space".to_string());
                } else if lower == "esc" || lower == "escape" {
                    normalized_parts.push("Escape".to_string());
                } else if lower == "enter" || lower == "return" {
                    normalized_parts.push("Enter".to_string());
                } else {
                    normalized_parts.push(p.to_string());
                }
            }
        }
    }

    let joined = normalized_parts.join("+");
    joined.parse::<Shortcut>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_shortcut() {
        assert!(parse_shortcut_string("Option+Space").is_some());
        assert!(parse_shortcut_string("Alt+Space").is_some());
        assert!(parse_shortcut_string("cmd+shift+m").is_some());
        assert!(parse_shortcut_string("Command+Shift+Space").is_some());
        assert!(parse_shortcut_string("ctrl+option+space").is_some());
        assert!(parse_shortcut_string("").is_none());
    }
}


