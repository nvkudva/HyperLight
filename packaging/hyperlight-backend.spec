# PyInstaller spec for the standalone Hyperlight backend sidecar.
# Build via packaging/build_sidecar.sh. Output lands in
# frontend/src-tauri/resources/hyperlight-backend/ (bundled into the .app).
import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [
    (os.path.join(ROOT, "frontend", "dist"), "frontend/dist"),
]
binaries = []
hiddenimports = [
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "watchdog.observers.fsevents",
    "Vision",
    "Quartz",
    "objc",
    "Foundation",
    "AppKit",
]

# google_client.json is gitignored and optional; bundle it when present so
# Google sign-in works in release builds without a repo checkout.
_bundled_client = os.path.join(ROOT, "google_client.json")
if os.path.exists(_bundled_client):
    datas.append((_bundled_client, "."))

for _pkg in (
    "lancedb",
    "sentence_transformers",
    "transformers",
    "tokenizers",
    "whisper",
    "soundfile",
    "pypdfium2",
    "watchdog",
    "torch",
    "torchvision",
    "huggingface_hub",
):
    _d, _b, _h = collect_all(_pkg)
    datas += _d
    binaries += _b
    hiddenimports += _h

hiddenimports += collect_submodules("routes")
hiddenimports += collect_submodules("google_sync")

a = Analysis(
    [os.path.join(ROOT, "web_app.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["playwright", "tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="hyperlight-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    target_arch="arm64",
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="hyperlight-backend",
)
