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
    vectors = emb.embed_texts(texts, titles=titles, batch_size=8)
    for app_item, vec in zip(apps, vectors):
        app_item["vector"] = vec
        app_item["source"] = "macos_system"
    return store.add_items(apps)

# (display name, pane id in x-apple.systempreferences: URL, search keywords)
SETTINGS_CATALOG = [
    ("General", "com.apple.preference.general", "appearance dark mode light mode accent color scroll bars"),
    ("Accessibility", "com.apple.preference.universalaccess", "voiceover zoom display captions assistivetouch pointer vision hearing"),
    ("Apple ID", "com.apple.systempreferences.AppleIDSettings", "icloud account sign in family sharing payment subscriptions"),
    ("Apple Intelligence & Siri", "com.apple.Siri-Settings.extension", "siri voice assistant hey siri apple intelligence dictation"),
    ("Battery", "com.apple.preference.battery", "power energy saver charge low power mode optimized charging"),
    ("Bluetooth", "com.apple.preference.bluetooth", "pair wireless airpods headphones keyboard mouse devices"),
    ("Control Center", "com.apple.ControlCenter-Settings.extension", "menu bar toggles wifi bluetooth airdrop shortcuts"),
    ("Date & Time", "com.apple.preference.datetime", "clock time zone automatic date 24 hour"),
    ("Desktop & Dock", "com.apple.preference.dock", "dock magnification mission control wallpaper stage manager hot corners"),
    ("Displays", "com.apple.preference.displays", "monitor brightness resolution night shift arrangement retina"),
    ("Focus", "com.apple.Focus-Settings.extension", "do not disturb notifications silence sleep work focus modes"),
    ("Internet Accounts", "com.apple.Internet-Accounts-Settings.extension", "mail contacts calendar accounts google icloud exchange sign in"),
    ("Keyboard", "com.apple.preference.keyboard", "shortcuts dictation function keys repeat input sources text replacement"),
    ("Lock Screen", "com.apple.Lock-Screen-Settings.extension", "screen saver password lock timeout turn display off"),
    ("Mouse", "com.apple.preference.mouse", "tracking speed scroll direction right click pointer"),
    ("Network", "com.apple.preference.network", "wifi ethernet vpn dns proxy firewall connection internet"),
    ("Notifications", "com.apple.preference.notifications", "alerts badges banners app notifications sounds preview"),
    ("Passwords", "com.apple.Passwords-Settings.extension", "keychain saved passwords passkeys autofill verification codes"),
    ("Printers & Scanners", "com.apple.preference.printandscan", "print scan printer scanner fax default printer"),
    ("Privacy & Security", "com.apple.preference.security", "permissions full disk access camera microphone location tracking gatekeeper filevault privacy"),
    ("Screen Time", "com.apple.ScreenTime-Settings.extension", "limits downtime app limits parental controls usage report"),
    ("Sharing", "com.apple.preference.sharing", "file sharing screen sharing airdrop remote login media sharing"),
    ("Software Update", "com.apple.preferences.softwareupdate", "macos update upgrade download install automatic updates"),
    ("Sound", "com.apple.preference.sound", "volume output input speakers headphones alert sound microphone"),
    ("Spotlight", "com.apple.preference.spotlight", "search indexing privacy categories results"),
    ("Startup Disk", "com.apple.preference.startupdisk", "boot disk restart startup volume operating system"),
    ("Time Machine", "com.apple.preference.timemachine", "backup restore external disk automatic backups"),
    ("Touch ID & Password", "com.apple.TouchID-Password-Settings.extension", "fingerprint touch id password unlock apple watch unlock"),
    ("Trackpad", "com.apple.preference.trackpad", "gestures scroll tap click force touch pointer"),
    ("Users & Groups", "com.apple.preferences.users", "login password admin user account guest login items"),
    ("Wallet & Apple Pay", "com.apple.preference.wallet", "apple pay cards wallet payment touch id purchases"),
    ("Wi-Fi", "com.apple.wifi-settings-extension", "wifi wireless network hotspot connect internet connection"),
]

def get_system_settings() -> List[Dict[str, Any]]:
    settings = []
    for name, pane_id, keywords in SETTINGS_CATALOG:
        url = f"x-apple.systempreferences:{pane_id}"
        settings.append({
            "id": hashlib.sha256(f"setting:{url}".encode()).hexdigest()[:16],
            "type": "setting",
            "path": url,
            "filename": name,
            "content": f"Setting: {name} | {keywords}",
            "modified_at": 0.0,
            "metadata": {
                "name": name,
                "pane_id": pane_id,
                "file_type": "setting",
                "size_human": "System Setting",
            },
        })
    return settings

def index_system_settings(emb: embedder.Embedder, store: storage.Storage) -> int:
    settings = get_system_settings()
    texts = [s["content"] for s in settings]
    titles = [s["filename"] for s in settings]
    vectors = emb.embed_texts(texts, titles=titles, batch_size=8)
    for setting_item, vec in zip(settings, vectors):
        setting_item["vector"] = vec
        setting_item["source"] = "macos_system"
    return store.add_items(settings)

def launch_target(target_path: str) -> bool:
    if target_path.startswith("-"):  # would be parsed as an `open` flag
        return False
    try:
        subprocess.run(["open", target_path], check=True, timeout=5)
        return True
    except Exception:
        return False

def reveal_in_finder(target_path: str) -> bool:
    if target_path.startswith("-"):
        return False
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

def get_icloud_drive_locations(home: Optional[Path] = None) -> List[Dict[str, str]]:
    cloud_docs = (home or Path.home()) / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
    if cloud_docs.is_dir():
        return [{"name": "iCloud Drive", "path": str(cloud_docs.resolve()), "account": "iCloud"}]
    return []

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
