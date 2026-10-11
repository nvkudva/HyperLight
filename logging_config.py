import logging
import logging.handlers
from pathlib import Path
import queue
import sys

_log_queue: queue.Queue = queue.Queue(maxsize=10000)
_listener: logging.handlers.QueueListener = None

def setup_logging(log_dir: Path = None, level: int = logging.INFO) -> logging.Logger:
    global _listener
    if log_dir is None:
        log_dir = Path.home() / ".smart_personal_search"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "app.log"

    root_logger = logging.getLogger("smart_search")
    root_logger.setLevel(level)

    if root_logger.handlers:
        return root_logger

    # Formatters
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(threadName)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Underlying destination handlers
    file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
    file_handler.setFormatter(formatter)
    file_handler.setLevel(level)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(level)

    # QueueListener runs in background thread
    _listener = logging.handlers.QueueListener(
        _log_queue, file_handler, console_handler, respect_handler_level=True
    )
    _listener.start()

    # QueueHandler on root logger sends records non-blockingly to queue
    queue_handler = logging.handlers.QueueHandler(_log_queue)
    root_logger.addHandler(queue_handler)

    root_logger.info(f"Asynchronous logging initialized. Log file: {log_file}")
    return root_logger

def get_logger(name: str = "smart_search") -> logging.Logger:
    if name == "smart_search" or name.startswith("smart_search."):
        return logging.getLogger(name)
    return logging.getLogger(f"smart_search.{name}")

def shutdown_logging() -> None:
    global _listener
    if _listener is not None:
        _listener.stop()
