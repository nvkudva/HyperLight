"""Static OAuth callback pages (kept out of the route handlers)."""
import html


def auth_cancelled_page(error: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Sign-In</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
    .card {{ background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(255,255,255,0.1); padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 420px; }}
    h1 {{ font-size: 1.25rem; margin: 0 0 0.5rem 0; color: #f87171; }}
    p {{ font-size: 0.875rem; color: #94a3b8; line-height: 1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
    <h1>Google Sign-In Cancelled</h1>
    <p>{html.escape(error)}</p>
    <p style="margin-top: 1.5rem; font-size: 0.75rem; color: #64748b;">You can close this tab and return to Hyperlight.</p>
  </div>
</body>
</html>"""


def auth_missing_code_page() -> str:
    return """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Error</title></head>
<body style="font-family: -apple-system, sans-serif; background: #0f172a; color: #f87171; text-align: center; padding-top: 4rem;">
  <h2>No authorization code provided</h2>
</body>
</html>"""


def auth_success_page() -> str:
    return """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connected to Google</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 2.5rem 3rem;
      border-radius: 1.25rem;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      max-width: 420px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem 0; color: #f8fafc; }
    p { font-size: 0.875rem; color: #94a3b8; margin: 0 0 1.5rem 0; line-height: 1.5; }
    .badge {
      display: inline-block;
      padding: 0.35rem 0.85rem;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✨</div>
    <h1>Connected to Google</h1>
    <p>Your Google account has been linked to Hyperlight. You can close this window now.</p>
    <div class="badge">● Connected &amp; Ready</div>
  </div>
  <script>
    if (window.opener) {
      try { window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*'); } catch (e) {}
    }
    setTimeout(() => {
      try { window.close(); } catch (e) {}
    }, 2000);
  </script>
</body>
</html>"""


def auth_error_page(error: Exception) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Sign-In Error</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
    .card {{ background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(255,255,255,0.1); padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 440px; }}
    h1 {{ font-size: 1.25rem; margin: 0 0 0.5rem 0; color: #f87171; }}
    p {{ font-size: 0.875rem; color: #94a3b8; line-height: 1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
    <h1>Authentication Error</h1>
    <p>{html.escape(str(error))}</p>
    <p style="margin-top: 1.5rem; font-size: 0.75rem; color: #64748b;">Please close this window, check your credentials in Settings, and try again.</p>
  </div>
</body>
</html>"""
