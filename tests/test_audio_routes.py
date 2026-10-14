"""Voice search goes straight to EmbeddingGemma audio embedding, no Whisper.

History: first-ever /api/audio-search once deadlocked the whole server via
_transcribe_lock + get_transcriber(). Audio search no longer transcribes:
samples -> embed_audio -> vector search, query stays empty.
Run: .venv/bin/python -m unittest tests.test_audio_routes -v
"""
import io
import struct
import sys
import types
import unittest
import wave

sys.path.insert(0, ".")

fake_whisper = types.ModuleType("whisper")


class _FakeModel:
    def transcribe(self, path, fp16=False):
        return {"text": "tax invoice"}


fake_whisper.load_model = lambda name, device=None: _FakeModel()
sys.modules.setdefault("whisper", fake_whisper)

import app_state  # noqa: E402
import routes.audio as audio  # noqa: E402


class _FakeEmbedder:
    audio_calls = 0
    text_calls = 0

    def embed_query(self, text):
        type(self).text_calls += 1
        return [0.0] * 768

    def embed_audio(self, samples, rate):
        type(self).audio_calls += 1
        return [0.0] * 768


class _FakeStorage:
    def search(self, vector, query_text=None, limit=60, photo_limit=40):
        return []


def _wav_bytes() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", 1000) for _ in range(16000)))
    return buf.getvalue()


class AudioSearchFirstCallTest(unittest.TestCase):
    def setUp(self):
        audio._transcriber = None
        _FakeEmbedder.audio_calls = 0
        _FakeEmbedder.text_calls = 0
        app_state.get_embedder = lambda: _FakeEmbedder()
        app_state.get_storage = lambda: _FakeStorage()

    def test_first_audio_search_returns_and_health_survives(self):
        import fastapi

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        from routes import pages

        app.include_router(pages.router)

        from fastapi.testclient import TestClient

        with TestClient(app, base_url="http://127.0.0.1:8585", raise_server_exceptions=False) as client:
            res = client.post(
                "/api/audio-search",
                files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
                timeout=30,
            )
            self.assertEqual(res.status_code, 200, res.text)
            # No transcription: audio embedding searched directly, no query text.
            self.assertEqual(res.json()["query"], "")
            self.assertGreaterEqual(_FakeEmbedder.audio_calls, 1)
            self.assertEqual(_FakeEmbedder.text_calls, 0)
            self.assertIsNone(audio._transcriber)
            health = client.get("/api/health", timeout=5)
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json(), {"ok": True})

    def test_spotlight_query_length_capped(self):
        from routes.schemas import SpotlightRequest

        with self.assertRaises(Exception):
            SpotlightRequest(query="x" * 501)


if __name__ == "__main__":
    unittest.main()
