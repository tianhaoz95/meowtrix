use anyhow::{Context, Result};
use mistralrs::{
    DeviceMapSetting, GgufModelBuilder, Model, ModelBuilder, Response, TextMessageRole,
    TextMessages,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStatus {
    pub engine: String,
    pub is_ready: bool,
    pub active_model: Option<String>,
    pub available_models: Vec<String>,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: Option<String>,
    pub messages: Option<Vec<ChatMessage>>,
    pub prompt: Option<String>,
    pub system: Option<String>,
    #[serde(default = "default_stream")]
    pub stream: bool,
}

fn default_stream() -> bool {
    true
}

pub struct AiEngine {
    pub active_model_name: Option<String>,
    pub loaded_model: Option<Arc<Model>>,
    pub port: u16,
}

impl AiEngine {
    pub fn new() -> Self {
        Self {
            active_model_name: None,
            loaded_model: None,
            port: 0,
        }
    }

    pub fn models_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".meowtrix").join("models")
    }

    pub fn list_models(&self) -> Vec<String> {
        let dir = Self::models_dir();
        let mut models = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext == "gguf" || ext == "bin" || ext == "safetensors" {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            models.push(name.to_string());
                        }
                    }
                }
            }
        }

        // Also check ~/.cache/huggingface/hub for cached GGUF models
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let hf_cache = PathBuf::from(home).join(".cache").join("huggingface").join("hub");
        if let Ok(repos) = std::fs::read_dir(&hf_cache) {
            for repo in repos.flatten() {
                let snapshots = repo.path().join("snapshots");
                if let Ok(snaps) = std::fs::read_dir(&snapshots) {
                    for snap in snaps.flatten() {
                        if let Ok(files) = std::fs::read_dir(snap.path()) {
                            for f in files.flatten() {
                                if let Some(ext) = f.path().extension() {
                                    if ext == "gguf" {
                                        if let Some(name) = f.path().file_name().and_then(|n| n.to_str()) {
                                            if !models.contains(&name.to_string()) {
                                                models.push(name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        models
    }

    pub fn status(&self) -> AiStatus {
        let models = self.list_models();
        AiStatus {
            engine: "mistral.rs".to_string(),
            is_ready: true,
            active_model: self.active_model_name.clone(),
            available_models: models,
            port: self.port,
        }
    }

    pub async fn get_or_load_model(&mut self, requested_model: Option<&str>) -> Result<Arc<Model>> {
        let target_name = requested_model
            .filter(|m| !m.is_empty() && *m != "auto" && *m != "default");

        // If already loaded and matches (or no specific model requested), reuse
        if let Some(ref model) = self.loaded_model {
            if let Some(ref loaded_name) = self.active_model_name {
                if target_name.is_none() || target_name == Some(loaded_name.as_str()) {
                    return Ok(Arc::clone(model));
                }
            }
        }

        let models_dir = Self::models_dir();
        let available = self.list_models();

        // Determine what model name / path to load
        let (resolved_name, model) = if let Some(name) = target_name {
            let direct_path = PathBuf::from(name);
            let in_models_dir = models_dir.join(name);

            if direct_path.is_file() {
                let parent = direct_path.parent().unwrap_or(&models_dir);
                let fname = direct_path.file_name().unwrap().to_str().unwrap();
                let m = GgufModelBuilder::new(parent.to_string_lossy(), vec![fname])
                    .with_device_mapping(DeviceMapSetting::dummy())
                    .with_logging()
                    .build()
                    .await
                    .context("Failed to build GGUF model from path")?;
                (name.to_string(), m)
            } else if in_models_dir.is_file() {
                let m = GgufModelBuilder::new(models_dir.to_string_lossy(), vec![name])
                    .with_device_mapping(DeviceMapSetting::dummy())
                    .with_logging()
                    .build()
                    .await
                    .context("Failed to build GGUF model from models_dir")?;
                (name.to_string(), m)
            } else if let Some(matched) = available.iter().find(|m| {
                m.eq_ignore_ascii_case(name)
                    || m.to_ascii_lowercase().starts_with(&name.to_ascii_lowercase())
                    || m.to_ascii_lowercase().contains(&name.to_ascii_lowercase())
            }) {
                let m = GgufModelBuilder::new(models_dir.to_string_lossy(), vec![matched.as_str()])
                    .with_device_mapping(DeviceMapSetting::dummy())
                    .with_logging()
                    .build()
                    .await
                    .context("Failed to build matched GGUF model")?;
                (matched.clone(), m)
            } else if name.ends_with(".gguf") {
                // Check HF cache for this filename
                if let Some(cached_path) = find_cached_gguf(name) {
                    let parent = cached_path.parent().unwrap();
                    let fname = cached_path.file_name().unwrap().to_str().unwrap();
                    let m = GgufModelBuilder::new(parent.to_string_lossy(), vec![fname])
                        .with_device_mapping(DeviceMapSetting::dummy())
                        .with_logging()
                        .build()
                        .await
                        .context("Failed to build cached GGUF model")?;
                    (name.to_string(), m)
                } else {
                    anyhow::bail!(
                        "Model '{}' not found in {}. Please download it via the Models panel first.",
                        name,
                        models_dir.display()
                    );
                }
            } else {
                // Treat as Hugging Face model repository
                let m = ModelBuilder::new(name)
                    .with_device_mapping(DeviceMapSetting::dummy())
                    .with_auto_isq(mistralrs::IsqBits::Four)
                    .with_logging()
                    .build()
                    .await
                    .context(format!("Failed to build HuggingFace model '{}'", name))?;
                (name.to_string(), m)
            }
        } else if let Some(first) = available.first() {
            // Pick first available local model
            let in_models_dir = models_dir.join(first);
            if in_models_dir.is_file() {
                let m = GgufModelBuilder::new(models_dir.to_string_lossy(), vec![first.as_str()])
                    .with_device_mapping(DeviceMapSetting::dummy())
                    .with_logging()
                    .build()
                    .await
                    .context("Failed to build default local GGUF model")?;
                (first.clone(), m)
            } else if let Some(cached_path) = find_cached_gguf(first) {
                let parent = cached_path.parent().unwrap();
                let fname = cached_path.file_name().unwrap().to_str().unwrap();
                let m = GgufModelBuilder::new(parent.to_string_lossy(), vec![fname])
                    .with_device_mapping(DeviceMapSetting::dummy())
                    .with_logging()
                    .build()
                    .await
                    .context("Failed to build default cached GGUF model")?;
                (first.clone(), m)
            } else {
                anyhow::bail!("No local model found. Please download a model in Meowtrix.");
            }
        } else {
            anyhow::bail!("No AI model available. Please download a model from the Models tab.");
        };

        let model_arc = Arc::new(model);
        self.active_model_name = Some(resolved_name);
        self.loaded_model = Some(Arc::clone(&model_arc));
        Ok(model_arc)
    }
}

fn find_cached_gguf(filename: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let hf_cache = PathBuf::from(home).join(".cache").join("huggingface").join("hub");
    if let Ok(repos) = std::fs::read_dir(&hf_cache) {
        for repo in repos.flatten() {
            let snapshots = repo.path().join("snapshots");
            if let Ok(snaps) = std::fs::read_dir(&snapshots) {
                for snap in snaps.flatten() {
                    let candidate = snap.path().join(filename);
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

pub type SharedAiEngine = Arc<Mutex<AiEngine>>;

pub async fn handle_http_connection(
    mut stream: tokio::net::TcpStream,
    engine: SharedAiEngine,
    app_handle: Option<tauri::AppHandle>,
) -> Result<()> {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await?;
    if n == 0 {
        return Ok(());
    }

    let req_str = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req_str.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path = parts.next().unwrap_or("/");

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n";
        stream.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    if path == "/health" || path == "/status" || path == "/api/ai/status" {
        let status = {
            let eng = engine.lock().await;
            eng.status()
        };
        let body = serde_json::to_vec(&status)?;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(header.as_bytes()).await?;
        stream.write_all(&body).await?;
        stream.flush().await?;
        return Ok(());
    }

    if path == "/update/check" || path == "/api/desktop/update/check" {
        if let Some(ref handle) = app_handle {
            let current_ver = handle.package_info().version.to_string();
            match handle.updater() {
                Ok(updater) => match updater.check().await {
                    Ok(Some(update)) => {
                        let body = serde_json::to_vec(&serde_json::json!({
                            "updateAvailable": true,
                            "local": current_ver,
                            "remote": update.version,
                            "isBinary": true,
                            "notes": update.body.clone().unwrap_or_default()
                        }))?;
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        stream.write_all(header.as_bytes()).await?;
                        stream.write_all(&body).await?;
                        stream.flush().await?;
                        return Ok(());
                    }
                    Ok(None) => {
                        let body = serde_json::to_vec(&serde_json::json!({
                            "updateAvailable": false,
                            "local": current_ver,
                            "isBinary": true
                        }))?;
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        stream.write_all(header.as_bytes()).await?;
                        stream.write_all(&body).await?;
                        stream.flush().await?;
                        return Ok(());
                    }
                    Err(e) => {
                        let body = serde_json::to_vec(&serde_json::json!({
                            "error": format!("Desktop update check error: {e}"),
                            "local": current_ver,
                            "updateAvailable": false
                        }))?;
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        stream.write_all(header.as_bytes()).await?;
                        stream.write_all(&body).await?;
                        stream.flush().await?;
                        return Ok(());
                    }
                },
                Err(e) => {
                    log::warn!("Updater initialization error: {e}");
                }
            }
        }
    }

    if (path == "/update/apply" || path == "/api/desktop/update/apply") && method == "POST" {
        if let Some(ref handle) = app_handle {
            if let Ok(updater) = handle.updater() {
                if let Ok(Some(update)) = updater.check().await {
                    let handle_clone = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        log::info!("Downloading and applying desktop update...");
                        if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                            log::error!("Failed to install update: {e}");
                        } else {
                            log::info!("Update installed. Restarting application...");
                            handle_clone.restart();
                        }
                    });
                    let body = serde_json::to_vec(&serde_json::json!({
                        "ok": true,
                        "restarting": true,
                        "output": "Desktop update downloaded and applied. Relaunching..."
                    }))?;
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    stream.write_all(header.as_bytes()).await?;
                    stream.write_all(&body).await?;
                    stream.flush().await?;
                    return Ok(());
                }
            }
        }
    }

    if path == "/restart" || path == "/api/desktop/restart" {
        if method == "GET" {
            let body = serde_json::to_vec(&serde_json::json!({
                "supervised": true,
                "isDesktop": true,
                "restarting": false
            }))?;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(header.as_bytes()).await?;
            stream.write_all(&body).await?;
            stream.flush().await?;
            return Ok(());
        } else if method == "POST" {
            if let Some(ref handle) = app_handle {
                let handle_clone = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    handle_clone.restart();
                });
                let body = serde_json::to_vec(&serde_json::json!({
                    "ok": true,
                    "restarting": true
                }))?;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(header.as_bytes()).await?;
                stream.write_all(&body).await?;
                stream.flush().await?;
                return Ok(());
            }
        }
    }

    if path == "/api/overlay/hide" || path == "/overlay/hide" {
        if let Some(ref handle) = app_handle {
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.hide();
            }
        }
        let body = serde_json::to_vec(&serde_json::json!({
            "ok": true,
            "hidden": true
        }))?;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(header.as_bytes()).await?;
        stream.write_all(&body).await?;
        stream.flush().await?;
        return Ok(());
    }

    if path == "/api/overlay/show" || path == "/overlay/show" {
        if let Some(ref handle) = app_handle {
            if let Some(w) = handle.get_webview_window("main") {
                crate::summon_overlay_window(&w);
            }
        }
        let body = serde_json::to_vec(&serde_json::json!({
            "ok": true,
            "shown": true
        }))?;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(header.as_bytes()).await?;
        stream.write_all(&body).await?;
        stream.flush().await?;
        return Ok(());
    }

    if path == "/api/overlay/status" || path == "/overlay/status" {
        let conf = crate::read_quick_overlay_config();
        let body = serde_json::to_vec(&serde_json::json!({
            "isDesktop": true,
            "platform": "macos",
            "enabled": conf.enabled,
            "shortcut": conf.shortcut,
            "autoClaim": conf.auto_claim,
            "dismissOnBlur": conf.dismiss_on_blur,
        }))?;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(header.as_bytes()).await?;
        stream.write_all(&body).await?;
        stream.flush().await?;
        return Ok(());
    }

    if method == "POST" && (path == "/chat" || path == "/api/ai/chat") {
        // Find body after double newline
        let body_str = if let Some(idx) = req_str.find("\r\n\r\n") {
            &req_str[idx + 4..]
        } else if let Some(idx) = req_str.find("\n\n") {
            &req_str[idx + 2..]
        } else {
            ""
        };

        let chat_req: ChatRequest = match serde_json::from_str(body_str) {
            Ok(r) => r,
            Err(e) => {
                let err_body = serde_json::json!({ "error": format!("Invalid JSON request: {e}") }).to_string();
                let header = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    err_body.len()
                );
                stream.write_all(header.as_bytes()).await?;
                stream.write_all(err_body.as_bytes()).await?;
                stream.flush().await?;
                return Ok(());
            }
        };

        // Load or acquire model
        let model = {
            let mut eng = engine.lock().await;
            match eng.get_or_load_model(chat_req.model.as_deref()).await {
                Ok(m) => m,
                Err(e) => {
                    let err_body = serde_json::json!({ "error": format!("Model load error: {e:#}") }).to_string();
                    let header = format!(
                        "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        err_body.len()
                    );
                    stream.write_all(header.as_bytes()).await?;
                    stream.write_all(err_body.as_bytes()).await?;
                    stream.flush().await?;
                    return Ok(());
                }
            }
        };

        // Build messages
        let mut text_messages = TextMessages::new();
        if let Some(ref sys) = chat_req.system {
            text_messages = text_messages.add_message(TextMessageRole::System, sys);
        }
        if let Some(ref msgs) = chat_req.messages {
            for m in msgs {
                let role = match m.role.to_lowercase().as_str() {
                    "system" => TextMessageRole::System,
                    "assistant" => TextMessageRole::Assistant,
                    _ => TextMessageRole::User,
                };
                text_messages = text_messages.add_message(role, &m.content);
            }
        } else if let Some(ref p) = chat_req.prompt {
            text_messages = text_messages.add_message(TextMessageRole::User, p);
        }

        if chat_req.stream {
            let header = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
            stream.write_all(header.as_bytes()).await?;
            stream.flush().await?;

            match model.stream_chat_request(text_messages).await {
                Ok(mut stream_resp) => {
                    while let Some(chunk) = stream_resp.next().await {
                        if let Response::Chunk(c) = chunk {
                            if let Some(delta) = c.choices.first().and_then(|ch| {
                                ch.delta.content.as_deref().or(ch.delta.reasoning_content.as_deref())
                            }) {
                                let payload = serde_json::json!({
                                    "delta": delta,
                                    "done": false
                                });
                                let line = format!("data: {}\n\n", payload);
                                if stream.write_all(line.as_bytes()).await.is_err() {
                                    break;
                                }
                                let _ = stream.flush().await;
                            }
                        }
                    }
                    let done_payload = serde_json::json!({
                        "delta": "",
                        "done": true
                    });
                    let line = format!("data: {}\n\n", done_payload);
                    let _ = stream.write_all(line.as_bytes()).await;
                    let _ = stream.flush().await;
                }
                Err(e) => {
                    let err_payload = serde_json::json!({
                        "error": format!("Inference stream error: {e:#}"),
                        "done": true
                    });
                    let line = format!("data: {}\n\n", err_payload);
                    let _ = stream.write_all(line.as_bytes()).await;
                    let _ = stream.flush().await;
                }
            }
        } else {
            match model.send_chat_request(text_messages).await {
                Ok(resp) => {
                    let text = resp.choices.into_iter().next().and_then(|c| c.message.content).unwrap_or_default();
                    let body = serde_json::to_vec(&serde_json::json!({
                        "response": text,
                        "done": true
                    }))?;
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    stream.write_all(header.as_bytes()).await?;
                    stream.write_all(&body).await?;
                    stream.flush().await?;
                }
                Err(e) => {
                    let body = serde_json::to_vec(&serde_json::json!({
                        "error": format!("Inference error: {e:#}")
                    }))?;
                    let header = format!(
                        "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    stream.write_all(header.as_bytes()).await?;
                    stream.write_all(&body).await?;
                    stream.flush().await?;
                }
            }
        }
        return Ok(());
    }

    let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    stream.write_all(not_found.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}

pub fn start_ai_server(
    engine: SharedAiEngine,
    preferred_port: u16,
    app_handle: Option<tauri::AppHandle>,
) -> Result<u16> {
    let std_listener = std::net::TcpListener::bind(format!("127.0.0.1:{preferred_port}"))
        .or_else(|_| std::net::TcpListener::bind("127.0.0.1:0"))
        .context("Failed to bind AI TCP listener")?;

    let port = std_listener.local_addr()?.port();
    std_listener.set_nonblocking(true)?;

    // Persist active port for discovery by external tools or standalone scripts
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let meow_dir = PathBuf::from(home).join(".meowtrix");
    let _ = std::fs::create_dir_all(&meow_dir);
    let _ = std::fs::write(meow_dir.join("ai_port"), port.to_string());

    // Update engine port
    {
        let engine_clone = Arc::clone(&engine);
        tauri::async_runtime::spawn(async move {
            let mut eng = engine_clone.lock().await;
            eng.port = port;
        });
    }

    let app_handle_clone = app_handle;
    tauri::async_runtime::spawn(async move {
        let tokio_listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                log::error!("Failed to register AI TCP listener with Tokio runtime: {e}");
                return;
            }
        };

        loop {
            match tokio_listener.accept().await {
                Ok((stream, _addr)) => {
                    let eng = Arc::clone(&engine);
                    let handle = app_handle_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = handle_http_connection(stream, eng, handle).await {
                            log::warn!("AI HTTP connection error: {e}");
                        }
                    });
                }
                Err(e) => {
                    log::error!("AI listener accept error: {e}");
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                }
            }
        }
    });

    log::info!("Mistral.rs native inference daemon running on http://127.0.0.1:{port}");
    Ok(port)
}

pub async fn run_cli_infer(args: &[String]) -> Result<()> {
    let mut model_name: Option<String> = None;
    let mut prompt: Option<String> = None;
    let mut system: Option<String> = None;
    let mut stream = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--model" | "-m" => {
                if i + 1 < args.len() {
                    model_name = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--prompt" | "-p" => {
                if i + 1 < args.len() {
                    prompt = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--system" | "-s" => {
                if i + 1 < args.len() {
                    system = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--stream" => {
                stream = true;
            }
            _ => {
                if prompt.is_none() && !args[i].starts_with('-') && args[i] != "infer" {
                    prompt = Some(args[i].clone());
                }
            }
        }
        i += 1;
    }

    let prompt = prompt.unwrap_or_else(|| "Hello from Meowtrix AI".to_string());
    let mut engine = AiEngine::new();
    let model = engine.get_or_load_model(model_name.as_deref()).await?;

    let mut text_messages = TextMessages::new();
    if let Some(s) = system {
        text_messages = text_messages.add_message(TextMessageRole::System, s);
    }
    text_messages = text_messages.add_message(TextMessageRole::User, prompt);

    if stream {
        let mut stream_resp = model.stream_chat_request(text_messages).await?;
        while let Some(chunk) = stream_resp.next().await {
            if let Response::Chunk(c) = chunk {
                if let Some(text) = c.choices.first().and_then(|ch| {
                    ch.delta.content.as_deref().or(ch.delta.reasoning_content.as_deref())
                }) {
                    print!("{text}");
                    let _ = std::io::Write::flush(&mut std::io::stdout());
                }
            }
        }
        println!();
    } else {
        let resp = model.send_chat_request(text_messages).await?;
        if let Some(text) = resp.choices.into_iter().next().and_then(|c| c.message.content) {
            println!("{text}");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[test]
    fn test_start_ai_server_outside_tokio_context_does_not_panic() {
        // Run in a thread guaranteed to have NO Tokio runtime context on the thread stack.
        // This directly guards against the crash caused by registering TcpListener outside of async runtime.
        let handle = std::thread::spawn(|| {
            let engine = Arc::new(Mutex::new(AiEngine::new()));
            let port = start_ai_server(engine, 0, None)
                .expect("start_ai_server must succeed without panic outside Tokio runtime");
            assert!(port > 0, "Server must bind to a valid ephemeral port");

            // Verify that the listener accepts connections and responds to /health
            let mut stream = None;
            for _ in 0..60 {
                if let Ok(s) = TcpStream::connect(format!("127.0.0.1:{port}")) {
                    stream = Some(s);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            let mut stream = stream.expect("Failed to connect to AI server");
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            stream
                .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .unwrap();

            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(
                response.contains("200 OK"),
                "Expected 200 OK from /health, got: {response}"
            );
            assert!(
                response.contains("\"engine\":\"mistral.rs\""),
                "Expected engine:mistral.rs in /health payload, got: {response}"
            );
            assert!(
                response.contains("\"is_ready\":true"),
                "Expected is_ready:true in /health payload, got: {response}"
            );
        });

        handle.join().expect("Thread panicked during test");
    }

    #[test]
    fn test_ai_status_endpoint() {
        let handle = std::thread::spawn(|| {
            let engine = Arc::new(Mutex::new(AiEngine::new()));
            let port = start_ai_server(engine, 0, None)
                .expect("start_ai_server must succeed");

            let mut stream = None;
            for _ in 0..60 {
                if let Ok(s) = TcpStream::connect(format!("127.0.0.1:{port}")) {
                    stream = Some(s);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            let mut stream = stream.expect("Failed to connect to AI server");
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            stream
                .write_all(b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .unwrap();

            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.contains("200 OK"));
            assert!(response.contains("\"engine\":\"mistral.rs\""));
            assert!(response.contains("\"is_ready\":true"));
        });

        handle.join().expect("Thread panicked during test");
    }
}

