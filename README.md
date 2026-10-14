<p align="center">
  <img src="assets/hyperlight_banner.png" alt="Hyperlight" width="720">
</p>

# Hyperlight

Private, on-device search for your Mac. Find photos, documents, code, mail and apps by describing them. Nothing leaves your machine.

Hyperlight is a Spotlight replacement for Apple Silicon. It lives in the menu bar, opens with a double-tap of Control, and understands both text and images in one search.

---

## Highlights

### Search that understands meaning
- **One search for everything.** Documents, code, photos, contacts, calendar events, bookmarks, mail and apps share a single semantic index. Type *"receipt from dinner"* or *"sunset at the beach"* and get the right photos and files.
- **More photo matches.** Photos are ranked in their own pool, so text hits never crowd them out. Up to 30 photo results show per search, 12 at first, with a "Show more" button.
- **Best match first.** Results are ranked by semantic match plus filename and keyword hits, grouped by type.
- **Ask questions.** A local LLM (Gemma 2 through Ollama) answers questions about your files and cites its sources.

### Speak your search
- **Voice search.** Press the hotkey, talk, and results update while you speak. A local Whisper model transcribes your voice.
- **Noise-proof.** If the mic hears no voice, nothing is searched and nothing shows.
- **Esc to restart.** Esc clears the current search and keeps the mic recording, so your next sentence starts a new search. Press Esc twice to stop the mic and drop the voice search.

### Rich previews
- **Quick Look previews** for PDF, Word, PowerPoint, Excel, Keynote, Pages, Numbers, RTF and images.
- **Formatted text previews.** Markdown renders with headings and lists. JSON is pretty-printed. CSV shows as a table. Code and logs show in monospace.

### Native Mac experience
- **Menu bar app.** No Dock icon. Open, Voice Search, History, Settings, Open at Login, Restart and Quit are one click away.
- **Global hotkey.** Double-tap Control, or record your own shortcut. Hyperlight checks the Input Monitoring permission and helps you grant it: a small window sits under System Settings, and you drag the app into the list.
- **Frameless glass window** with hide-on-close and macOS vibrancy. Built on Tauri 2 and React 19.

### Sources
- **Local folders** and network volumes, indexed in parallel with incremental rescans.
- **Live scanning.** macOS FSEvents index new and changed files within moments and remove deleted ones. One master switch turns it on or off, and each source has its own switch.
- **Google Drive** through Drive for desktop, with an on/off switch.
- **Apple Mail**, with an on/off switch. Hyperlight asks for Full Disk Access when it needs it.
- **Sign in with Google** for Photos, Drive and Gmail is coming soon.

### Private by design
- Embeddings, vector search, speech recognition and question answering all run on your Mac.
- No file content goes to a cloud AI service.

---

## Under the hood

| Layer | Technology |
| :--- | :--- |
| Embeddings | EmbeddingGemma through `sentence-transformers`, with PyTorch on Apple Silicon (MPS) |
| Vector store | [LanceDB](https://lancedb.github.io/lancedb/) with Apache Arrow batch writes |
| Speech | [OpenAI Whisper](https://github.com/openai/whisper) (`base`), run locally |
| Question answering | [Ollama](https://ollama.com/) running `gemma2:2b` |
| Backend | Python 3.12, FastAPI, Uvicorn, `watchdog` (FSEvents) |
| Desktop shell | [Tauri 2](https://v2.tauri.app/) (Rust) with tray, global hotkey and autostart |
| Frontend | React 19, TypeScript, Vite, CSS Modules, Tailwind CSS |

---

## Get started

### Prerequisites
- macOS on Apple Silicon
- Python 3.12 or later
- [Bun](https://bun.sh/) and [Rust](https://rustup.rs/)
- [Ollama](https://ollama.com/), then `ollama pull gemma2:2b`

### Set up
```bash
python3 -m venv .venv
source .venv/bin/activate
uv pip install fastapi uvicorn lancedb pyarrow sentence-transformers torch openai-whisper watchdog pillow pypdf python-docx

cd frontend
bun install
bun run build
cd ..
```

### Run the desktop app
```bash
./dev-app.sh
```
This starts the backend on port 8585, builds the Tauri shell, signs it and opens one window. Do not run `tauri dev` at the same time.

### Run the web app
```bash
python3 web_app.py
# open http://127.0.0.1:8585
```

### Use the command line
```bash
python3 cli.py index ~/Documents
python3 cli.py search "tax return 2024"
python3 cli.py ask "What was my deductible on last year's insurance?"
python3 cli.py status
```

---

## Keyboard

| Key | Action |
| :--- | :--- |
| Double-tap Control | Show Hyperlight |
| Double-tap Control, then speak | Voice search |
| ↑ / ↓ | Move through results |
| Return | Open the selected result |
| ⌘R | Reveal in Finder |
| ⌘K | Focus search |
| ⌘, | Open or close Settings |
| Esc | Clear the search. The mic keeps recording. |
| Esc Esc | Stop the mic and cancel the voice search |

---

## Releases

Pushing a tag such as `v0.1.0-beta.2` builds the Tauri app on GitHub Actions and publishes a prerelease. Beta builds are unsigned and still need the repository and `.venv` for the backend. Bundling the backend is on the [TODO](TODO.md) list.

## Project notes

- [PLAN.md](PLAN.md) holds the architecture and decisions.
- [TODO.md](TODO.md) holds open work.
