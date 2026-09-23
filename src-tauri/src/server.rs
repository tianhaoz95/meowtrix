use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PORT: u16 = 9123;

#[derive(Debug, Clone)]
pub enum AppMode {
    /// 100% self-contained standalone app with bundled Node runtime and server payload
    Standalone {
        node_bin: PathBuf,
        server_dir: PathBuf,
    },
    /// Lightweight client that connects to an existing local or host server
    Lite,
}

pub struct ServerManager {
    child: Option<Child>,
    pub port: u16,
    pub mode: Option<AppMode>,
}

impl ServerManager {
    pub fn new() -> Self {
        Self {
            child: None,
            port: DEFAULT_PORT,
            mode: None,
        }
    }

    /// Detects whether the app is running as a Standalone bundle or Lite client.
    pub fn detect_mode(&mut self, app: &AppHandle) -> &AppMode {
        if self.mode.is_none() {
            let detected = detect_standalone_payload(app).unwrap_or(AppMode::Lite);
            self.mode = Some(detected);
        }
        self.mode.as_ref().unwrap()
    }

    /// Checks if a Meowtrix server is responding on the configured port.
    pub fn is_ready(&self) -> bool {
        check_server_ready(self.port)
    }

    /// Ensures the Meowtrix server is running.
    /// - In Standalone mode: Always launches its own embedded server on an isolated dynamic port,
    ///   with instance-scoped data storage so multiple instances or existing servers never conflict.
    /// - In Lite mode: Connects to an existing server on port 9123, or launches a local server if
    ///   development files are present.
    pub fn ensure_started(&mut self, app: &AppHandle) -> Result<u16, String> {
        let is_standalone = matches!(self.detect_mode(app), AppMode::Standalone { .. });

        if is_standalone {
            // Standalone mode: Always allocate an ephemeral, conflict-free port
            let free_port = get_free_port();
            self.port = free_port;

            let (node_bin, server_dir) = match self.mode.as_ref().unwrap() {
                AppMode::Standalone { node_bin, server_dir } => {
                    (node_bin.clone(), server_dir.clone())
                }
                _ => unreachable!(),
            };

            // Ensure node binary has execute permission
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(metadata) = std::fs::metadata(&node_bin) {
                    let mut perms = metadata.permissions();
                    if perms.mode() & 0o111 == 0 {
                        perms.set_mode(perms.mode() | 0o755);
                        let _ = std::fs::set_permissions(&node_bin, perms);
                    }
                }
            }

            // Instance-isolated data directory to prevent storage collisions between multiple instances
            let instance_id = std::process::id();
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let data_dir = PathBuf::from(home)
                .join(".meowtrix")
                .join("standalone")
                .join(format!("instance-{instance_id}"));
            let _ = std::fs::create_dir_all(&data_dir);

            log::info!(
                "[Standalone] Spawning embedded server: Port={}, Node={:?}, ServerDir={:?}, DataDir={:?}",
                self.port,
                node_bin,
                server_dir,
                data_dir
            );

            let child = Command::new(&node_bin)
                .arg(server_dir.join("server.js"))
                .env("PORT", self.port.to_string())
                .env("HOST", "127.0.0.1")
                .env("MEOWTRIX_DATA_DIR", &data_dir)
                .current_dir(&server_dir)
                .spawn()
                .map_err(|e| format!("Failed to spawn embedded Node server: {e}"))?;

            self.child = Some(child);

            // Poll for server readiness
            for _ in 0..100 {
                std::thread::sleep(Duration::from_millis(100));
                if self.is_ready() {
                    log::info!(
                        "[Standalone] Embedded server ready on http://127.0.0.1:{}",
                        self.port
                    );
                    return Ok(self.port);
                }
            }

            return Err(format!(
                "Embedded server failed to become ready on http://127.0.0.1:{} within 10s",
                self.port
            ));
        }

        // Lite mode: Reuse existing server if running on 9123
        if check_server_ready(DEFAULT_PORT) {
            log::info!("[Lite] Connected to existing server on port {}", DEFAULT_PORT);
            self.port = DEFAULT_PORT;
            return Ok(self.port);
        }

