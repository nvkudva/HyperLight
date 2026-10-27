"""Gmail sync (metadata + snippet, thread-pooled fetch, batched embeds)."""
import html
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

import requests

import parsers
import scanner
from google_sync.common import api_error, require_token

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"


def sync_gmail(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_messages: int = 1000,  # shortcut: newest 1000 messages only, page through all before public release
) -> int:
    headers = require_token()
    ids: List[str] = []
    params: Dict[str, Any] = {"maxResults": 500, "q": "-in:spam -in:trash"}
    while len(ids) < max_messages:
        resp = requests.get(f"{GMAIL_API}/messages", headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            raise api_error(resp, "Gmail")
        data = resp.json()
        ids.extend(m["id"] for m in data.get("messages", []))
        if not data.get("nextPageToken"):
            break
        params["pageToken"] = data["nextPageToken"]
    ids = ids[:max_messages]

    session = requests.Session()
    session.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=8))

    def fetch(mid: str) -> Optional[Dict[str, Any]]:
        resp = session.get(
            f"{GMAIL_API}/messages/{mid}",
            headers=headers,
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "To", "Date"]},
            timeout=15,
        )
        return resp.json() if resp.status_code == 200 else None

    total = len(ids)
    records: List[Dict[str, Any]] = []
    pool = ThreadPoolExecutor(max_workers=8)
    try:
        for idx, msg in enumerate(pool.map(fetch, ids)):
            if cancel_check and cancel_check():
                break
            if not msg:
                continue
            hdrs = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            subject = hdrs.get("Subject", "(no subject)")
            if on_progress:
                on_progress(subject, idx + 1, total)
            records.append(parsers.email_record(
                record_id=f"gmail_{msg['id']}",
                source="gmail",
                path=f"https://mail.google.com/mail/u/0/#all/{msg['threadId']}",
                subject=subject,
                sender=hdrs.get("From", ""),
                to=hdrs.get("To", ""),
                date=hdrs.get("Date", ""),
                body=html.unescape(msg.get("snippet", "")),
                modified_at=int(msg.get("internalDate", "0")) / 1000.0,
            ))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    if cancel_check and cancel_check():  # a stopped sync must not write into an index that was just cleared
        return 0
    return scanner.embed_and_store(emb, store, records, "gmail")
