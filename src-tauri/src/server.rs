use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PORT: u16 = 9123;

pub struct ServerManager {
    child: Option<Child>,
    pub port: u16,
}

impl ServerManager {
    pub fn new(port: u16) -> Self {
        Self { child: None, port }
    }

    /// Checks if a Meowtrix server is already responding on the configured port.
    pub fn is_ready(&self) -> bool {
        check_server_ready(self.port)
    }

    /// Ensures the Meowtrix Node server is running.
    /// If an instance is already alive on the port, reuses it.
    /// Otherwise, locates Node.js and server.js, spawns the server, and waits for readiness.
    pub fn ensure_started(&mut self, app: &AppHandle) -> Result<u16, String> {
        if self.is_ready() {
            log::info!("Meowtrix server already running on port {}", self.port);
            return Ok(self.port);
        }

        let node_bin = find_node_binary()?;
        let server_script = find_server_script(app)?;

        let work_dir = server_script
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();

        log::info!(
            "Spawning Meowtrix server using Node: {:?}, Script: {:?}, WorkDir: {:?}",
            node_bin,
            server_script,
            work_dir
        );

        let child = Command::new(&node_bin)
            .arg(&server_script)
            .env("PORT", self.port.to_string())
            .env("HOST", "127.0.0.1")
            .current_dir(&work_dir)
            .spawn()
            .map_err(|e| format!("Failed to spawn Node server: {e}"))?;

        self.child = Some(child);

        // Poll for server readiness (up to 10 seconds)
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(100));
            if self.is_ready() {
                log::info!("Meowtrix server is ready on http://127.0.0.1:{}", self.port);
                return Ok(self.port);
            }
        }

        Err(format!(
            "Meowtrix server failed to become ready on http://127.0.0.1:{} within 10s",
            self.port
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
    // 1. Explicit environment override
    if let Ok(env_path) = std::env::var("MEOWTRIX_NODE_BIN") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
    }

    // 2. Direct `node` in PATH
    if Command::new("node").arg("--version").output().is_ok() {
        return Ok(PathBuf::from("node"));
    }

    // 3. Known common locations on macOS / Linux
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

    // 4. Check NVM installations under ~/.nvm/versions/node
    if let Ok(home) = std::env::var("HOME") {
        let nvm_dir = PathBuf::from(&home).join(".nvm/versions/node");
        if nvm_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(nvm_dir) {
                let mut versions: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path().join("bin/node"))
                    .filter(|p| p.is_file())
                    .collect();
                // Sort descending to prefer latest node version
                versions.sort();
                if let Some(latest) = versions.pop() {
                    return Ok(latest);
                }
            }
        }
    }

    // 5. Ask login shell (resolves ~/.zshrc or ~/.bashrc paths)
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

    Err("Could not find a Node.js runtime. Please install Node.js (v18+) or set MEOWTRIX_NODE_BIN.".to_string())
}

/// Locates `server.js` either in the repository root (dev) or in the bundled resources (packaged app).
fn find_server_script(app: &AppHandle) -> Result<PathBuf, String> {
    // 1. Check relative to resources directory (for bundled app)
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidate = res_dir.join("server.js");
        if candidate.is_file() {
            return Ok(candidate);
        }
        let candidate_app = res_dir.join("app/server.js");
        if candidate_app.is_file() {
            return Ok(candidate_app);
        }
    }

    // 2. Check current working directory
    let cwd_candidate = PathBuf::from("server.js");
    if cwd_candidate.is_file() {
        return Ok(cwd_candidate.canonicalize().unwrap_or(cwd_candidate));
    }

    // 3. Check parent directory (e.g. if running inside src-tauri)
    let parent_candidate = PathBuf::from("../server.js");
    if parent_candidate.is_file() {
        return Ok(parent_candidate.canonicalize().unwrap_or(parent_candidate));
    }

    // 4. Check relative to the executable path
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
