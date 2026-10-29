"""Google Drive file sync (metadata + batched text embeddings)."""
from typing import Any, Callable, Dict, List, Optional

import requests

import scanner
from google_sync.common import api_error, require_token


def sync_google_drive(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_files: int = 200,  # shortcut: first 200 files only, page through all before public release
) -> int:
    headers = require_token()
    files_url = "https://www.googleapis.com/drive/v3/files"
    params = {
        "pageSize": min(max_files, 100),
        "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,description)",
        "q": "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
    }

    all_files: List[Dict[str, Any]] = []
    page_token = None

    while len(all_files) < max_files:
        if cancel_check and cancel_check():
            break
        if page_token:
            params["pageToken"] = page_token
        resp = requests.get(files_url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            err = api_error(resp, "Google Drive")
            if not all_files:
                raise err
            break
        data = resp.json()
        items = data.get("files", [])
        all_files.extend(items)
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    if not all_files:
        return 0

    total = len(all_files)
    records: List[Dict[str, Any]] = []
    for idx, f in enumerate(all_files):
        if cancel_check and cancel_check():
            return 0
        name = f.get("name", "Untitled")
        if on_progress:
            on_progress(name, idx + 1, total)
        fid = f.get("id")
        mime = f.get("mimeType", "")
        modified = f.get("modifiedTime", "")
        records.append({
            "id": f"gdrive_{fid}",
            # One stable address that opens Docs and Sheets too, so removal finds every Drive row by its prefix.
            "path": f"https://drive.google.com/file/d/{fid}/view",
            "filename": name,
            "type": "document",
            "content": f"Google Drive File: {name}\nType: {mime}\nModified: {modified}\nDescription: {f.get('description', '')}",
            "metadata": {
                "url": f.get("webViewLink") or f"https://drive.google.com/file/d/{fid}/view",
                "mimeType": mime,
                "modifiedTime": modified,
                "googleId": fid,
            },
        })

    if cancel_check and cancel_check():
        return 0
    return scanner.embed_and_store(emb, store, records, "google_drive")
