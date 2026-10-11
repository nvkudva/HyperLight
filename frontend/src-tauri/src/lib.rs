use tauri::Manager;

fn ensure_backend_running() {
  use std::net::TcpStream;
  use std::time::Duration;
  if TcpStream::connect_timeout(&"127.0.0.1:8585".parse().unwrap(), Duration::from_millis(300)).is_ok() {
    return;
  }

  let project_dir = "/Users/vijay/dev/projects/Smart Personal Search";
  let python_path = format!("{}/.venv/bin/python3", project_dir);
  let script_path = format!("{}/web_app.py", project_dir);

  if std::path::Path::new(&python_path).exists() {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let log_dir = std::path::PathBuf::from(home).join(".smart_personal_search");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_file = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(log_dir.join("backend.log"))
      .unwrap_or_else(|_| std::fs::File::create("/tmp/sps_backend.log").unwrap());
    let err_file = log_file.try_clone().unwrap();

    let _ = std::process::Command::new(&python_path)
      .arg(&script_path)
      .current_dir(project_dir)
      .stdout(std::process::Stdio::from(log_file))
      .stderr(std::process::Stdio::from(err_file))
      .spawn();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  ensure_backend_running();

  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(target_os = "macos")]
      {
        use cocoa::appkit::NSWindow;
        if let Some(win) = app.get_webview_window("main") {
          if let Ok(ns_win) = win.ns_window() {
            unsafe {
              let nswindow_ptr = ns_win as cocoa::base::id;
              nswindow_ptr.setMovableByWindowBackground_(cocoa::base::YES);
            }
          }
          use window_vibrancy::{LiquidGlassOptions, NSGlassEffectViewStyle, NSVisualEffectMaterial};
          if window_vibrancy::apply_liquid_glass(&win, LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular)).is_err() {
            let _ = window_vibrancy::apply_vibrancy(&win, NSVisualEffectMaterial::Sidebar, None, None);
          }
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
