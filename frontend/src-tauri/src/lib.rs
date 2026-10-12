use tauri::{Emitter, Manager};

#[link(name = "CoreGraphics", kind = "framework")]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
  fn CGEventTapCreate(
    tap: u32,
    place: u32,
    options: u32,
    events_of_interest: u64,
    callback: extern "C" fn(
      proxy: *mut std::ffi::c_void,
      etype: i32,
      event: *mut std::ffi::c_void,
      refcon: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void,
    refcon: *mut std::ffi::c_void,
  ) -> *mut std::ffi::c_void;
  fn CFMachPortCreateRunLoopSource(
    allocator: *mut std::ffi::c_void,
    port: *mut std::ffi::c_void,
    order: isize,
  ) -> *mut std::ffi::c_void;
  fn CFRunLoopAddSource(
    rl: *mut std::ffi::c_void,
    source: *mut std::ffi::c_void,
    mode: *const std::ffi::c_void,
  );
  fn CFRunLoopGetCurrent() -> *mut std::ffi::c_void;
  fn CFRunLoopRun();
  fn CGEventTapEnable(tap: *mut std::ffi::c_void, enable: bool);
  fn CGEventGetIntegerValueField(event: *mut std::ffi::c_void, field: u32) -> i64;
  fn CGEventGetFlags(event: *mut std::ffi::c_void) -> u64;
  static kCFRunLoopCommonModes: *const std::ffi::c_void;
}

const TAP_HID: u32 = 0;
const TAP_HEAD_INSERT: u32 = 0;
const TAP_DEFAULT: u32 = 0;
const EV_KEY_DOWN: i32 = 10;
const EV_FLAGS_CHANGED: i32 = 12;
const EV_TAP_DISABLED_TIMEOUT: i32 = 0xFFFFFFFEu32 as i32;
const FIELD_KEYCODE: u32 = 9;
const MASK_SHIFT: u64 = 0x00020000;
const MASK_CTRL: u64 = 0x00040000;
const MASK_ALT: u64 = 0x00080000;
const MASK_CMD: u64 = 0x00100000;
const MASK_MODS: u64 = MASK_SHIFT | MASK_CTRL | MASK_ALT | MASK_CMD;
const KEYCODE_RIGHT_CTRL: i64 = 62;
const DOUBLE_PRESS_MS: u128 = 400;

#[derive(Debug, Clone, Default)]
struct HotkeyInner {
  enabled: bool,
  double_ctrl: bool,
  combo_key: Option<u32>,
  combo_mods: u64,
}

struct HotkeyState {
  inner: std::sync::Mutex<HotkeyInner>,
  last_ctrl_press: std::sync::Mutex<Option<std::time::Instant>>,
}

struct TapContext {
  app: tauri::AppHandle,
  state: &'static HotkeyState,
}

fn fire_hotkey(ctx: &TapContext) {
  if let Some(win) = ctx.app.get_webview_window("main") {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
  }
  let _ = ctx.app.emit("hyperlight-hotkey", serde_json::json!({ "voice": true }));
}

extern "C" fn tap_callback(
  _proxy: *mut std::ffi::c_void,
  etype: i32,
  event: *mut std::ffi::c_void,
  refcon: *mut std::ffi::c_void,
) -> *mut std::ffi::c_void {
  if event.is_null() || refcon.is_null() {
    return event;
  }
  if etype == EV_TAP_DISABLED_TIMEOUT {
    return event;
  }
  let ctx = unsafe { &*(refcon as *const TapContext) };
  let cfg = ctx.state.inner.lock().map(|c| c.clone()).unwrap_or_default();
  if !cfg.enabled {
    return event;
  }
  if etype == EV_FLAGS_CHANGED && cfg.double_ctrl {
    let keycode = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) };
    let flags = unsafe { CGEventGetFlags(event) };
    if keycode == KEYCODE_RIGHT_CTRL && flags & MASK_CTRL != 0 {
      let now = std::time::Instant::now();
      let mut last = ctx.state.last_ctrl_press.lock().unwrap();
      if let Some(prev) = *last {
        if now.duration_since(prev).as_millis() <= DOUBLE_PRESS_MS {
          *last = None;
          drop(last);
          fire_hotkey(ctx);
          return event;
        }
      }
      *last = Some(now);
    }
    return event;
  }
  if etype == EV_KEY_DOWN {
    if let Some(key) = cfg.combo_key {
      let keycode = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) };
      let flags = unsafe { CGEventGetFlags(event) };
      if keycode as u32 == key && flags & MASK_MODS == cfg.combo_mods {
        fire_hotkey(ctx);
      }
    }
  }
  event
}

