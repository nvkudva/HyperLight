//! Dock icon visibility. Shown by default; hiding is remembered by a flag file.

use std::path::PathBuf;

use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Manager};

/// The tray's "Show Dock Icon" item, kept so a change from Settings can tick it.
pub struct MenuItem(pub CheckMenuItem<tauri::Wry>);

fn hidden_flag_path() -> PathBuf {
  let home = std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into());
  PathBuf::from(home).join(".hyperlight").join("hide_dock_icon")
}

pub fn is_visible() -> bool {
  !hidden_flag_path().exists()
}

#[cfg(target_os = "macos")]
fn apply_policy(app: &AppHandle, visible: bool) {
  let policy = if visible { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory };
  let handle = app.clone();
  // AppKit only accepts a policy change on the main thread.
  let _ = app.run_on_main_thread(move || {
    let _ = handle.set_activation_policy(policy);
  });
}

#[cfg(not(target_os = "macos"))]
fn apply_policy(_app: &AppHandle, _visible: bool) {}

/// Applies the saved choice at startup.
pub fn apply_saved(app: &AppHandle) {
  apply_policy(app, is_visible());
}

fn save_choice(visible: bool) -> std::io::Result<()> {
  let flag = hidden_flag_path();
  if !visible {
    if let Some(dir) = flag.parent() {
      std::fs::create_dir_all(dir)?;
    }
    return std::fs::write(&flag, b"");
  }
  match std::fs::remove_file(&flag) {
    Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err),
    _ => Ok(()),
  }
}

pub fn set_visible(app: &AppHandle, visible: bool) {
  if let Err(err) = save_choice(visible) {
    log::warn!("could not save dock icon choice: {err}");
    return;
  }
  apply_policy(app, visible);
  if let Some(item) = app.try_state::<MenuItem>() {
    let _ = item.0.set_checked(visible);
  }
}

#[tauri::command]
pub fn dock_icon_visible() -> bool {
  is_visible()
}

#[tauri::command]
pub fn set_dock_icon_visible(app: AppHandle, visible: bool) {
  set_visible(&app, visible);
}
