# Hyperlight audit — 2026-10-27

**What this repo does:** Hyperlight is a Spotlight replacement for Apple Silicon Macs. A Tauri app opens a window and starts a local Python server (FastAPI on 127.0.0.1:8585). The server indexes files, mail, apps and settings into a LanceDB vector store (a database that finds items by meaning) using one local embedding model, and returns search results grouped by kind, from typed or spoken queries.

**Load I assumed:** one person on one Mac. Several threads write at once, though: the folder watcher, one index job, a live search on every keystroke, and voice search. Index size is the user's own: 32,104 rows, measured on this machine.

**Test state:** `pytest` runs 106 tests and all pass (28 s). Coverage of the risky paths is good: the request guard, file access checks, rescan, source removal and storage path filters all have tests.

---

## Must fix

1. **The index on disk is 10× bigger than its data and keeps growing** (`storage.py:L111`, `storage.py:L222`; no `optimize()` anywhere)
   - **What this is:** Every `table.add` and `table.delete` in LanceDB writes a new small data file and a new "version" (a saved snapshot of the table). LanceDB only merges files and drops old versions when you call `table.optimize()`.
   - **Problem:** Nothing ever calls it. On this Mac today the index holds 141 MB of real data but takes **1.4 GB** on disk. It has **14,644 versions** and **1,290 data files** with a median of 6 rows each. Every live-watcher edit and every 16-chunk batch adds another file. Each search, and each `has_path` check behind every thumbnail, has to open all of them.
   - **Fix:** Call `self.table.optimize()` under the storage lock once at the end of each index job (the `finally` block in `jobs.py` `_worker`) and once at startup. This is one short `Storage.compact()` method plus two calls. The default keeps 7 days of versions. To reclaim the 1.3 GB now, run it once with `cleanup_older_than=datetime.timedelta(0)`.
   - **If we skip it:** Disk use keeps climbing, and search gets slower with every file the user edits.

2. **Stop, Reset and Remove can be undone by a scan that is still running** (`jobs.py:L175`, `jobs.py:L217`, `google_sync/gmail.py:L75`)
   - **What this is:** Clear, Reset all and Remove source first stop the running job, wait for it, then wipe rows and config.
   - **Problem:** `wait_until_idle` gives up silently after 30 s, and the wipe goes ahead anyway. The job can then still write in two ways. It can write rows into the freshly cleared table. And its last step, `record_scan`, runs even when the job was cancelled, so it adds the source back to the config. Here is a concrete case. A Gmail sync is running and the user clicks Reset all. The fetch loop stops, but `sync_gmail` still embeds every message it already fetched, which is about 40 s for 1,000 messages. After the reset, Gmail rows and the "Gmail" source come back. A folder scan can do the same: cancel is only checked every 64 files, and a chunk of large scanned PDFs takes minutes.
   - **Fix:** (a) In `_worker`, skip the second `record_scan` when `cancel_requested` is set. (b) In `sync_gmail`, return 0 before `embed_and_store` when cancel is set, as Drive already does. (c) Have `wait_until_idle` return whether the job ended, and make the routes answer 409 ("still stopping") instead of wiping. Add one test: a fake runner that keeps running past the wait, then Remove, then check the source stays gone.
   - **If we skip it:** A user who resets or removes a source sees it come back, with its data, a minute later.

3. **Removing a source leaves some of its items searchable forever** (`google_sync/drive.py:L60`, `connectors.py:L13`)
   - **What this is:** Runner sources (Drive, Apps, Settings…) are removed and rescanned by deleting every row whose path starts with the runner's fixed path (`https://drive.google.com`, `/Applications`).
   - **Problem:** Some of their rows live under other paths. Google Docs, Sheets and Slides get `webViewLink` paths like `https://docs.google.com/document/d/…`. The Applications runner also indexes `/System/Applications` (Calculator, Notes, Maps…). If you remove "Application", Calculator still shows up and still opens. If you remove Google Drive, every Google Doc stays. These rows are also never refreshed on rescan, because their ids already exist, and they are left out of the source's item count.
   - **Fix:** Drive: always store `https://drive.google.com/file/d/{fid}/view` as `path` (it opens Docs too) and keep `webViewLink` in metadata. Apps: delete runner rows by type (`type = 'app'`) instead of by path prefix. Give `Runner` an optional `where` string that removal and rescan use.
   - **If we skip it:** "Remove" does not remove, and removed items stay openable through `/api/launch`.

## Should fix

