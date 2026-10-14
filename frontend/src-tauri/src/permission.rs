//! Floating "drag me into the list" helper for the Input Monitoring pane.
//!
//! Dragging the app bundle from the helper into System Settings adds it to the
//! privacy list in one gesture, so the user never browses for it with "+".

use std::path::PathBuf;
use std::time::Duration;

use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::CFString;
use core_graphics::geometry::CGRect;
use core_graphics::window::{self, kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly};
use tauri::Manager;

use crate::backend;

const LABEL: &str = "permission";
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 132.0;
const GAP_BELOW_SETTINGS: f64 = 8.0;
const SETTINGS_APP_NAME: &str = "System Settings";
const SETTINGS_POLL: Duration = Duration::from_millis(150);
const SETTINGS_POLL_ATTEMPTS: u32 = 20;
const ICON_PNG: &[u8] = include_bytes!("../icons/128x128.png");

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
  fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
}

fn string_value(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<String> {
  dict.find(CFString::new(key))?.downcast::<CFString>().map(|s| s.to_string())
}

fn settings_window_bounds() -> Option<CGRect> {
  let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
  let windows = window::copy_window_info(options, kCGNullWindowID)?;
  for item in windows.iter() {
    let dict = unsafe { CFDictionary::<CFString, CFType>::wrap_under_get_rule(*item as CFDictionaryRef) };
    if string_value(&dict, "kCGWindowOwnerName").as_deref() != Some(SETTINGS_APP_NAME) {
      continue;
    }
    let bounds = dict.find(CFString::new("kCGWindowBounds"))?;
    let mut rect = CGRect::default();
    let parsed = unsafe { CGRectMakeWithDictionaryRepresentation(bounds.as_CFTypeRef() as CFDictionaryRef, &mut rect) };
    if parsed && rect.size.width > WIDTH {
      return Some(rect);
    }
  }
  None
}

fn wait_for_settings_window() -> Option<CGRect> {
  for _ in 0..SETTINGS_POLL_ATTEMPTS {
    if let Some(rect) = settings_window_bounds() {
      return Some(rect);
    }
    std::thread::sleep(SETTINGS_POLL);
  }
  None
}

/// Opens the helper under the System Settings window once that window exists.
pub fn show_helper(app: &tauri::AppHandle) {
  let app = app.clone();
  std::thread::spawn(move || {
    let anchor = wait_for_settings_window();
    let position = anchor.map(|r| {
      (r.origin.x + (r.size.width - WIDTH) / 2.0, r.origin.y + r.size.height + GAP_BELOW_SETTINGS)
    });

    if let Some(existing) = app.get_webview_window(LABEL) {
      if let Some((x, y)) = position {
        let _ = existing.set_position(tauri::LogicalPosition::new(x, y));
      }
      let _ = existing.show();
      return;
    }

    let url: tauri::Url = format!("{}?permission=1", backend::URL).parse().expect("valid helper URL");
    let mut builder = tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::External(url))
      .title("Allow Hyperlight")
      .inner_size(WIDTH, HEIGHT)
      .resizable(false)
      .decorations(false)
      .always_on_top(true)
      .skip_taskbar(true);
    builder = match position {
      Some((x, y)) => builder.position(x, y),
      None => builder.center(),
    };
    if let Err(err) = builder.build() {
      log::warn!("permission helper window failed: {err}");
    }
  });
}

fn app_bundle_path() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(PathBuf::from)
}

/// Starts a native file drag of this app's bundle. Runs on the main thread
/// (sync command) while the mouse button is still down.
#[tauri::command]
pub fn start_permission_drag(window: tauri::WebviewWindow) -> Result<(), String> {
  let bundle = app_bundle_path().ok_or("not running from an .app bundle")?;
  drag::start_drag(
    &window,
    drag::DragItem::Files(vec![bundle]),
    drag::Image::Raw(ICON_PNG.to_vec()),
    |_, _| {},
    drag::Options::default(),
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_permission_helper(app: tauri::AppHandle) {
  if let Some(win) = app.get_webview_window(LABEL) {
    let _ = win.close();
  }
}

const AV_MEDIA_TYPE_AUDIO: &str = "soun";
const MIC_STATUS_NOT_DETERMINED: isize = 0;
const MIC_STATUS_AUTHORIZED: isize = 3;

/// Asks for microphone access at launch. macOS shows its prompt only once, so
/// a previously denied or restricted mic sends the user to the Settings pane.
pub fn request_microphone_if_missing() {
  use block2::RcBlock;
  use objc2::msg_send;
  use objc2::runtime::{AnyClass, Bool};
  use objc2_foundation::NSString;

  let Some(capture_device) = AnyClass::get(c"AVCaptureDevice") else { return };
  let media_type = NSString::from_str(AV_MEDIA_TYPE_AUDIO);
  let status: isize = unsafe { msg_send![capture_device, authorizationStatusForMediaType: &*media_type] };
  if status == MIC_STATUS_AUTHORIZED {
    return;
  }
  if status == MIC_STATUS_NOT_DETERMINED {
    let on_answer = RcBlock::new(|_granted: Bool| {});
    let _: () = unsafe { msg_send![capture_device, requestAccessForMediaType: &*media_type, completionHandler: &*on_answer] };
    return;
  }
  let _ = std::process::Command::new("open")
    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
    .spawn();
}
