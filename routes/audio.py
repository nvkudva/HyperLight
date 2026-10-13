"""Microphone transcription and voice-search routes."""
import os
import tempfile
import threading
import wave
from pathlib import Path
from typing import Any

import fastapi
import numpy

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


@router.post("/api/transcribe")
def api_transcribe(file: fastapi.UploadFile = fastapi.File(...)) -> Any:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return fastapi.responses.JSONResponse(status_code=413, content={"error": "Audio upload too large."})
    if not data:
        return fastapi.responses.JSONResponse(status_code=400, content={"error": "Empty audio upload."})
    suffix = Path(file.filename or "clip").suffix or ".webm"
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        model = get_transcriber()
        with _transcribe_lock:
            result = model.transcribe(tmp_path, fp16=False)
        return {"text": (result.get("text") or "").strip()}
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return fastapi.responses.JSONResponse(status_code=500, content={"error": f"Transcription failed: {e}"})
    finally:
        try:
            if tmp_path:
                os.unlink(tmp_path)
        except OSError:
            pass


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
        transcript = ""
        try:
            model = get_transcriber()
            with _transcribe_lock:
                transcript = (model.transcribe(tmp_path, fp16=False).get("text") or "").strip()
        except Exception as e:
            logger.error(f"Voice transcription failed, falling back to audio embedding: {e}")
        response = spotlight.query_audio(transcript, samples, 16000)
        if response is None:
            return fastapi.responses.JSONResponse(status_code=500, content={"error": "Audio embedding failed."})
        logger.info(f"Audio search '{transcript[:60]}' -> {response['total_matches']} matches across {len(response['buckets'])} buckets")
        return response
    except wave.Error:
        logger.error("Audio search failed, unreadable WAV.")
        return fastapi.responses.JSONResponse(status_code=400, content={"error": "Unreadable audio file."})
    except Exception as e:
        logger.error(f"Audio search failed: {e}")
        return fastapi.responses.JSONResponse(status_code=500, content={"error": f"Audio search failed: {e}"})
    finally:
        try:
            if tmp_path:
                os.unlink(tmp_path)
        except OSError:
            pass
