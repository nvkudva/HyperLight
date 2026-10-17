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
    text = "tax invoice"
    no_speech_prob = 0.0

    def transcribe(self, samples, fp16=False, temperature=0, condition_on_previous_text=False):
        return {"text": type(self).text, "segments": [{"no_speech_prob": type(self).no_speech_prob}]}


fake_whisper.load_model = lambda name, device=None: _FakeModel()
sys.modules.setdefault("whisper", fake_whisper)

import app_config  # noqa: E402
import app_state  # noqa: E402
import routes.audio as audio  # noqa: E402


class _FakeEmbedder:
    audio_calls = 0
    text_calls = 0
    raw_calls = 0

    def embed_audio(self, samples, rate):
        type(self).raw_calls += 1
        return [0.0] * 768

    def embed_query(self, text):
        type(self).text_calls += 1
        return [0.0] * 768

    def null_vectors(self):
        return [[0.0] * 768]

    def embed_query_audio(self, text, samples, rate):
        type(self).audio_calls += 1
        type(self).last_text = text
        return [0.0] * 768


class _FakeStorage:
    last_kwargs = {}

    def search(self, vector, null_vectors, query_text=None, limit=60, photo_limit=40, boost_only=False):
        type(self).last_kwargs = {"query_text": query_text, "boost_only": boost_only}
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
        _FakeModel.text = "tax invoice"
        _FakeModel.no_speech_prob = 0.0
        _FakeEmbedder.audio_calls = 0
        _FakeEmbedder.text_calls = 0
        _FakeEmbedder.raw_calls = 0
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
            self.assertEqual(res.json()["query"], "tax invoice")
            self.assertGreaterEqual(_FakeEmbedder.audio_calls, 1)
            self.assertEqual(_FakeStorage.last_kwargs, {"query_text": "tax invoice", "boost_only": True})
            health = client.get("/api/health", timeout=5)
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json(), {"ok": True})

    def _post(self, client):
        return client.post("/api/audio-search", files={"file": ("clip.wav", _wav_bytes(), "audio/wav")}, timeout=30)

    def test_no_speech_returns_empty_buckets(self):
        import fastapi
        from fastapi.testclient import TestClient

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        with TestClient(app, raise_server_exceptions=False) as client:
            _FakeModel.no_speech_prob = 0.9
            self.assertEqual(self._post(client).json(), {"query": "", "buckets": [], "total_matches": 0})
            _FakeModel.no_speech_prob = 0.0
            _FakeModel.text = " ... "
            self.assertEqual(self._post(client).json(), {"query": "", "buckets": [], "total_matches": 0})
            self.assertEqual(_FakeEmbedder.audio_calls, 0)

    def test_transcription_off_searches_raw_audio_without_whisper(self):
        import fastapi
        from unittest import mock
        from fastapi.testclient import TestClient

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        settings = {**app_config.DEFAULT_SETTINGS, "voice_transcription": False}
        with mock.patch.object(app_config, "get_app_settings", return_value=settings):
            with TestClient(app, raise_server_exceptions=False) as client:
                self.assertEqual(client.post("/api/audio-warmup").json(), {"status": "ok"})
                self.assertEqual(self._post(client).json(), {"query": "", "buckets": [], "total_matches": 0})
        self.assertEqual(_FakeEmbedder.raw_calls, 1)
        self.assertEqual(_FakeEmbedder.audio_calls, 0)
        self.assertEqual(_FakeStorage.last_kwargs, {"query_text": None, "boost_only": False})
        self.assertIsNone(audio._transcriber)

    def test_transcribe_rejects_non_audio_without_leaking_decoder_output(self):
        import fastapi
        from unittest import mock
        from fastapi.testclient import TestClient

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        ffmpeg_dump = RuntimeError("Failed to load audio: ffmpeg version 7 --enable-gpl --prefix=/opt/homebrew")
        with mock.patch.object(audio, "_decode_audio", side_effect=ffmpeg_dump):
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/api/transcribe", files={"file": ("notes.txt", b"hello", "text/plain")})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json(), {"error": "Unreadable audio file."})

    def test_audio_search_failure_does_not_leak_internal_messages(self):
        import fastapi
        from unittest import mock
        from fastapi.testclient import TestClient

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        with mock.patch.object(audio.spotlight, "query_audio", side_effect=ValueError("operands could not be broadcast")):
            with TestClient(app, raise_server_exceptions=False) as client:
                res = self._post(client)
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json(), {"error": "Audio search failed."})

    def test_audio_search_rejects_truncated_wav(self):
        import fastapi
        from fastapi.testclient import TestClient

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        with TestClient(app, raise_server_exceptions=False) as client:
            res = client.post("/api/audio-search", files={"file": ("clip.wav", b"RIFF", "audio/wav")})
        self.assertEqual(res.status_code, 400)

    def test_warmup_ok(self):
        import fastapi
        from fastapi.testclient import TestClient

        app = fastapi.FastAPI()
        app.include_router(audio.router)
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/audio-warmup").json(), {"status": "ok"})

    def test_spotlight_query_length_capped(self):
        from routes.schemas import SpotlightRequest

        with self.assertRaises(Exception):
            SpotlightRequest(query="x" * 501)


if __name__ == "__main__":
    unittest.main()
