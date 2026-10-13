//! Starts the local Python backend (FastAPI on 127.0.0.1:8585) and reports
//! when it answers, so the window can load the UI it serves.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

// Same origin as `devUrl`: localStorage (chat history, onboarding) is per origin.
pub const URL: &str = "http://localhost:8585/";
const ADDR: ([u8; 4], u16) = ([127, 0, 0, 1], 8585);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(500);

pub fn healthy() -> bool {
  let Ok(mut stream) = TcpStream::connect_timeout(&SocketAddr::from(ADDR), Duration::from_millis(500)) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
  let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
  if stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").is_err() {
    return false;
  }
  let mut buf = [0u8; 64];
  matches!(stream.read(&mut buf), Ok(n) if String::from_utf8_lossy(&buf[..n]).contains(" 200 "))
}

/// Backend checkout: `HYPERLIGHT_BACKEND_DIR`, else the repo this shell was built from.
fn project_dir() -> PathBuf {
  std::env::var_os("HYPERLIGHT_BACKEND_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn spawn_process() -> std::io::Result<()> {
  let dir = project_dir();
  let script = dir.join("web_app.py");
  let log_dir = PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into())).join(".hyperlight");
  std::fs::create_dir_all(&log_dir)?;
  let log = std::fs::OpenOptions::new().create(true).append(true).open(log_dir.join("backend.log"))?;

  if TcpStream::connect_timeout(&SocketAddr::from(ADDR), Duration::from_millis(300)).is_ok() {
    // Port open but HTTP dead: a hung backend holds the port, so replace it.
    let _ = Command::new("/usr/bin/pkill").arg("-9").arg("-f").arg(&script).status();
    std::thread::sleep(POLL);
  }
  Command::new(dir.join(".venv/bin/python3"))
    .arg(&script)
    .current_dir(&dir)
    .stdout(Stdio::from(log.try_clone()?))
    .stderr(Stdio::from(log))
    .spawn()
    .map(|_| ())
}

/// Blocks until the backend answers, starting it if needed. Call off the main thread.
pub fn ensure_running() -> bool {
  if healthy() {
    return true;
  }
  if let Err(err) = spawn_process() {
    log::error!("could not start backend in {}: {err}", project_dir().display());
    return false;
  }
  let polls = STARTUP_TIMEOUT.as_millis() / POLL.as_millis();
  (0..polls).any(|_| {
    std::thread::sleep(POLL);
    healthy()
  })
}
