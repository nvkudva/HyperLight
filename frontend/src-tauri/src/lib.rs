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
fn hide_traffic_lights(win: &tauri::WebviewWindow) {
  use objc2_app_kit::{NSWindow, NSWindowButton};
  let Ok(ptr) = win.ns_window() else { return };
  let ns_window = unsafe { &*(ptr as *const NSWindow) };
  for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
    if let Some(button) = ns_window.standardWindowButton(kind) {
      button.setHidden(true);
    }
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
        hide_traffic_lights(&win);
      }
      load_ui_when_backend_ready(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![hotkey::set_hotkey, hotkey::request_keyboard_access])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
