"""Voice routes: EmbeddingGemma audio search.

Audio search transcribes with Whisper, then embeds transcript + audio jointly
(see spotlight.query_audio).
"""
import os
import tempfile
import threading
import wave
from typing import Any

import fastapi
import numpy

import app_config
import app_state
import logging_config
import spotlight

logger = logging_config.get_logger("routes.audio")

router = fastapi.APIRouter()

_transcriber = None
_transcribe_lock = threading.Lock()
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def get_transcriber():
    global _transcriber
    if _transcriber is None:
        with _transcribe_lock:
            if _transcriber is None:
                import whisper
                logger.info("Loading whisper base model for transcription...")
                _transcriber = whisper.load_model("base", device="cpu")
                logger.info("Whisper model ready.")
    return _transcriber


def _transcribe_samples(samples: numpy.ndarray) -> dict:
    model = get_transcriber()
    with _transcribe_lock:
        return model.transcribe(samples, fp16=False, temperature=0, condition_on_previous_text=False)


@router.post("/api/audio-warmup")
def api_audio_warmup() -> Any:
    if app_config.get_app_settings()["voice_transcription"]:
        get_transcriber()
    app_state.get_embedder()
    return {"status": "ok"}


@router.post("/api/audio-search")
def api_audio_search(file: fastapi.UploadFile = fastapi.File(...)) -> Any:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return fastapi.responses.JSONResponse(status_code=413, content={"error": "Audio upload too large."})
    if not data:
        return fastapi.responses.JSONResponse(status_code=400, content={"error": "Empty audio upload."})
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        with wave.open(tmp_path, "rb") as w:
            n_channels = w.getnchannels()
            sample_width = w.getsampwidth()
            frame_rate = w.getframerate()
            n_frames = w.getnframes()
            raw = w.readframes(n_frames)
        if sample_width != 2 or frame_rate != 16000 or n_frames < 3200:
            return fastapi.responses.JSONResponse(
                status_code=400,
                content={"error": "Expected 16kHz 16-bit mono WAV of at least 0.2s."},
            )
        samples = numpy.frombuffer(raw, dtype=numpy.int16).astype(numpy.float32) / 32768.0
        if n_channels > 1:
            samples = samples.reshape(-1, n_channels).mean(axis=1)
        samples = samples[: 16000 * 120]
        is_transcribing = app_config.get_app_settings()["voice_transcription"]
        response = spotlight.query_audio(samples, 16000, _transcribe_samples if is_transcribing else None)
        if response is None:
            return fastapi.responses.JSONResponse(status_code=500, content={"error": "Audio embedding failed."})
        logger.info(f"Audio search -> {response['total_matches']} matches across {len(response['buckets'])} buckets")
        return response
    except (wave.Error, EOFError):
        logger.error("Audio search failed, unreadable WAV.")
        return fastapi.responses.JSONResponse(status_code=400, content={"error": "Unreadable audio file."})
    except Exception as e:
        logger.error(f"Audio search failed: {e}")
        return fastapi.responses.JSONResponse(status_code=500, content={"error": "Audio search failed."})
    finally:
        try:
            if tmp_path:
                os.unlink(tmp_path)
        except OSError:
            pass
