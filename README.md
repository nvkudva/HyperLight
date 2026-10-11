# Smart Personal Search

Smart Personal Search is a private, local-first multimodal personal search engine and AI assistant for macOS (Apple Silicon). It acts as a next-generation Spotlight and Siri replacement, allowing you to search and ask questions across your personal life—documents, code, photos, notes, calendar events, contacts, bookmarks, and installed applications—without compromising privacy.

---

## 🎯 Intent & Goals

- **100% Local & Private**: All file parsing, embeddings, vector searches, and LLM question answering occur strictly on-device. No personal data or document content is sent to third-party cloud AI providers.
- **Unified Multimodal Understanding**: A single shared semantic vector space enables cross-modal search—find photos using natural language concepts (e.g., *"receipt from dinner"* or *"sunset at the beach"*) and retrieve documents using conversational queries.
- **Local RAG & Synthesized Answers**: Generate accurate answers and summaries with source citations from your personal files using a local LLM (Gemma 2 via Ollama).
- **Zero-Wait & High-Throughput Indexing**: Instant live indexing (<15ms) via macOS kernel FSEvents, multi-core parallel file parsing, PyArrow zero-copy batch inserts, and Apple Silicon MPS hardware acceleration.
- **Native macOS Experience**: Fluid Apple Glass UI, Spotlight floating HUD with `⌘K` global shortcuts, and a native desktop container built on Tauri v2 with macOS window vibrancy.

---

## 🚀 What We Have Built Till Now (Summary)

### 1. Multimodal Embedding & Hybrid Search
- **Unified Vector Space**: Integrated OpenCLIP (`ViT-B-32`) with Apple Silicon MPS (Metal Performance Shaders) acceleration to embed text and images into the same 512-dimensional vector space.
- **Embedded Vector Database**: Configured serverless, embedded LanceDB for persistent vector storage.
- **Hybrid Retrieval**: Combined dense semantic vector similarity with lexical keyword matching (BM25/FTS) to ensure exact matches (names, extensions, IDs) and conceptual matches are ranked fairly.

### 2. Accelerated File Ingestion & Kernel Watcher
- **Multi-Format Parsers**: Extracted text, metadata, and visual features from PDFs, Word docs (`.docx`), plain text, markdown, source code files, photos (JPEG, PNG, HEIC, WebP), contacts (`.vcf`), calendars (`.ics`), and web bookmarks (`.webloc`).
- **Performance Optimizations**:
  - Iterative APFS directory crawling with cached direntries (avoiding extraneous `stat` system calls).
  - Multi-threaded file extraction across all CPU cores (`ThreadPoolExecutor`).
  - PyArrow zero-copy record batch writes directly into LanceDB.
  - Incremental `mtime` caching and directory pruning (`.git`, `node_modules`, `.venv`).
- **Live Background Watcher**: Integrated macOS kernel `FSEvents` using `watchdog` to index newly modified/created files in real time (<15ms) with 0.5s debouncing, and dynamically prune deleted records from the database.

### 3. Local LLM Q&A Engine (RAG)
- **Gemma 2 Integration**: Connected to local Ollama (`gemma2:2b`) for private question answering.
- **Context & Source Citations**: Formats retrieved document chunks and rich file metadata (file size, extension, modified timestamps) into structured context, returning answers with clickable source paths and visual evidence.

### 4. System & Cloud Connectors
- **Native macOS Connectors**: Ingests installed applications (`/Applications`, `/System/Applications`), Safari bookmarks, Apple Notes, Contacts, and Calendar events.
- **Mounted Volumes**: Auto-discovers external drives, SMB/NFS network shares, and local Google Drive CloudStorage mounts.
- **Google Drive & Google Photos Cloud Sync**: Full Google OAuth 2.0 integration with token refresh and REST API synchronization for users who store assets in Google Drive and Google Photos.

### 5. Multi-Surface User Interfaces
- **Command Line Interface (`cli.py`)**: Terminal commands for indexing directories, querying files, asking questions, and monitoring status.
- **Modern React 19 Frontend**: Componentized UI built with React 19, TypeScript, Vite, CSS Modules, and Tailwind CSS. Features an Apple Glass design aesthetic, chat workspace, photo lightbox, source manager, and toast alerts.
- **Spotlight Floating HUD**: Quick-access modal overlay (`⌘K`) with instant keystroke filtering across categories (Apps, Documents, Photos, Contacts, Calendar).
- **Native macOS Desktop App**: Packaged into a native macOS desktop application using Tauri v2 with `titleBarStyle: "Overlay"` and seamless window dragging.
- **Asynchronous Logging**: Non-blocking queue logger streaming system and search events to `~/.smart_personal_search/app.log`.

---

## 🛠️ Technologies Used

| Category | Technologies |
| :--- | :--- |
| **AI & Multimodal Embeddings** | [OpenCLIP](https://github.com/mlfoundations/open_clip) (`ViT-B-32`, LAION-2B), PyTorch (Apple Silicon MPS / Metal acceleration) |
| **Local LLM & Reasoning** | [Ollama](https://ollama.com/) running **Gemma 2** (`gemma2:2b`) |
| **Vector Storage** | [LanceDB](https://lancedb.github.io/lancedb/) (embedded serverless vector DB), [Apache Arrow / PyArrow](https://arrow.apache.org/) (zero-copy record batches) |
| **Backend & APIs** | Python 3.12, [FastAPI](https://fastapi.tiangolo.com/), Uvicorn, Pydantic |
| **File Extraction & System** | `pypdf`, `python-docx`, `Pillow`, `watchdog` (macOS `FSEvents`), `plistlib`, AppleScript |
| **Frontend UI** | [React 19](https://react.dev/), TypeScript, [Vite](https://vite.dev/), Tailwind CSS, CSS Modules |
| **Desktop Wrapper** | [Tauri v2](https://v2.tauri.app/) (Rust-backed macOS window shell with native glass vibrancy) |
| **Package Managers** | [Bun](https://bun.sh/) (frontend toolchain), Python `venv` |
| **Cloud Integrations** | Google OAuth 2.0, Google Drive REST API v3, Google Photos Library REST API v1 |

---

## ⚡ Quick Start

### 1. Prerequisites
- macOS on Apple Silicon (M1/M2/M3/M4 recommended)
- Python 3.12+
- [Ollama](https://ollama.com/) with Gemma 2 installed:
  ```bash
  ollama pull gemma2:2b
  ```
- [Bun](https://bun.sh/) (for frontend dependencies)

### 2. Setup
```bash
# Clone and enter directory
cd "Smart Personal Search"

# Setup Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r <(pip freeze) # or ensure packages from pyproject/requirements are installed

# Setup and build frontend
cd frontend
bun install
bun run build
cd ..
```

### 3. Usage
- **CLI Search & Ask**:
  ```bash
  python3 cli.py index ~/Documents
  python3 cli.py search "tax return 2024"
  python3 cli.py ask "What was my deductible on last year's insurance?"
  ```
- **Web App**:
  ```bash
  python3 web_app.py
  # Access UI at http://127.0.0.1:8585
  ```
- **Desktop Application (Tauri)**:
  ```bash
  cd frontend
  bun run tauri dev
  ```
