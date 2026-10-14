//! Global hotkey: a listen-only CGEventTap that brings the window forward.
//!
//! Listen-only taps need the Input Monitoring permission (not Accessibility)
//! and are allowed inside the App Sandbox.

use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
  fn CGEventTapCreate(
    tap: u32,
    place: u32,
    options: u32,
    events_of_interest: u64,
    callback: extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void,
    refcon: *mut c_void,
  ) -> *mut c_void;
  fn CGEventTapEnable(tap: *mut c_void, enable: bool);
  fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
  fn CGEventGetFlags(event: *mut c_void) -> u64;
  fn CGPreflightListenEventAccess() -> bool;
  fn CGRequestListenEventAccess() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
  fn CFMachPortCreateRunLoopSource(allocator: *mut c_void, port: *mut c_void, order: isize) -> *mut c_void;
  fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
  fn CFRunLoopGetCurrent() -> *mut c_void;
  fn CFRunLoopRun();
  static kCFRunLoopCommonModes: *const c_void;
}

const SESSION_EVENT_TAP: u32 = 1;
const HEAD_INSERT_EVENT_TAP: u32 = 0;
const TAP_OPTION_LISTEN_ONLY: u32 = 1;
const EV_KEY_DOWN: u32 = 10;
const EV_FLAGS_CHANGED: u32 = 12;
const EV_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const EV_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
const FIELD_KEYCODE: u32 = 9;
const MASK_SHIFT: u64 = 0x0002_0000;
const MASK_CTRL: u64 = 0x0004_0000;
const MASK_ALT: u64 = 0x0008_0000;
const MASK_CMD: u64 = 0x0010_0000;
const MASK_MODS: u64 = MASK_SHIFT | MASK_CTRL | MASK_ALT | MASK_CMD;
const KEYCODE_RIGHT_CTRL: i64 = 62;
const KEYCODE_RIGHT_OPTION: i64 = 61;
const DOUBLE_PRESS: Duration = Duration::from_millis(400);

/// A modifier key that triggers when pressed twice in quick succession.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DoubleTap {
  keycode: i64,
  mask: u64,
}

const DOUBLE_RIGHT_CTRL: DoubleTap = DoubleTap { keycode: KEYCODE_RIGHT_CTRL, mask: MASK_CTRL };
const DOUBLE_RIGHT_OPTION: DoubleTap = DoubleTap { keycode: KEYCODE_RIGHT_OPTION, mask: MASK_ALT };

/// Named double-tap presets. Only the right-hand key ever matches: the
/// keycode check is exact, so the left twin cannot trigger it.
fn double_tap_for(name: &str) -> DoubleTap {
  if name == "double_option" {
    DOUBLE_RIGHT_OPTION
  } else {
    DOUBLE_RIGHT_CTRL
  }
}

fn tap_matches(tap: DoubleTap, keycode: i64, flags: u64) -> bool {
  keycode == tap.keycode && flags & tap.mask != 0
}

/// Records one press; returns true when it completes a double-press pair.
fn register_press(last: &mut Option<Instant>, now: Instant) -> bool {
  if last.is_some_and(|prev| now.duration_since(prev) <= DOUBLE_PRESS) {
    *last = None;
    return true;
  }
  *last = Some(now);
  false
}

pub const EVENT: &str = "hyperlight-hotkey";

#[derive(Debug, Clone)]
struct Config {
  enabled: bool,
  voice: bool,
  double_tap: Option<DoubleTap>,
  combo_key: Option<u32>,
  combo_mods: u64,
}

pub struct State {
  config: Mutex<Config>,
  last_tap_press: Mutex<Option<Instant>>,
}

impl Default for State {
  fn default() -> Self {
    Self {
      config: Mutex::new(Config { enabled: true, voice: true, double_tap: Some(DOUBLE_RIGHT_CTRL), combo_key: None, combo_mods: 0 }),
      last_tap_press: Mutex::new(None),
    }
  }
}

struct TapContext {
  app: tauri::AppHandle,
  state: &'static State,
}

static TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

pub fn show_window(app: &tauri::AppHandle) {
  if let Some(win) = app.get_webview_window("main") {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
  }
}

/// Brings the window forward and tells the UI to focus search, or start recording when `voice`.
pub fn reveal(app: &tauri::AppHandle, voice: bool) {
  show_window(app);
  let _ = app.emit(EVENT, serde_json::json!({ "voice": voice }));
}

fn is_double_tap(state: &State, tap: DoubleTap, event: *mut c_void) -> bool {
  let keycode = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) };
  let flags = unsafe { CGEventGetFlags(event) };
  if !tap_matches(tap, keycode, flags) {
    return false;
  }
  let Ok(mut last) = state.last_tap_press.lock() else { return false };
  register_press(&mut last, Instant::now())
}

fn is_combo(cfg: &Config, event: *mut c_void) -> bool {
  let Some(key) = cfg.combo_key else { return false };
  let keycode = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) };
  let flags = unsafe { CGEventGetFlags(event) };
  keycode as u32 == key && flags & MASK_MODS == cfg.combo_mods
}

