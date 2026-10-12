#!/bin/bash
# Single dev launcher for the Tauri app: exactly one window, mic works.
# Do NOT run `bun run tauri dev` alongside this: its raw binary opens a second
# window stacked under this bundle (resizing then looks broken) and macOS
# denies it mic access. This script kills those, rebuilds, and launches.
# Backend auto-spawns on :8585 if not already running.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/HyperlightDev.app"
BIN="$ROOT/frontend/src-tauri/target/debug/app"

pkill -f "src-tauri/target/debug/app" 2>/dev/null || true
pkill -f "HyperlightDev.app/Contents/MacOS/Hyperlight" 2>/dev/null || true
pkill -f "tauri dev" 2>/dev/null || true

if ! curl -sf http://127.0.0.1:8585/api/status >/dev/null 2>&1; then
  echo "Starting backend..."
  (cd "$ROOT" && nohup .venv/bin/python web_app.py >>"$HOME/.hyperlight/backend.log" 2>&1 &)
  for _ in $(seq 1 60); do
    curl -sf http://127.0.0.1:8585/api/status >/dev/null 2>&1 && break
    sleep 2
  done
fi

# Rebuild the web UI only when sources changed since the last build.
if [ ! -f "$ROOT/frontend/dist/index.html" ] || [ -n "$(find "$ROOT/frontend/src" "$ROOT/frontend/index.html" "$ROOT/frontend/package.json" -newer "$ROOT/frontend/dist/index.html" 2>/dev/null | head -1)" ]; then
  (cd "$ROOT/frontend" && bun run build)
else
  echo "Frontend dist is fresh, skipping build."
fi
(cd "$ROOT/frontend/src-tauri" && cargo build)

# Repackage + codesign only when the binary changed since the last bundle.
if [ ! -f "$APP/Contents/MacOS/Hyperlight" ] || [ "$BIN" -nt "$APP/Contents/MacOS/Hyperlight" ]; then
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS"
  cp "$ROOT/frontend/src-tauri/Info.dev.plist" "$APP/Contents/Info.plist"
  cp "$BIN" "$APP/Contents/MacOS/Hyperlight"
  codesign -s - --entitlements "$ROOT/frontend/src-tauri/entitlements.plist" --force --deep "$APP" >/dev/null
else
  echo "App bundle is fresh, skipping package/codesign."
fi
open -g "$APP"
echo "Launched $APP"
