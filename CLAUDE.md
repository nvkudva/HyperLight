# Hyperlight

## Dev Server
- Web prototype port: 8585
- Web URL: http://127.0.0.1:8585

## Quick Commands
- Activate venv: `source .venv/bin/activate`
- CLI status: `python3 cli.py status`
- CLI index: `python3 cli.py index <path> [--source local|google_drive|google_photos]`
- CLI search: `python3 cli.py search "<query>" [--type all|photo|document]`
- CLI ask: `python3 cli.py ask "<question>"`
- Run Web app: `python3 web_app.py`
- Run desktop dev app: `./dev-app.sh` (one window, mic works; do not run `tauri dev` alongside)
