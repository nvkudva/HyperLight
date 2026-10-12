"""Google Drive file sync (metadata + batched text embeddings)."""
from typing import Any, Callable, Dict, List, Optional

import requests

from google_sync.common import api_error, require_token

EMBED_BATCH = 32


def sync_google_drive(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_files: int = 200,
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
    metas: List[Dict[str, Any]] = []
    for idx, f in enumerate(all_files):
        if cancel_check and cancel_check():
            break
        name = f.get("name", "Untitled")
        if on_progress:
            on_progress(name, idx + 1, total)
        fid = f.get("id")
        mime = f.get("mimeType", "")
        web_link = f.get("webViewLink") or f"https://drive.google.com/file/d/{fid}/view"
        metas.append({
            "id": f"gdrive_{fid}",
            "path": web_link,
            "filename": name,
            "type": "document",
            "source": "google_drive",
            "content": f"Google Drive File: {name}\nType: {mime}\nModified: {f.get('modifiedTime', '')}\nDescription: {f.get('description', '')}",
            "excerpt": f"Google Drive • {mime.split('.')[-1]} • {f.get('modifiedTime', '')[:10]}",
            "mime": mime,
            "modifiedTime": f.get("modifiedTime", ""),
            "googleId": fid,
            "url": web_link,
        })

    if cancel_check and cancel_check():
        return 0

    vectors = emb.embed_texts(
        [m["content"] for m in metas],
        titles=[m["filename"] for m in metas],
        batch_size=EMBED_BATCH,
    )
    batch_items: List[Dict[str, Any]] = []
    for meta, vec in zip(metas, vectors):
        batch_items.append({
            "id": meta["id"],
            "path": meta["path"],
            "filename": meta["filename"],
            "type": meta["type"],
            "source": meta["source"],
            "content": meta["content"],
            "excerpt": meta["excerpt"],
            "vector": vec,
            "metadata": {
                "url": meta["url"],
                "mimeType": meta["mime"],
                "modifiedTime": meta["modifiedTime"],
                "googleId": meta["googleId"],
            },
        })

    if batch_items:
        store.add_items(batch_items)
    return len(batch_items)
