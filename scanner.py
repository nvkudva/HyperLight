from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import os
from pathlib import Path
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple
import docx
import pypdf
import embedder
import storage

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json"}
CODE_EXTENSIONS = {".py", ".js", ".ts", ".swift", ".rs", ".go", ".sh", ".yaml", ".yml", ".html", ".css"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx"} | TEXT_EXTENSIONS | CODE_EXTENSIONS
CONTACT_EXTENSIONS = {".vcf"}
CALENDAR_EXTENSIONS = {".ics"}
BOOKMARK_EXTENSIONS = {".webloc", ".url"}
ALL_EXTENSIONS = IMAGE_EXTENSIONS | DOCUMENT_EXTENSIONS | CONTACT_EXTENSIONS | CALENDAR_EXTENSIONS | BOOKMARK_EXTENSIONS

IGNORED_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".cache",
    "build", "dist", ".Trash", ".idea", ".vscode", "Library", ".npm",
}

def collect_supported_files(target_path: Path) -> List[Tuple[Path, float, int]]:
    if target_path.is_file():
        st = target_path.stat()
        return [(target_path, st.st_mtime, st.st_size)]
    files: List[Tuple[Path, float, int]] = []
    stack = [str(target_path)]
    while stack:
        curr = stack.pop()
        try:
            with os.scandir(curr) as it:
                for entry in it:
                    name = entry.name
                    if name.startswith("."):
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        if name.endswith(".app") or name in IGNORED_DIRS:
                            continue
                        stack.append(entry.path)
                    elif entry.is_file(follow_symlinks=False):
                        dot = name.rfind(".")
                        if dot != -1 and name[dot:].lower() in ALL_EXTENSIONS:
                            try:
                                st = entry.stat(follow_symlinks=False)
                                files.append((Path(entry.path), st.st_mtime, st.st_size))
                            except Exception:
                                pass
        except (PermissionError, FileNotFoundError):
            continue
    return files

def format_size(bytes_val: int) -> str:
    if bytes_val < 1024:
        return f"{bytes_val} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    elif bytes_val < 1024 * 1024 * 1024:
        return f"{bytes_val / (1024 * 1024):.1f} MB"
    return f"{bytes_val / (1024 * 1024 * 1024):.1f} GB"

def get_file_metadata(path: Path, size_bytes: Optional[int] = None, modified_ts: Optional[float] = None) -> Dict[str, Any]:
    if size_bytes is None or modified_ts is None:
        stat = path.stat()
        size_bytes = stat.st_size
        modified_ts = stat.st_mtime
        created_ts = getattr(stat, "st_birthtime", stat.st_ctime)
    else:
        created_ts = modified_ts
    size_human = format_size(size_bytes)
    created_str = datetime.datetime.fromtimestamp(created_ts).strftime("%Y-%m-%d %H:%M:%S")
    modified_str = datetime.datetime.fromtimestamp(modified_ts).strftime("%Y-%m-%d %H:%M:%S")
    ext = path.suffix.lower().lstrip(".")
    return {
        "file_type": ext,
        "size_bytes": size_bytes,
        "size_human": size_human,
        "created_at": created_ts,
        "created_str": created_str,
        "modified_at": modified_ts,
        "modified_str": modified_str,
    }