extern "C" fn tap_callback(_proxy: *mut c_void, etype: u32, event: *mut c_void, refcon: *mut c_void) -> *mut c_void {
  if etype == EV_TAP_DISABLED_BY_TIMEOUT || etype == EV_TAP_DISABLED_BY_USER_INPUT {
    // macOS disables slow taps; without re-enabling, the hotkey silently dies.
    let tap = TAP.load(Ordering::Acquire);
    if !tap.is_null() {
      unsafe { CGEventTapEnable(tap, true) };
    }
    return event;
  }
  if event.is_null() || refcon.is_null() {
    return event;
  }
  let ctx = unsafe { &*(refcon as *const TapContext) };
  let Some(cfg) = ctx.state.config.lock().ok().map(|c| c.clone()) else { return event };
  if !cfg.enabled {
    return event;
  }
  let hit = match etype {
    EV_FLAGS_CHANGED => cfg.double_tap.is_some_and(|tap| is_double_tap(ctx.state, tap, event)),
    EV_KEY_DOWN => is_combo(&cfg, event),
    _ => false,
  };
  if hit {
    reveal(&ctx.app, cfg.voice);
  }
  event
}

/// Runs the event tap on its own run-loop thread, retrying until the user
/// grants Input Monitoring so a later grant works without relaunch.
pub fn spawn(app: tauri::AppHandle, state: &'static State) {
  std::thread::spawn(move || {
    let refcon = Box::into_raw(Box::new(TapContext { app, state })) as *mut c_void;
    loop {
      let tap = unsafe {
        CGEventTapCreate(
          SESSION_EVENT_TAP,
          HEAD_INSERT_EVENT_TAP,
          TAP_OPTION_LISTEN_ONLY,
          (1u64 << EV_KEY_DOWN) | (1u64 << EV_FLAGS_CHANGED),
          tap_callback,
          refcon,
        )
      };
      if tap.is_null() {
        std::thread::sleep(Duration::from_secs(10));
        continue;
      }
      TAP.store(tap, Ordering::Release);
      unsafe {
        let source = CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap, 0);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        CFRunLoopRun();
      }
      TAP.store(std::ptr::null_mut(), Ordering::Release);
      std::thread::sleep(Duration::from_secs(2));
    }
  });
}

fn modifier_bits(names: &[String]) -> u64 {
  names.iter().fold(0, |bits, n| {
    bits
      | match n.as_str() {
        "shift" => MASK_SHIFT,
        "ctrl" => MASK_CTRL,
        "alt" => MASK_ALT,
        "cmd" => MASK_CMD,
        _ => 0,
      }
  })
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum Hotkey {
  Combo { key_code: u32, modifiers: Vec<String> },
  DoubleCtrl(#[allow(dead_code)] String),
}

#[tauri::command]
pub fn set_hotkey(state: tauri::State<'_, &'static State>, enabled: bool, voice: bool, hotkey: Hotkey) {
  let (double_tap, combo_key, combo_mods) = match hotkey {
    Hotkey::Combo { key_code, modifiers } => (None, Some(key_code), modifier_bits(&modifiers)),
    Hotkey::DoubleCtrl(name) => (Some(double_tap_for(&name)), None, 0),
  };
  if let Ok(mut cfg) = state.config.lock() {
    *cfg = Config { enabled, voice, double_tap, combo_key, combo_mods };
  }
}

#[tauri::command]
pub fn keyboard_access_granted() -> bool {
  unsafe { CGPreflightListenEventAccess() }
}

/// Asks for Input Monitoring at launch so the user is not left with a dead hotkey.
pub fn prompt_if_missing() {
  if !unsafe { CGPreflightListenEventAccess() } {
    unsafe { CGRequestListenEventAccess() };
  }
}

#[cfg(test)]
mod tests {
  use super::{DoubleTap, MASK_ALT, MASK_CTRL, double_tap_for, register_press, tap_matches};
  use std::time::{Duration, Instant};

  #[test]
  fn double_option_means_right_option_only() {
    let tap = double_tap_for("double_option");
    assert_eq!(tap, DoubleTap { keycode: 61, mask: MASK_ALT });
    assert!(tap_matches(tap, 61, MASK_ALT));
    assert!(!tap_matches(tap, 58, MASK_ALT), "left Option must not trigger");
    assert!(!tap_matches(tap, 61, MASK_CTRL), "wrong modifier must not trigger");
  }

  #[test]
  fn double_ctrl_stays_default_for_other_names() {
    assert_eq!(double_tap_for("double_ctrl"), DoubleTap { keycode: 62, mask: MASK_CTRL });
    assert_eq!(double_tap_for("anything-else"), DoubleTap { keycode: 62, mask: MASK_CTRL });
  }

  #[test]
  fn second_press_within_window_triggers_once() {
    let start = Instant::now();
    let mut last = None;
    assert!(!register_press(&mut last, start));
    assert!(register_press(&mut last, start + Duration::from_millis(200)));
    assert!(!register_press(&mut last, start + Duration::from_millis(300)), "trigger resets the pair");
    assert!(!register_press(&mut last, start + Duration::from_secs(2)), "stale press expires");
  }
}

/// Shows the system Input Monitoring prompt once; afterwards macOS only lets
/// the user grant it in System Settings, so open that pane instead.
#[tauri::command]
pub fn request_keyboard_access(app: tauri::AppHandle) -> bool {
  if unsafe { CGPreflightListenEventAccess() } {
    return true;
  }
  if unsafe { CGRequestListenEventAccess() } {
    return true;
  }
  let _ = std::process::Command::new("open")
    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
    .spawn();
  crate::permission::show_helper(&app);
  false
}
