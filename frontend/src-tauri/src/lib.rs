use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
