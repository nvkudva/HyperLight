import os
from pathlib import Path
import sys

REPO_PYTHON = Path(__file__).resolve().parent / ".venv" / "bin" / "python3"

def use_repo_python() -> None:
    """Re-run under the repo's virtualenv so `python3 cli.py ...` works from any interpreter."""
    if REPO_PYTHON.exists() and Path(sys.prefix).resolve() != REPO_PYTHON.parent.parent.resolve():
        os.execv(REPO_PYTHON, [str(REPO_PYTHON), *sys.argv])

if __name__ == "__main__":
    use_repo_python()  # before the imports below, which fail under a bare system python

import argparse
import datetime
import time
import embedder
import qa_engine
import scanner
import sources
import storage
import watcher

def cmd_index(args: argparse.Namespace) -> None:
    target_path = Path(args.path).expanduser().resolve()
    if not target_path.exists():
        print(f"Error: Path does not exist: {target_path}")
        sys.exit(1)

    print(f"Initializing embedding model and database...")
    emb = embedder.Embedder()
    store = storage.Storage()
    sc = scanner.Scanner(emb, store)

    print(f"Scanning and indexing '{target_path}' (source: {args.source})...")
    def on_progress(filename: str, current: int, total: int) -> None:
        if current % 10 == 0 or current == total:
            print(f"[{current}/{total}] Processing {filename}...")

    indexed_count = sc.scan_path(target_path, source=args.source, on_progress=on_progress)
    sources.record_scan(target_path.name or str(target_path), str(target_path), args.source)
    print(f"Done! Successfully indexed {indexed_count} items from {target_path}.")

def cmd_search(args: argparse.Namespace) -> None:
    emb = embedder.Embedder()
    store = storage.Storage()

    query_vec = emb.embed_query(args.query)
    results = store.search(query_vec, emb.null_vectors(), query_text=args.query, item_type=args.type, limit=args.limit)

    if not results:
        print(f"No results found for '{args.query}'.")
        return

    print(f"\nFound {len(results)} results for '{args.query}':\n")
    for idx, item in enumerate(results, start=1):
        item_type = item["type"].upper()
        score = item["score"]
        print(f"{idx}. [{item_type}] {item['filename']} (score: {score:.4f})")
        print(f"   Path: {item['path']}")
        if item["type"] in ("document", "contact", "calendar", "bookmark"):
            page = item.get("metadata", {}).get("page")
            if page:
                print(f"   Page: {page}")
            snippet = item["content"].replace("\n", " ")[:200]
            print(f"   Snippet: {snippet}...\n")
        else:
            print()

def cmd_ask(args: argparse.Namespace) -> None:
    emb = embedder.Embedder()
    store = storage.Storage()
    engine = qa_engine.QAEngine()

    print(f"Searching indexed files for context...")
    query_vec = emb.embed_query(args.question)
    docs = store.search(query_vec, emb.null_vectors(), query_text=args.question, limit=args.limit)

    print(f"Generating answer using Gemma 2...\n")
    result = engine.generate_answer(args.question, docs)

    print("=" * 60)
    print("ANSWER:")
    print("=" * 60)
    print(result["answer"])
    print("\n" + "=" * 60)
    print("SOURCES:")
    print("=" * 60)
    for src in result["sources"]:
        page_info = f" (Page {src['page']})" if src.get("page") else ""
        print(f"[Source {src['source_num']}] {src['filename']}{page_info}")
        print(f"  Path: {src['path']}")
        print(f"  Excerpt: {src['excerpt']}\n")

def cmd_status(args: argparse.Namespace) -> None:
    store = storage.Storage()
    stats = store.get_stats()
    print("=" * 40)
    print("HYPERLIGHT STATUS")
    print("=" * 40)
    print(f"Total indexed items: {stats['total']}")
    print(f"Photos:              {stats['photos']}")
    print(f"Documents:           {stats['documents']}")
    print("\nSources breakdown:")
    for src, count in stats["sources"].items():
        print(f"  - {src}: {count} items")
    print("=" * 40)

def cmd_clear(args: argparse.Namespace) -> None:
    if not args.force:
        confirm = input("Are you sure you want to clear all indexed vectors? (y/N): ")
        if confirm.lower() != "y":
            print("Aborted.")
            return
    store = storage.Storage()
    store.clear()
    print("Vector database cleared successfully.")

def cmd_watch(args: argparse.Namespace) -> None:
    emb = embedder.Embedder()
    store = storage.Storage()
    sc = scanner.Scanner(emb, store)

    active_sources = [s for s in sources.list_all() if s["watchable"]]
    if not active_sources:
        print("No active folder sources configured to watch. Index a folder first using 'hyperlight index <path>'.")
        return

    print("=" * 60)
    print("⚡ HYPERLIGHT - LIVE FSEVENTS AUTO-SYNC")
    print("=" * 60)
    for s in active_sources:
        print(f"  Watching: {s['name']} -> {s['path']}")
    print("\nListening for file events via macOS kernel notifications...")
    print("Files will be auto-indexed in <15ms the moment they are saved.")
    print("Press Ctrl+C to stop.\n")

    def on_event(filename: str, action: str) -> None:
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        if action == "indexed":
            print(f"[{ts}] ⚡ Auto-indexed: {filename}")
        elif action == "deleted":
            print(f"[{ts}] 🗑️ Removed from index: {filename}")

    w = watcher.LiveWatcher(emb, store, sc, sources.watched_paths, on_indexed=on_event)
    w.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping live watcher...")
        w.stop()
        print("Watcher stopped.")

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hyperlight",
        description="Hyperlight - Multimodal on-device search & Gemma 2 Q&A",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_watch = subparsers.add_parser("watch", help="Start real-time FSEvents live background watcher")
    p_watch.set_defaults(func=cmd_watch)

    p_index = subparsers.add_parser("index", help="Index a folder or file")
    p_index.add_argument("path", help="Path to file or directory to index")
    p_index.add_argument(
        "--source",
        choices=["local", "google_drive", "google_photos"],
        default="local",
        help="Source tag",
    )
    p_index.set_defaults(func=cmd_index)

    p_search = subparsers.add_parser("search", help="Semantic search photos or documents")
    p_search.add_argument("query", help="Text search query")
    p_search.add_argument(
        "--type",
        choices=["all", "photo", "document"],
        default="all",
        help="Filter result type",
    )
    p_search.add_argument("--limit", type=int, default=5, help="Number of results")
    p_search.set_defaults(func=cmd_search)

    p_ask = subparsers.add_parser("ask", help="Ask a question answered by Gemma 2")
    p_ask.add_argument("question", help="Question to answer from indexed documents")
    p_ask.add_argument("--limit", type=int, default=4, help="Number of context documents")
    p_ask.set_defaults(func=cmd_ask)

    p_status = subparsers.add_parser("status", help="Show index statistics")
    p_status.set_defaults(func=cmd_status)

    p_clear = subparsers.add_parser("clear", help="Clear all indexed items")
    p_clear.add_argument("--force", action="store_true", help="Skip confirmation prompt")
    p_clear.set_defaults(func=cmd_clear)

    return parser

def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
