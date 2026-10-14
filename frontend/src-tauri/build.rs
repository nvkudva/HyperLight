fn main() {
  // The UI is served from the backend (a remote origin to Tauri), which may only
  // call app commands that a capability grants explicitly.
  let manifest = tauri_build::AppManifest::new().commands(&["set_hotkey", "request_keyboard_access"]);
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("failed to run tauri-build");
}
