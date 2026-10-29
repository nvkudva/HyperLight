#!/bin/bash
# One-command setup and launch: ./install.sh
# Safe to re-run: every step is skipped when already done.
# Building locally avoids the Gatekeeper warning that downloaded releases get.
set -euo pipefail
cd "$(dirname "$0")"

APP_DIR="$HOME/.hyperlight"
LOG="$APP_DIR/install.log"
BACKEND_LOG="$APP_DIR/backend.log"
STATUS_URL="http://127.0.0.1:8585/api/status"
MODEL="gemma2:2b"
MIN_FREE_GB=10
MIN_MACOS_MAJOR=13
CURRENT_STEP="starting"
mkdir -p "$APP_DIR"
: >"$LOG"

say() { printf '%s\n' "$*"; }
step() { CURRENT_STEP="$*"; say "==> $*"; }
skip() { say "    already done, skipping"; }
warn() { say "    ! $*"; }
quiet() { "$@" >>"$LOG" 2>&1; }

# Retry flaky network commands before giving up.
retry() {
  local attempt
  for attempt in 1 2 3; do
    quiet "$@" && return 0
    say "    attempt $attempt failed, retrying..."
    sleep 3
  done
  return 1
}

hint_from_file() {
  local file="$1"
  if grep -qiE "no space left" "$file"; then
    say "  Disk is full. Free some space."
  elif grep -qiE "could not resolve|timed out|timeout|connection (reset|refused)|network is unreachable|ssl|certificate" "$file"; then
    say "  Network problem. Check your connection, VPN or proxy."
  elif grep -qiE "xcrun|xcode-select|xcodebuild|license agreement|linker .*not found|cc.* not found" "$file"; then
    say "  Apple build tools problem. Run: xcode-select --install"
    say "  If Xcode is installed: sudo xcodebuild -license accept"
  elif grep -qiE "permission denied|operation not permitted" "$file"; then
    say "  Permission problem. Do not use sudo; check you own this folder: ls -ld ."
  elif grep -qiE "address already in use|errno 48" "$file"; then
    say "  Port 8585 is taken. Find it with: lsof -nP -iTCP:8585 -sTCP:LISTEN"
  elif grep -qiE "modulenotfounderror|importerror" "$file"; then
    say "  Broken Python install. Run: rm -rf .venv, then re-run."
  fi
}

report_failure() {
  local reason="${1:-}"
  say ""
  say "x Failed: $CURRENT_STEP"
  [ -n "$reason" ] && say "  $reason"
  if [ -s "$LOG" ]; then
    say "  Last log lines:"
    tail -n 12 "$LOG" | sed 's/^/    /'
    hint_from_file "$LOG"
  fi
  say "  Full log: $LOG"
  say "  Fix the issue, then re-run ./install.sh (finished steps are skipped)."
}

die() { report_failure "$1"; exit 1; }
trap 'report_failure' ERR
trap 'say ""; say "Cancelled. Re-run ./install.sh to continue where it stopped."; exit 130' INT TERM

check_mac() {
  [ "$(uname -s)" = "Darwin" ] || die "Hyperlight only runs on macOS."
  [ "$(id -u)" -ne 0 ] || die "Do not run with sudo. Run ./install.sh as your normal user."

  if [ "$(uname -m)" != "arm64" ]; then
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
      die "This Terminal runs under Rosetta. Open a native Terminal (untick 'Open using Rosetta' in its Get Info) and re-run."
    fi
    die "Hyperlight needs Apple Silicon (M1 or newer)."
  fi

  local macosMajor
  macosMajor=$(sw_vers -productVersion | cut -d. -f1)
  [ "$macosMajor" -ge "$MIN_MACOS_MAJOR" ] || die "macOS $MIN_MACOS_MAJOR or newer needed, you have $(sw_vers -productVersion). Update in System Settings > General > Software Update."

  xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools missing. Run: xcode-select --install, wait for it to finish, then re-run."

  local freeGb
  freeGb=$(df -g . | awk 'NR==2 {print $4}')
  [ "$freeGb" -ge "$MIN_FREE_GB" ] || die "Only ${freeGb} GB free, need about ${MIN_FREE_GB} GB. Free some space and re-run."

  curl -sfI --max-time 10 https://github.com >/dev/null || die "No internet connection. Connect and re-run."
}

# Tools installed earlier may exist but not be on PATH in this shell.
load_known_paths() {
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  return 0
}