fn spawn_hotkey_tap(app: tauri::AppHandle, state: &'static HotkeyState) {
  std::thread::spawn(move || {
    let ctx = Box::new(TapContext { app, state });
    let refcon = Box::into_raw(ctx) as *mut std::ffi::c_void;
    loop {
      let tap = unsafe {
        CGEventTapCreate(
          TAP_HID,
          TAP_HEAD_INSERT,
          TAP_DEFAULT,
          (1u64 << EV_KEY_DOWN) | (1u64 << EV_FLAGS_CHANGED),
          tap_callback,
          refcon,
        )
      };
      if tap.is_null() {
        // No Accessibility permission (or Input Monitoring): retry so a later
        // grant takes effect without relaunch.
        std::thread::sleep(std::time::Duration::from_secs(10));
        continue;
      }
      unsafe {
        let source = CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap, 0);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        CFRunLoopRun();
      }
      // Runloop exited unexpectedly; re-create the tap.
      std::thread::sleep(std::time::Duration::from_secs(2));
    }
  });
}

fn modifier_bits(names: &[String]) -> u64 {
  let mut bits = 0u64;
  for n in names {
    match n.as_str() {
      "shift" => bits |= MASK_SHIFT,
      "ctrl" => bits |= MASK_CTRL,
      "alt" => bits |= MASK_ALT,
      "cmd" => bits |= MASK_CMD,
      _ => {}
    }
  }
  bits
}

#[tauri::command]
fn set_hotkey(
  state: tauri::State<'_, &'static HotkeyState>,
  enabled: bool,
  hotkey: serde_json::Value,
) {
  let mut inner = HotkeyInner { enabled, ..Default::default() };
  match &hotkey {
    serde_json::Value::String(s) if s == "double_ctrl" => {
      inner.double_ctrl = true;
    }
    serde_json::Value::Object(map) => {
      if let (Some(k), Some(m)) = (map.get("key_code"), map.get("modifiers")) {
        if let (Some(key), Some(mods)) = (k.as_u64(), m.as_array()) {
          let names: Vec<String> = mods.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect();
          inner.combo_key = Some(key as u32);
          inner.combo_mods = modifier_bits(&names);
        }
      }
    }
    _ => {
      inner.double_ctrl = true;
    }
  }
  if let Ok(mut guard) = state.inner.lock() {
    *guard = inner;
  }
}

#[tauri::command]
fn open_accessibility_settings() {
  let _ = std::process::Command::new("open")
    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    .spawn();
}

fn ensure_backend_running() {
  use std::net::TcpStream;
  use std::time::Duration;
  if TcpStream::connect_timeout(&"127.0.0.1:8585".parse().unwrap(), Duration::from_millis(300)).is_ok() {
    return;
  }

  let project_dir = "/Users/vijay/dev/projects/Hyperlight";
  let python_path = format!("{}/.venv/bin/python3", project_dir);
  let script_path = format!("{}/web_app.py", project_dir);

  if std::path::Path::new(&python_path).exists() {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let log_dir = std::path::PathBuf::from(home).join(".hyperlight");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_file = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(log_dir.join("backend.log"))
      .unwrap_or_else(|_| std::fs::File::create("/tmp/hyperlight_backend.log").unwrap());
    let err_file = log_file.try_clone().unwrap();

    let _ = std::process::Command::new(&python_path)
      .arg(&script_path)
      .current_dir(project_dir)
      .stdout(std::process::Stdio::from(log_file))
      .stderr(std::process::Stdio::from(err_file))
      .spawn();

    for _ in 0..120 {
      if TcpStream::connect_timeout(&"127.0.0.1:8585".parse().unwrap(), Duration::from_millis(300)).is_ok() {
        return;
      }
      std::thread::sleep(Duration::from_millis(500));
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  ensure_backend_running();

  let hotkey_state: &'static HotkeyState = Box::leak(Box::new(HotkeyState {
    inner: std::sync::Mutex::new(HotkeyInner { enabled: true, double_ctrl: true, ..Default::default() }),
    last_ctrl_press: std::sync::Mutex::new(None),
  }));

  tauri::Builder::default()
    .manage(hotkey_state)
    .setup(move |app| {
      spawn_hotkey_tap(app.handle().clone(), hotkey_state);
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
    .invoke_handler(tauri::generate_handler![set_hotkey, open_accessibility_settings])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
