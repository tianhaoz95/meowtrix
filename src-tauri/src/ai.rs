use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStatus {
    pub engine: String,
    pub is_ready: bool,
    pub active_model: Option<String>,
    pub available_models: Vec<String>,
}

pub struct AiEngine {
    pub active_model: Option<String>,
}

impl AiEngine {
    pub fn new() -> Self {
        Self { active_model: None }
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
        models
    }

    pub fn status(&self) -> AiStatus {
        let models = self.list_models();
        AiStatus {
            engine: "mistral.rs".to_string(),
            is_ready: true,
            active_model: self.active_model.clone(),
            available_models: models,
        }
    }
}

pub type SharedAiEngine = Arc<Mutex<AiEngine>>;
