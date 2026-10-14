//! Menu bar icon: the app lives here instead of the Dock.

use tauri::Emitter;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::ManagerExt;

use crate::hotkey;

const SHOW: &str = "show";
const VOICE: &str = "voice";
const HISTORY: &str = "history";
const SETTINGS: &str = "settings";
const LOGIN: &str = "login";
const RESTART: &str = "restart";
const QUIT: &str = "quit";

/// Shows the window and asks the UI to switch to `view` ("history" or "settings").
fn open_view(app: &tauri::AppHandle, view: &str) {
  hotkey::show_window(app);
  let _ = app.emit("hyperlight-open-view", view);
}

fn toggle_open_at_login(app: &tauri::AppHandle, item: &CheckMenuItem<tauri::Wry>) {
  let launcher = app.autolaunch();
  let result = if launcher.is_enabled().unwrap_or(false) { launcher.disable() } else { launcher.enable() };
  if let Err(err) = result {
    log::warn!("open at login toggle failed: {err}");
  }
  let _ = item.set_checked(launcher.is_enabled().unwrap_or(false));
}

pub fn build(app: &tauri::AppHandle) -> tauri::Result<()> {
  let open_at_login = app.autolaunch().is_enabled().unwrap_or(false);
  let login_item = CheckMenuItem::with_id(app, LOGIN, "Open at Login", true, open_at_login, None::<&str>)?;
  let menu = Menu::with_items(
    app,
    &[
      &MenuItem::with_id(app, SHOW, "Open", true, None::<&str>)?,
      &MenuItem::with_id(app, VOICE, "Voice Search", true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, HISTORY, "History", true, None::<&str>)?,
      &MenuItem::with_id(app, SETTINGS, "Settings…", true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      &login_item,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, RESTART, "Restart", true, None::<&str>)?,
      &MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?,
    ],
  )?;

  let tray = TrayIconBuilder::with_id("main")
    .icon(tauri::include_image!("icons/tray.png"))
    .icon_as_template(true)
    .tooltip("Hyperlight")
    .menu(&menu)
    .on_menu_event(move |app, event| match event.id().as_ref() {
      SHOW => hotkey::reveal(app, false),
      VOICE => hotkey::reveal(app, true),
      HISTORY => open_view(app, "history"),
      SETTINGS => open_view(app, "settings"),
      LOGIN => toggle_open_at_login(app, &login_item),
      RESTART => app.restart(),
      QUIT => app.exit(0),
      _ => {}
    });
  tray.build(app)?;
  Ok(())
}
