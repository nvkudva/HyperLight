mod backend;
mod hotkey;

use tauri::Manager;

/// Starts the backend off the main thread so the window appears at once, then
/// points the window at the UI the backend serves.
fn load_ui_when_backend_ready(app: tauri::AppHandle) {
  std::thread::spawn(move || {
    let already_up = backend::healthy();
    if !already_up && !backend::ensure_running() {
      return;
    }
    let Some(win) = app.get_webview_window("main") else { return };
    let target: tauri::Url = backend::URL.parse().expect("valid backend URL");
    let on_backend = win.url().is_ok_and(|u| u.origin() == target.origin());
    if !already_up || !on_backend {
      let _ = win.navigate(target);
    }
  });
}

#[cfg(target_os = "macos")]
fn apply_window_glass(win: &tauri::WebviewWindow) {
  use window_vibrancy::{LiquidGlassOptions, NSGlassEffectViewStyle, NSVisualEffectMaterial};
  if window_vibrancy::apply_liquid_glass(win, LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular)).is_err() {
    let _ = window_vibrancy::apply_vibrancy(win, NSVisualEffectMaterial::Sidebar, None, None);
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let hotkey_state: &'static hotkey::State = Box::leak(Box::default());

  tauri::Builder::default()
    .manage(hotkey_state)
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      hotkey::spawn(app.handle().clone(), hotkey_state);
      #[cfg(target_os = "macos")]
      if let Some(win) = app.get_webview_window("main") {
        apply_window_glass(&win);
      }
      load_ui_when_backend_ready(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![hotkey::set_hotkey, hotkey::request_keyboard_access])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
