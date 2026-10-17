//! Starts the local Python backend (FastAPI on 127.0.0.1:8585) and reports
//! when it answers, so the window can load the UI it serves.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

// Same origin as `devUrl`: localStorage (chat history, onboarding) is per origin.
pub const URL: &str = "http://localhost:8585/";
const ADDR: ([u8; 4], u16) = ([127, 0, 0, 1], 8585);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(500);
/// A backend busy loading its models can be slow to answer; only one silent this long is hung.
const SLOW_BACKEND_GRACE: Duration = Duration::from_secs(10);
/// How long a signalled backend gets to exit before the next, harsher signal.
const EXIT_GRACE: Duration = Duration::from_secs(3);

/// The backend this app started. One we merely found running (dev-app.sh) is never stopped by us.
static SPAWNED: Mutex<Option<Child>> = Mutex::new(None);

pub fn healthy() -> bool {
  let Ok(mut stream) = TcpStream::connect_timeout(&SocketAddr::from(ADDR), Duration::from_millis(500)) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
  let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
  if stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:8585\r\n\r\n").is_err() {
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

/// Bundled sidecar for a given app executable path
/// (`.../Hyperlight.app/Contents/MacOS/hyperlight`), if the frozen Python
/// backend was bundled into `Contents/Resources/backend/`.
fn sidecar_path(exe: &std::path::Path) -> Option<PathBuf> {
  let contents_dir = exe.parent()?.parent()?;
  let candidate = contents_dir.join("Resources/backend/hyperlight-backend");
  candidate.is_file().then_some(candidate)
}

fn bundled_sidecar() -> Option<PathBuf> {
  std::env::current_exe().ok().and_then(|exe| sidecar_path(&exe))
}

fn port_open() -> bool {
  TcpStream::connect_timeout(&SocketAddr::from(ADDR), Duration::from_millis(300)).is_ok()
}

fn wait_for(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
  let polls = timeout.as_millis() / POLL.as_millis();
  (0..polls).any(|_| {
    if condition() {
      return true;
    }
    std::thread::sleep(POLL);
    false
  })
}

fn signal_matching(signal: &str, pattern: &std::path::Path) {
  let _ = Command::new("/usr/bin/pkill").arg(signal).arg("-f").arg(pattern).status();
}

/// Frees the port from a backend that stopped answering. SIGTERM first so
/// LanceDB can close cleanly; SIGKILL only if it still holds the port.
fn stop_unresponsive_backend(pattern: &std::path::Path) {
  signal_matching("-TERM", pattern);
  if wait_for(EXIT_GRACE, || !port_open()) {
    return;
  }
  signal_matching("-KILL", pattern);
  std::thread::sleep(POLL);
}

/// The command that runs the backend, and the pattern that finds its process.
/// Release builds run the bundled frozen backend; dev builds use the repo checkout's .venv.
fn backend_command() -> (Command, PathBuf) {
  if let Some(sidecar) = bundled_sidecar() {
    return (Command::new(&sidecar), sidecar);
  }
  let dir = project_dir();
  let script = dir.join("web_app.py");
  let mut command = Command::new(dir.join(".venv/bin/python3"));
  command.arg(&script).current_dir(&dir);
  (command, script)
}

fn spawn_process(mut command: Command) -> std::io::Result<()> {
  let log_dir = PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into())).join(".hyperlight");
  std::fs::create_dir_all(&log_dir)?;
  let log = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(log_dir.join("backend.log"))?;
  let child = command.stdout(Stdio::from(log.try_clone()?)).stderr(Stdio::from(log)).spawn()?;
  if let Ok(mut spawned) = SPAWNED.lock() {
    *spawned = Some(child);
  }
  Ok(())
}

/// Stops the backend this app started. Does nothing for one we did not start.
pub fn stop_spawned() {
  if let Some(mut child) = SPAWNED.lock().ok().and_then(|mut spawned| spawned.take()) {
    terminate(&mut child);
  }
}

/// SIGTERM so LanceDB can close cleanly; SIGKILL only if the process lingers.
fn terminate(child: &mut Child) {
  let _ = Command::new("/bin/kill").arg("-TERM").arg(child.id().to_string()).status();
  if wait_for(EXIT_GRACE, || matches!(child.try_wait(), Ok(Some(_)))) {
    return;
  }
  let _ = child.kill();
  let _ = child.wait();
}

#[cfg(test)]
mod tests {
  use super::{sidecar_path, terminate, wait_for};
  use std::process::Command;
  use std::time::Duration;

  #[test]
  fn wait_for_returns_as_soon_as_the_condition_holds() {
    let mut calls = 0;
    assert!(wait_for(Duration::from_secs(5), || {
      calls += 1;
      calls == 2
    }));
    assert!(!wait_for(Duration::from_millis(500), || false));
  }

  #[test]
  fn terminate_stops_a_running_child() {
    let mut child = Command::new("sleep").arg("30").spawn().expect("spawn sleep");
    terminate(&mut child);
    assert!(matches!(child.try_wait(), Ok(Some(_))));
  }

  #[test]
  fn finds_bundled_sidecar_next_to_app_executable() {
    let root = std::env::temp_dir().join(format!("hyperlight-sidecar-test-{}", std::process::id()));
    let macos_dir = root.join("Hyperlight.app/Contents/MacOS");
    let backend_dir = root.join("Hyperlight.app/Contents/Resources/backend");
    std::fs::create_dir_all(&macos_dir).expect("create MacOS dir");
    std::fs::create_dir_all(&backend_dir).expect("create backend dir");
    std::fs::write(backend_dir.join("hyperlight-backend"), b"fake").expect("write sidecar");

    let exe = macos_dir.join("hyperlight");
    let found = sidecar_path(&exe);
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(found, Some(backend_dir.join("hyperlight-backend")));
  }

  #[test]
  fn no_sidecar_when_not_bundled() {
    let exe = std::path::Path::new("/tmp/Hyperlight.app/Contents/MacOS/hyperlight");
    assert_eq!(sidecar_path(exe), None);
  }
}

/// Blocks until the backend answers, starting it if needed. Call off the main thread.
pub fn ensure_running() -> bool {
  if healthy() {
    return true;
  }
  let (command, pattern) = backend_command();
  if port_open() {
    if wait_for(SLOW_BACKEND_GRACE, healthy) {
      return true;
    }
    stop_unresponsive_backend(&pattern);
  }
  if let Err(err) = spawn_process(command) {
    log::error!("could not start backend in {}: {err}", project_dir().display());
    return false;
  }
  wait_for(STARTUP_TIMEOUT, healthy)
}