4. **The watcher indexes hidden folders that a full scan skips** (`watcher.py:L39`, `scanner.py:L35`)
   - **What this is:** A full scan skips every folder whose name starts with `.`. The live watcher only skips hidden *file names* and the named folders in `IGNORED_DIRS`.
   - **Problem:** One rule, applied two ways. Verified: the watcher accepts `proj/.github/workflows/ci.yml`, and a scan of `proj` returns nothing. An Obsidian vault in a watched folder rewrites `.obsidian/workspace.json` on every pane change, so it gets re-embedded again and again. A rescan never removes it either, because the file still exists.
   - **Fix:** Move the dot check into `scanner.is_ignored_dir` (`name.startswith(".") or …`). Delete it from `collect_supported_files`, and delete `.git`, `.venv`, `.cache`, `.idea`, `.vscode`, `.npm`, `.Trash` from `IGNORED_DIRS`, since the dot rule now covers them. The watcher picks up the rule for free.
   - **If we skip it:** Search shows config junk, and the model does extra work in the background.

5. **One failed delete stops live scanning until restart** (`watcher.py:L56-60`)
   - **What this is:** Deleted and moved file events call the index callback directly, on watchdog's observer thread.
   - **Problem:** Watchdog's `BaseObserver.run` only catches `queue.Empty` (checked in the installed version). Any other exception ends the thread. If a LanceDB delete raises (disk full, a corrupt data file), live scanning silently stops for every folder. Modified events are already wrapped in `_notify_modified` for this exact reason. Deletes are not.
   - **Fix:** In `_deleted`, call `self._notify_modified`'s try/except too. Rename it `_notify(path, kind)` and use it for both.
   - **If we skip it:** Files stop updating in search, with no error anywhere but the log.

6. **A rescan prune does one delete per missing file** (`jobs.py:L61-64`)
   - **What this is:** After a rescan, rows for files that no longer exist are removed.
   - **Problem:** Each missing file costs one search plus one delete, so two commits per file (see finding 1). If the user deletes a 5,000-file folder and rescans, that is 10,000 commits and minutes of waiting.
   - **Fix:** Collect the missing paths and delete them in one step. `store.add_items([], replace_paths=missing)` already does this, under the lock and with the id cache kept in sync. Chunk the list at about 500 paths. Net effect: the loop shrinks.
   - **If we skip it:** Rescans after big cleanups are slow, and they bloat the index further.

7. **A failed read of indexed files is treated as "nothing indexed"** (`storage.py:L172-185`)
   - **What this is:** `get_indexed_file_mtimes` tells a scan which files are already indexed, and when they last changed.
   - **Problem:** It catches every exception and returns `{}`. If one read fails, the scan re-parses and re-embeds the whole folder, which can take hours. The rescan prune also deletes nothing. Edited files also keep their old content, because their chunk ids already exist and get skipped. This becomes likelier once finding 1 adds compaction alongside reads.
   - **Fix:** Delete the `try/except` (3 lines). The job then fails with a visible "Error during indexing" status, and the user can retry.
   - **If we skip it:** A short glitch turns into a silent hours-long re-index with stale results.

8. **The home folder can't be added once Apple Mail is a source** (`routes/sources.py:L188-196`)
   - **What this is:** Adding a folder is refused with 409 when it overlaps an existing source.
   - **Problem:** `~/Library/Mail` sits under `~`, so adding `~` reports "overlaps Apple Mail". A folder scan skips `Library` anyway (`IGNORED_DIRS`), so there is no real overlap.
   - **Fix:** Count it as an overlap only when no folder between the two paths is ignored. Check `scanner.is_ignored_dir` on the parts of `existing.relative_to(target)`.
   - **If we skip it:** Users who index Mail can't index their home folder.

9. **The relevance gate has no test** (`ranking.py:L15`, `ranking.py:L35`)
   - **What this is:** `rank()` decides which hits are shown at all: the floors per modality, the word-match bypass, `boost_only` for voice, and the separate photo budget. Every text and voice search goes through it.
   - **Problem:** Nothing tests it. `test_spotlight.py` only covers grouping after ranking. A change to a floor or to the `boost_only` rule could make gibberish return files, or let a noisy voice transcript bypass the floor, and every test would still pass.
   - **Fix:** One pure test with hand-made 3-d vectors. An item below the floor whose filename matches passes when `boost_only=False` and is dropped when `boost_only=True`. Photos keep their own budget when `photo_limit` is set.
   - **If we skip it:** Search quality can regress without anyone noticing.