install_tool() {
  local tool="$1" formula="$1"
  step "Tool: $tool"
  if command -v "$tool" >/dev/null; then
    skip
    return
  fi
  case "$tool" in
    bun) formula="oven-sh/bun/bun" ;;
    cargo) formula="rust" ;;
  esac
  retry brew install "$formula" || die "brew could not install $formula. Try: brew doctor, then brew install $formula."
  command -v "$tool" >/dev/null || die "$tool installed but not found on PATH. Open a new Terminal and re-run."
}

setup_python() {
  step "Python 3.12 environment (.venv)"
  if [ -x .venv/bin/python3 ] && .venv/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; then
    skip
  else
    rm -rf .venv
    retry uv venv --python 3.12 .venv || die "Could not create .venv. Check your connection and re-run."
  fi

  step "Python packages (large download, a few minutes the first time)"
  retry uv pip install --python .venv/bin/python3 -r requirements.txt || die "Package install failed. See the log for the failing package."
  .venv/bin/python3 -c "import fastapi, lancedb, torch, sentence_transformers" >>"$LOG" 2>&1 \
    || die "Packages installed but do not import. Run: rm -rf .venv, then re-run."
}

install_frontend() {
  step "Frontend packages"
  cd frontend
  if ! retry bun install --frozen-lockfile; then
    warn "lockfile install failed, trying a normal install"
    retry bun install || die "bun install failed. Try: cd frontend && bun install"
  fi
  cd ..
}

setup_ollama() {
  step "Ollama chat model ($MODEL)"
  if ! curl -sf http://127.0.0.1:11434 >/dev/null 2>&1; then
    quiet brew services start ollama || true
    for _ in $(seq 1 20); do
      curl -sf http://127.0.0.1:11434 >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  if ! curl -sf http://127.0.0.1:11434 >/dev/null 2>&1; then
    warn "Ollama is not running. Search works, chat answers won't. Open the Ollama app, then: ollama pull $MODEL"
  elif ollama list 2>/dev/null | grep -q "^$MODEL"; then
    skip
  elif ! retry ollama pull "$MODEL"; then
    warn "Could not pull $MODEL. Chat answers won't work until you run: ollama pull $MODEL"
  fi
}

start_backend() {
  step "Starting backend on port 8585"
  if curl -sf "$STATUS_URL" >/dev/null 2>&1; then
    skip
    return
  fi

  local portOwner
  portOwner=$(lsof -nP -iTCP:8585 -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}')
  [ -z "$portOwner" ] || die "Port 8585 is used by '$portOwner'. Quit it and re-run."

  nohup .venv/bin/python web_app.py >"$BACKEND_LOG" 2>&1 &
  local backendPid=$!
  disown "$backendPid" 2>/dev/null || true

  for _ in $(seq 1 90); do
    curl -sf "$STATUS_URL" >/dev/null 2>&1 && return
    if ! kill -0 "$backendPid" 2>/dev/null; then
      say "  Backend log:"
      tail -n 15 "$BACKEND_LOG" | sed 's/^/    /'
      hint_from_file "$BACKEND_LOG"
      die "Backend crashed on startup. Full log: $BACKEND_LOG"
    fi
    sleep 2
  done
  die "Backend did not become ready in 3 minutes. See $BACKEND_LOG"
}

launch_app() {
  step "Building and launching Hyperlight (first Rust build takes a few minutes)"
  ./dev-app.sh >>"$LOG" 2>&1 || die "Build failed. If it mentions cargo or Tauri, run: rustup update (or brew upgrade rust)."
  sleep 3
  pgrep -f "HyperlightDev.app/Contents/MacOS/Hyperlight" >/dev/null \
    || die "The app closed right after launching. Run ./dev-app.sh to see it again; backend log: $BACKEND_LOG"
}

step "Checking your Mac"
check_mac
load_known_paths
for tool in uv bun cargo ollama; do
  [ "$tool" = "uv" ] && ! command -v brew >/dev/null && die "Homebrew missing. Install it from https://brew.sh, open a new Terminal, then re-run."
  install_tool "$tool"
done
setup_python
install_frontend
setup_ollama
start_backend
launch_app

trap - ERR
say ""
say "Done. Hyperlight is running."
say "First run: macOS asks for microphone and file access, click Allow."
say "The search model downloads on first use, so the first search needs internet."
say "Relaunch any time with ./dev-app.sh"
