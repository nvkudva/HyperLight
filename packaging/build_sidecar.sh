#!/bin/sh
# Build the frozen Python backend sidecar into
# frontend/src-tauri/resources/hyperlight-backend/ for Tauri bundling.
# Usage: packaging/build_sidecar.sh   (expects .venv with backend deps)
set -eu
cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python3 ]; then
  echo "Missing .venv. Create it and install requirements.txt first." >&2
  exit 1
fi
if ! .venv/bin/python3 -c "import PyInstaller" 2>/dev/null; then
  uv pip install --python .venv/bin/python3 pyinstaller
fi
if [ ! -f frontend/dist/index.html ]; then
  (cd frontend && bun run build)
fi

rm -rf frontend/src-tauri/resources/hyperlight-backend packaging/build
.venv/bin/python3 -m PyInstaller packaging/hyperlight-backend.spec \
  --distpath frontend/src-tauri/resources \
  --workpath packaging/build \
  --noconfirm

test -x frontend/src-tauri/resources/hyperlight-backend/hyperlight-backend
echo "Sidecar built: frontend/src-tauri/resources/hyperlight-backend/hyperlight-backend"