10. **The chat backend is dead code, with a bug in it** (`routes/search.py:L13-63`, `app_state.py:L62-68`, `app_config.py:L20`, `routes/schemas.py:L37`, `routes/settings.py:L26-27`)
    - **What this is:** `/api/chat` answers questions through Ollama. It comes with keyword lists, `get_engine`, and a `custom_instructions` setting.
    - **Problem:** The frontend never calls `/api/chat` and has no field for `custom_instructions`. Grep shows no caller outside the route. `cli.py ask` builds its own `QAEngine`. The route also has a bug: its keyword test matches substrings, so "pic" matches "topic", and "summary of my thesis topic" returns photos only.
    - **Fix:** Delete the route, the keyword lists, `ChatRequest`, `get_engine`, the `custom_instructions` setting and its trimming. Keep `qa_engine.py` for the CLI. About -70 lines.
    - **If we skip it:** An unused API, with an unauthenticated LLM call path, has to be kept safe and working.

11. **Other dead code** (`routes/audio.py:L63-95`, `routes/pages.py:L41-46`, `embedder.py:L72-82`, `watcher.py:L111,L158`)
    - **What this is:** These are `/api/transcribe` ("for chat dictation", which no longer exists), the `/vite.svg` route (no such file is built), `Embedder.embed_text` and `LiveWatcher.watched_paths`.
    - **Problem:** Grep across Python, TS/TSX, HTML and tests finds no caller. The only exception is one test for `/api/transcribe`.
    - **Fix:** Delete them, plus `test_transcribe_rejects_non_audio_without_leaking_decoder_output`. About -65 lines.
    - **If we skip it:** More surface to read and keep secure. `/api/transcribe` takes 25 MB uploads and runs ffmpeg on them.

12. **Drive sync builds every record twice and drops a field** (`google_sync/drive.py:L51-103`)
    - **What this is:** Drive sync builds a `metas` dict per file, then copies it into a second dict for storage.
    - **Problem:** It is twice the code for one job. The `excerpt` it carefully builds is silently dropped, because `Storage` has no such column. Gmail already uses `scanner.embed_and_store` for the same embed-and-store step.
    - **Fix:** Build the final record once and call `scanner.embed_and_store(emb, store, records, "google_drive")`, as Gmail does. About -30 lines.
    - **If we skip it:** Two shapes to keep in step, and a field that looks used but isn't.

## Nice to have

13. **The preview cache never shrinks** (`routes/media.py:L100`, `routes/media.py:L170`)
    - **What this is:** Each QuickLook preview and app icon is cached as a PNG keyed by path, mtime and size.
    - **Problem:** Each edit of a file leaves its old PNG behind. Only Reset all deletes them. It is small today (618 files, 18 MB), but it only grows.
    - **Fix:** Also delete `PREVIEW_CACHE_DIR` in `/api/clear`. Optionally, delete PNGs older than 30 days at startup.
    - **If we skip it:** Slow, unbounded disk growth.

14. **The watcher reads `config.json` from disk for every file event** (`watcher.py:L126`)
    - **What this is:** To learn a changed file's source type, the watcher re-reads and parses the config file each time.
    - **Problem:** A `git checkout` touching 3,000 files means 3,000 file reads and JSON parses. Each event also builds two thread pools inside `scan_path`.
    - **Fix:** In `sync_sources`, store `{path: source_type}` next to `self.watches` and look it up there.
    - **If we skip it:** A little wasted CPU on bursts of edits.

15. **Drive and Gmail sync stop at 200 files and 1,000 messages without saying so** (`google_sync/drive.py:L16`, `google_sync/gmail.py:L21`)
    - **What this is:** These are default caps on how much each sync pulls.
    - **Problem:** The job reports "Finished", and the user is never told the rest was skipped. Google sync is not public yet ("coming soon"), so this only affects dev builds today.
    - **Fix:** Mark both with `shortcut: first N items only, page through all before public release`, or mention the cap in the finished status.
    - **If we skip it:** A missing file looks like a search bug.

---

**Verdict:** Basically healthy and well tested. Fix 1 first (index compaction: 1.4 GB on disk for 141 MB of data, and growing), then 2 and 3, so that Reset and Remove really remove.

**Lean:** -165 lines, -0 dependencies possible (findings 4, 6, 7, 10, 11, 12).

**Not checked:** I skimmed only part of the frontend React/TS. I did not read `useAudioSearch.ts`, the Settings and Search components, or the CSS. In the Tauri Rust code I read `backend.rs` and the start of `lib.rs`, but not `hotkey.rs`, `permission.rs` or `tray.rs`. I also did not read the PyInstaller packaging, `tools/`, `dev-app.sh`, or the system settings table in `connectors.py`. I did not run the app or test voice/Metal behaviour on hardware. `cargo test` and the frontend build were not run.
