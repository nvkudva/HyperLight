"""Repeatable voice-search eval against a running backend.

Usage: .venv/bin/python tools/eval_voice.py [extra_wav_dir]
Speech clips come from macOS `say`; silence and noise must return 0 results.
"""
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy
import requests

URL = "http://127.0.0.1:8585/api/audio-search"
PHRASES = ["invoice", "passport", "wifi settings", "beach photos", "receipt amazon", "meeting tomorrow"]
MUST_BE_EMPTY = {"silence", "noise"}


def write_wav(path: Path, samples: numpy.ndarray) -> None:
    pcm = (numpy.clip(samples, -1, 1) * 32767).astype(numpy.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())


def say_clip(phrase: str, out_dir: Path) -> Path:
    aiff = out_dir / "x.aiff"
    wav = out_dir / f"{phrase.replace(' ', '_')}.wav"
    subprocess.run(["say", "-o", str(aiff), phrase], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)], check=True)
    return wav


def build_clips(out_dir: Path, extra_dir: str) -> dict:
    clips = {p: say_clip(p, out_dir) for p in PHRASES}
    write_wav(out_dir / "silence.wav", numpy.zeros(32000, dtype=numpy.float32))
    clips["silence"] = out_dir / "silence.wav"
    rng = numpy.random.default_rng(0)
    write_wav(out_dir / "noise.wav", rng.normal(0, 0.05, 32000).astype(numpy.float32))
    clips["noise"] = out_dir / "noise.wav"
    if extra_dir:
        for wav in sorted(Path(extra_dir).glob("*.wav")):
            clips[wav.stem] = wav
    return clips


def top_hits(data: dict, n: int = 5) -> list:
    items = [i for b in data["buckets"] for i in b["items"]]
    items.sort(key=lambda i: i["score"], reverse=True)
    return [f"{i['filename']} ({i['score']:.3f})" for i in items[:n]]


def main() -> int:
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, path in build_clips(Path(tmp), sys.argv[1] if len(sys.argv) > 1 else "").items():
            start = time.time()
            res = requests.post(URL, files={"file": (path.name, path.read_bytes(), "audio/wav")}, timeout=120)
            ms = (time.time() - start) * 1000
            data = res.json()
            print(f"[{name}] {res.status_code} {ms:.0f}ms transcript={data.get('query')!r} total={data.get('total_matches')}")
            for hit in top_hits(data):
                print(f"    {hit}")
            if name in MUST_BE_EMPTY and data.get("total_matches") != 0:
                print("    FAIL: expected 0 results")
                failures += 1
    return failures


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