class Scanner:
    def __init__(self, emb: embedder.Embedder, store: storage.Storage):
        self.embedder = emb
        self.storage = store

    def parse_pdf(self, path: Path) -> List[Dict[str, Any]]:
        chunks = []
        try:
            file_meta = get_file_metadata(path)
            reader = pypdf.PdfReader(str(path))
            for page_num, page in enumerate(reader.pages):
                text = page.extract_text() or ""
                text = text.strip()
                if not text:
                    continue
                page_chunks = self.chunk_text(text, chunk_size=800, overlap=100)
                for chunk_idx, chunk in enumerate(page_chunks):
                    chunk_id = hashlib.sha256(f"{path}:{page_num}:{chunk_idx}".encode()).hexdigest()[:16]
                    chunk_meta = dict(file_meta)
                    chunk_meta.update({"page": page_num + 1, "chunk_index": chunk_idx})
                    chunks.append({
                        "id": chunk_id,
                        "type": "document",
                        "path": str(path.resolve()),
                        "filename": path.name,
                        "content": chunk,
                        "modified_at": file_meta["modified_at"],
                        "metadata": chunk_meta,
                    })
        except Exception:
            return []
        return chunks

    def parse_docx(self, path: Path) -> List[Dict[str, Any]]:
        chunks = []
        try:
            file_meta = get_file_metadata(path)
            doc = docx.Document(str(path))
            full_text = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
            if not full_text:
                return []
            text_chunks = self.chunk_text(full_text, chunk_size=800, overlap=100)
            for chunk_idx, chunk in enumerate(text_chunks):
                chunk_id = hashlib.sha256(f"{path}:docx:{chunk_idx}".encode()).hexdigest()[:16]
                chunk_meta = dict(file_meta)
                chunk_meta.update({"chunk_index": chunk_idx})
                chunks.append({
                    "id": chunk_id,
                    "type": "document",
                    "path": str(path.resolve()),
                    "filename": path.name,
                    "content": chunk,
                    "modified_at": file_meta["modified_at"],
                    "metadata": chunk_meta,
                })
        except Exception:
            return []
        return chunks

    def parse_text_file(self, path: Path) -> List[Dict[str, Any]]:
        chunks = []
        try:
            file_meta = get_file_metadata(path)
            if file_meta["size_bytes"] > 2 * 1024 * 1024:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read(500 * 1024).strip()
            else:
                content = path.read_text(encoding="utf-8", errors="ignore").strip()
            if not content:
                return []
            text_chunks = self.chunk_text(content, chunk_size=800, overlap=100)
            for chunk_idx, chunk in enumerate(text_chunks):
                chunk_id = hashlib.sha256(f"{path}:txt:{chunk_idx}".encode()).hexdigest()[:16]
                chunk_meta = dict(file_meta)
                chunk_meta.update({"chunk_index": chunk_idx})
                chunks.append({
                    "id": chunk_id,
                    "type": "document",
                    "path": str(path.resolve()),
                    "filename": path.name,
                    "content": chunk,
                    "modified_at": file_meta["modified_at"],
                    "metadata": chunk_meta,
                })
        except Exception:
            return []
        return chunks

    def parse_image(self, path: Path) -> Optional[Dict[str, Any]]:
        vec = self.embedder.embed_image(path)
        if vec is None:
            return None
        file_meta = get_file_metadata(path)
        image_id = hashlib.sha256(f"img:{path}".encode()).hexdigest()[:16]
        desc = f"Photo: {path.name} | Type: {file_meta['file_type']} | Size: {file_meta['size_human']} | Added/Modified: {file_meta['modified_str']}"
        return {
            "id": image_id,
            "vector": vec,
            "type": "photo",
            "path": str(path.resolve()),
            "filename": path.name,
            "content": desc,
            "modified_at": file_meta["modified_at"],
            "metadata": file_meta,
        }

    def parse_vcf(self, path: Path) -> List[Dict[str, Any]]:
        records = []
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
            file_meta = get_file_metadata(path)
            lines = content.splitlines()
            current_contact: Dict[str, str] = {}
            for line in lines:
                line = line.strip()
                if line.startswith("BEGIN:VCARD"):
                    current_contact = {}
                elif line.startswith("FN:"):
                    current_contact["name"] = line[3:].strip()
                elif line.startswith("TEL"):
                    current_contact["phone"] = line.split(":", 1)[-1].strip()
                elif line.startswith("EMAIL"):
                    current_contact["email"] = line.split(":", 1)[-1].strip()
                elif line.startswith("ORG:"):
                    current_contact["org"] = line[4:].strip()
                elif line.startswith("TITLE:"):
                    current_contact["title"] = line[6:].strip()
                elif line.startswith("NOTE:"):
                    current_contact["note"] = line[5:].strip()
                elif line.startswith("END:VCARD"):
                    if current_contact.get("name"):
                        contact_str = f"Contact: {current_contact['name']}"
                        if current_contact.get("org"):
                            contact_str += f" | Org: {current_contact['org']}"
                        if current_contact.get("title"):
                            contact_str += f" | Title: {current_contact['title']}"
                        if current_contact.get("phone"):
                            contact_str += f" | Phone: {current_contact['phone']}"
                        if current_contact.get("email"):
                            contact_str += f" | Email: {current_contact['email']}"
                        if current_contact.get("note"):
                            contact_str += f" | Note: {current_contact['note']}"
                        cid = hashlib.sha256(f"vcf:{path}:{current_contact['name']}".encode()).hexdigest()[:16]
                        cmeta = dict(file_meta)
                        cmeta.update(current_contact)
                        records.append({
                            "id": cid,
                            "type": "contact",
                            "path": str(path.resolve()),
                            "filename": path.name,
                            "content": contact_str,
                            "modified_at": file_meta["modified_at"],
                            "metadata": cmeta,
                        })
        except Exception:
            return []
        return records

    def parse_ics(self, path: Path) -> List[Dict[str, Any]]:
        records = []
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
            file_meta = get_file_metadata(path)
            lines = content.splitlines()
            current_event: Dict[str, str] = {}
            for line in lines:
                line = line.strip()
                if line.startswith("BEGIN:VEVENT"):
                    current_event = {}
                elif line.startswith("SUMMARY:"):
                    current_event["summary"] = line[8:].strip()
                elif line.startswith("DTSTART"):
                    current_event["start"] = line.split(":", 1)[-1].strip()
                elif line.startswith("DTEND"):
                    current_event["end"] = line.split(":", 1)[-1].strip()
                elif line.startswith("LOCATION:"):
                    current_event["location"] = line[9:].strip()
                elif line.startswith("DESCRIPTION:"):
                    current_event["description"] = line[12:].strip()
                elif line.startswith("END:VEVENT"):
                    if current_event.get("summary"):
                        event_str = f"Calendar Event: {current_event['summary']}"
                        if current_event.get("start"):
                            event_str += f" | Start: {current_event['start']}"
                        if current_event.get("end"):
                            event_str += f" | End: {current_event['end']}"
                        if current_event.get("location"):
                            event_str += f" | Location: {current_event['location']}"
                        if current_event.get("description"):
                            event_str += f" | Details: {current_event['description']}"
                        eid = hashlib.sha256(f"ics:{path}:{current_event['summary']}".encode()).hexdigest()[:16]
                        emeta = dict(file_meta)
                        emeta.update(current_event)
                        records.append({
                            "id": eid,
                            "type": "calendar",
                            "path": str(path.resolve()),
                            "filename": path.name,
                            "content": event_str,
                            "modified_at": file_meta["modified_at"],
                            "metadata": emeta,
                        })
        except Exception:
            return []
        return records

    def parse_bookmark(self, path: Path) -> List[Dict[str, Any]]:
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
            file_meta = get_file_metadata(path)
            url = ""
            for line in content.splitlines():
                if "URL=" in line:
                    url = line.split("URL=", 1)[-1].strip()
                    break
                elif "<string>http" in line:
                    url = line.replace("<string>", "").replace("</string>", "").strip()
                    break
            b_str = f"Web Bookmark: {path.stem} | URL: {url}"
            bid = hashlib.sha256(f"bm:{path}".encode()).hexdigest()[:16]
            bmeta = dict(file_meta)
            bmeta["url"] = url
            return [{
                "id": bid,
                "type": "bookmark",
                "path": str(path.resolve()),
                "filename": path.name,
                "content": b_str,
                "modified_at": file_meta["modified_at"],
                "metadata": bmeta,
            }]
        except Exception:
            return []

    def chunk_text(self, text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
        if len(text) <= chunk_size:
            return [text]
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunks.append(text[start:end])
            start += chunk_size - overlap
        return chunks

    def scan_path(
        self,
        target_path: Path,
        source: str = "local",
        on_progress: Optional[Callable[[str, int, int], None]] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> int:
        if not target_path.exists():
            return 0

        files_to_process = collect_supported_files(target_path)
        total_files = len(files_to_process)
        if total_files == 0:
            return 0

        indexed_mtimes = self.storage.get_indexed_file_mtimes()
        indexed_items = 0

        doc_buffer: List[Dict[str, Any]] = []
        image_buffer: List[Path] = []
        BATCH_SIZE = 64
        IMG_BATCH_SIZE = 16

        def flush_docs():
            nonlocal indexed_items, doc_buffer
            if not doc_buffer:
                return
            texts = [r["content"] for r in doc_buffer]
            vectors = self.embedder.embed_texts(texts, batch_size=BATCH_SIZE)
            for r, vec in zip(doc_buffer, vectors):
                r["vector"] = vec
                r["source"] = source
            indexed_items += self.storage.add_items(doc_buffer)
            doc_buffer = []

        def flush_images():
            nonlocal indexed_items, image_buffer
            if not image_buffer:
                return
            vectors = self.embedder.embed_images(image_buffer, batch_size=IMG_BATCH_SIZE)
            records = []
            for img_path, vec in zip(image_buffer, vectors):
                if vec is None:
                    continue
                file_meta = get_file_metadata(img_path)
                image_id = hashlib.sha256(f"img:{img_path}".encode()).hexdigest()[:16]
                desc = f"Photo: {img_path.name} | Type: {file_meta['file_type']} | Size: {file_meta['size_human']} | Added/Modified: {file_meta['modified_str']}"
                records.append({
                    "id": image_id,
                    "vector": vec,
                    "type": "photo",
                    "path": str(img_path.resolve()),
                    "filename": img_path.name,
                    "content": desc,
                    "source": source,
                    "modified_at": file_meta["modified_at"],
                    "metadata": file_meta,
                })
            if records:
                indexed_items += self.storage.add_items(records)
            image_buffer = []

        workers = min(8, os.cpu_count() or 4)
        CHUNK_SIZE = 64

        for chunk_start in range(0, total_files, CHUNK_SIZE):
            if cancel_check and cancel_check():
                break

            chunk_files = files_to_process[chunk_start : chunk_start + CHUNK_SIZE]
            files_to_parse = []
            for file_path, st_mtime, st_size in chunk_files:
                try:
                    resolved_str = str(file_path.resolve())
                    if resolved_str in indexed_mtimes and abs(indexed_mtimes[resolved_str] - st_mtime) < 0.01:
                        continue
                except Exception:
                    pass
                files_to_parse.append(file_path)

            if files_to_parse:
                with ThreadPoolExecutor(max_workers=workers) as executor:
                    parsed_results = list(executor.map(self._parse_file, files_to_parse))

                for kind, fp, chunks in parsed_results:
                    if kind == "image":
                        image_buffer.append(fp)
                        if len(image_buffer) >= IMG_BATCH_SIZE:
                            flush_images()
                    elif kind == "doc" and chunks:
                        doc_buffer.extend(chunks)
                        if len(doc_buffer) >= BATCH_SIZE:
                            flush_docs()

            if on_progress:
                last_file = chunk_files[-1][0]
                processed_so_far = min(chunk_start + CHUNK_SIZE, total_files)
                on_progress(last_file.name, processed_so_far, total_files)

        flush_docs()
        flush_images()

        return indexed_items

    def _parse_file(self, file_path: Path) -> Tuple[str, Path, List[Dict[str, Any]]]:
        ext = file_path.suffix.lower()
        if ext in IMAGE_EXTENSIONS:
            return ("image", file_path, [])
        elif ext == ".pdf":
            return ("doc", file_path, self.parse_pdf(file_path))
        elif ext == ".docx":
            return ("doc", file_path, self.parse_docx(file_path))
        elif ext in CONTACT_EXTENSIONS:
            return ("doc", file_path, self.parse_vcf(file_path))
        elif ext in CALENDAR_EXTENSIONS:
            return ("doc", file_path, self.parse_ics(file_path))
        elif ext in BOOKMARK_EXTENSIONS:
            return ("doc", file_path, self.parse_bookmark(file_path))
        elif ext in TEXT_EXTENSIONS or ext in CODE_EXTENSIONS:
            return ("doc", file_path, self.parse_text_file(file_path))
        return ("unknown", file_path, [])

    def _embed_and_store_docs(self, doc_records: List[Dict[str, Any]], source: str) -> int:
        if not doc_records:
            return 0
        texts = [r["content"] for r in doc_records]
        vectors = self.embedder.embed_texts(texts)
        for r, vec in zip(doc_records, vectors):
            r["vector"] = vec
            r["source"] = source
        return self.storage.add_items(doc_records)
