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