        // If not running, check if host has node + server.js (e.g. dev environment)
        if let (Ok(node_bin), Ok(server_script)) = (find_node_binary(), find_server_script(app)) {
            let work_dir = server_script
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf();

            log::info!(
                "[Lite] Spawning host server using Node: {:?}, Script: {:?}",
                node_bin,
                server_script
            );

            let child = Command::new(&node_bin)
                .arg(&server_script)
                .env("PORT", DEFAULT_PORT.to_string())
                .env("HOST", "127.0.0.1")
                .current_dir(&work_dir)
                .spawn()
                .map_err(|e| format!("Failed to spawn Node server: {e}"))?;

            self.child = Some(child);
            self.port = DEFAULT_PORT;

            for _ in 0..100 {
                std::thread::sleep(Duration::from_millis(100));
                if self.is_ready() {
                    log::info!("[Lite] Host server ready on http://127.0.0.1:{}", self.port);
                    return Ok(self.port);
                }
            }
        }

        Err(format!(
            "No Meowtrix server found running on http://127.0.0.1:{DEFAULT_PORT}. Please start the server or launch Meowtrix Standalone."
        ))
    }

    /// Gracefully stops the child Node process if managed by this instance.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            log::info!("Stopping Meowtrix Node server process...");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for ServerManager {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type ServerState = Mutex<ServerManager>;

/// Allocates an ephemeral free port from the OS kernel.
fn get_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(9124)
}

/// Checks if bundled standalone payload (node binary + server.js) exists inside app resources.
fn detect_standalone_payload(app: &AppHandle) -> Option<AppMode> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidates = [
            res_dir.join("standalone-payload"),
            res_dir.join("resources/standalone-payload"),
            res_dir.join("_up_/standalone-payload"),
        ];

        for base in candidates {
            let node = base.join("bin/node");
            let server_js = base.join("server.js");
            if node.is_file() && server_js.is_file() {
                return Some(AppMode::Standalone {
                    node_bin: node,
                    server_dir: base,
                });
            }
        }
    }
    None
}

/// Quick TCP HTTP probe to check if the server is responding on `127.0.0.1:port`.
fn check_server_ready(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
        let req = format!(
            "GET /api/settings HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        );
        if stream.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 128];
            if let Ok(n) = stream.read(&mut buf) {
                if n > 0 && (buf.starts_with(b"HTTP/1.1 200") || buf.starts_with(b"HTTP/1.0 200")) {
                    return true;
                }
            }
        }
    }
    false
}

/// Locates a working Node.js executable on the system or bundled resources.
fn find_node_binary() -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("MEOWTRIX_NODE_BIN") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
    }

    if Command::new("node").arg("--version").output().is_ok() {
        return Ok(PathBuf::from("node"));
    }

    let common_locations = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for loc in common_locations {
        let p = PathBuf::from(loc);
        if p.is_file() {
            return Ok(p);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let nvm_dir = PathBuf::from(&home).join(".nvm/versions/node");
        if nvm_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(nvm_dir) {
                let mut versions: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path().join("bin/node"))
                    .filter(|p| p.is_file())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.pop() {
                    return Ok(latest);
                }
            }
        }
    }

    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("/bin/zsh")
            .args(["-l", "-c", "which node"])
            .output()
        {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path_str.is_empty() {
                    let path = PathBuf::from(path_str);
                    if path.is_file() {
                        return Ok(path);
                    }
                }
            }
        }
    }

    Err("Could not find a Node.js runtime. Please install Node.js (v18+) or run Meowtrix Standalone.".to_string())
}

/// Locates `server.js` in development directories.
fn find_server_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidate = res_dir.join("server.js");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let cwd_candidate = PathBuf::from("server.js");
    if cwd_candidate.is_file() {
        return Ok(cwd_candidate.canonicalize().unwrap_or(cwd_candidate));
    }

    let parent_candidate = PathBuf::from("../server.js");
    if parent_candidate.is_file() {
        return Ok(parent_candidate.canonicalize().unwrap_or(parent_candidate));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for ancestor in exe_dir.ancestors().take(5) {
                let candidate = ancestor.join("server.js");
                if candidate.is_file() {
                    return Ok(candidate.canonicalize().unwrap_or(candidate));
                }
            }
        }
    }

    Err("Could not locate server.js. Ensure Meowtrix is installed correctly.".to_string())
}
