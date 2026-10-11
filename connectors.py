import hashlib
from pathlib import Path
import plistlib
import subprocess
from typing import Any, Dict, List, Optional
import embedder
import storage

def get_installed_applications() -> List[Dict[str, Any]]:
    apps = []
    scan_dirs = [Path("/Applications"), Path("/System/Applications")]
    for scan_dir in scan_dirs:
        if not scan_dir.exists():
            continue
        for app_path in scan_dir.glob("*.app"):
            name = app_path.stem
            bundle_id = ""
            category = ""
            plist_path = app_path / "Contents" / "Info.plist"
            if plist_path.exists():
                try:
                    with open(plist_path, "rb") as f:
                        info = plistlib.load(f)
                        bundle_id = info.get("CFBundleIdentifier", "")
                        raw_cat = info.get("LSApplicationCategoryType", "")
                        if raw_cat:
                            category = raw_cat.replace("public.app-category.", "")
                except Exception:
                    pass

            app_id = hashlib.sha256(f"app:{app_path}".encode()).hexdigest()[:16]
            content = f"Application: {name}"
            if category:
                content += f" | Category: {category}"
            if bundle_id:
                content += f" | Bundle ID: {bundle_id}"

            apps.append({
                "id": app_id,
                "type": "app",
                "path": str(app_path.resolve()),
                "filename": f"{name}.app",
                "content": content,
                "modified_at": app_path.stat().st_mtime,
                "metadata": {
                    "name": name,
                    "bundle_id": bundle_id,
                    "category": category,
                    "file_type": "app",
                    "size_human": "App Bundle",
                },
            })
    return apps

def index_applications(emb: embedder.Embedder, store: storage.Storage) -> int:
    apps = get_installed_applications()
    if not apps:
        return 0
    texts = [a["content"] for a in apps]
    titles = [a["filename"] for a in apps]
    vectors = emb.embed_texts(texts, titles=titles)
    for app_item, vec in zip(apps, vectors):
        app_item["vector"] = vec
        app_item["source"] = "macos_system"
    count = store.add_items(apps)
    storage.save_configured_source("macOS Applications", "/Applications", "macos_system", count)
    return count

def launch_target(target_path: str) -> bool:
    try:
        subprocess.run(["open", target_path], check=True, timeout=5)
        return True
    except Exception:
        return False

def reveal_in_finder(target_path: str) -> bool:
    try:
        subprocess.run(["open", "-R", target_path], check=True, timeout=5)
        return True
    except Exception:
        return False

def get_mounted_network_volumes() -> List[Dict[str, str]]:
    volumes = []
    vol_dir = Path("/Volumes")
    if not vol_dir.exists():
        return volumes
    for item in vol_dir.iterdir():
        if item.name.startswith("."):
            continue
        try:
            is_boot = item.resolve() == Path("/")
            if not is_boot and (item.is_dir() or item.is_symlink()):
                volumes.append({
                    "name": item.name,
                    "path": str(item.resolve()),
                    "type": "network_volume"
                })
        except Exception:
            pass
    return volumes

def get_google_drive_locations() -> List[Dict[str, str]]:
    locations = []
    home = Path.home()
    cloud_storage = home / "Library" / "CloudStorage"
    if cloud_storage.exists():
        for item in cloud_storage.iterdir():
            if item.is_dir() and "googledrive" in item.name.lower():
                my_drive = item / "My Drive"
                target = my_drive if my_drive.exists() else item
                email = item.name.replace("GoogleDrive-", "")
                locations.append({
                    "name": f"Google Drive ({email})",
                    "path": str(target.resolve()),
                    "account": email
                })

    candidates = [
        home / "Google Drive",
        home / "GoogleDrive",
        Path("/Volumes/GoogleDrive"),
        Path("/Volumes/Google Drive"),
    ]
    for p in candidates:
        if p.exists() and p.is_dir() and str(p.resolve()) not in [x["path"] for x in locations]:
            locations.append({
                "name": "Google Drive",
                "path": str(p.resolve()),
                "account": "Local / Volume"
            })
    return locations
