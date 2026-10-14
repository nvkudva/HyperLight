mod backend;
mod hotkey;
mod permission;
mod tray;

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

  let app = tauri::Builder::default()
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
    .manage(hotkey_state)
    // Closing hides the window so the hotkey, tray and app icon can bring it back.
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      hotkey::prompt_if_missing();
      hotkey::spawn(app.handle().clone(), hotkey_state);
      #[cfg(target_os = "macos")]
      app.set_activation_policy(tauri::ActivationPolicy::Accessory);
      tray::build(app.handle())?;
      #[cfg(target_os = "macos")]
      if let Some(win) = app.get_webview_window("main") {
        hide_traffic_lights(&win);
      }
      load_ui_when_backend_ready(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![hotkey::set_hotkey, hotkey::request_keyboard_access, hotkey::keyboard_access_granted,
      permission::start_permission_drag,
      permission::close_permission_helper,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app, event| {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { .. } = event {
      hotkey::show_window(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
  });
}
