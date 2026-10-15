from pathlib import Path
import threading
from typing import Any, Dict, List, Optional, Sequence
import numpy
import PIL.Image
import sentence_transformers
import torch

MAX_INPUT_CHARS = 2000


def _empty_cache(device: str) -> None:
    if device == "mps" and hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
        torch.mps.empty_cache()


def _clip(text: str) -> str:
    return text[:MAX_INPUT_CHARS]


MAX_IMAGE_DIM = 1024


def _fit_image(img: "PIL.Image.Image") -> "PIL.Image.Image":
    if max(img.size) > MAX_IMAGE_DIM:
        img.thumbnail((MAX_IMAGE_DIM, MAX_IMAGE_DIM))
    return img


class Embedder:
    def __init__(self, model_name: str = "google/embeddinggemma-2"):
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model = sentence_transformers.SentenceTransformer(model_name, device=self.device)
        # One lock for every encode: Metal aborts the whole process ("A command
        # encoder is already encoding to this command buffer") when two threads
        # run the model at once, e.g. a PDF page image from a parse thread
        # while the embed worker encodes a text batch.
        self._model_lock = threading.Lock()
        self._query_cache: Dict[str, List[float]] = {}
        self._query_cache_lock = threading.Lock()

    def embed_query(self, query: str) -> List[float]:
        cleaned = _clip(query.strip())
        key = cleaned.lower()
        with self._query_cache_lock:
            hit = self._query_cache.get(key)
        if hit is not None:
            return hit
        if key.startswith("code:"):
            code_query = cleaned[5:].strip()
            prompt = f"task: code retrieval | query: {code_query}"
        else:
            prompt = f"task: search result | query: {cleaned}"
        with self._model_lock:
            vec = self.model.encode(prompt, normalize_embeddings=True)
        result = vec.tolist()
        with self._query_cache_lock:
            if len(self._query_cache) >= 256:
                self._query_cache.pop(next(iter(self._query_cache)))
            self._query_cache[key] = result
        return result

    def embed_text(self, text: str, title: Optional[str] = None, is_query: bool = False) -> List[float]:
        if is_query:
            return self.embed_query(text)
        cleaned = _clip(text.strip())
        if cleaned.startswith("task: ") or cleaned.startswith("title: "):
            doc_str = cleaned
        else:
            doc_str = f"title: {title or 'none'} | text: {cleaned}"
        with self._model_lock:
            vec = self.model.encode(doc_str, normalize_embeddings=True)
        return vec.tolist()

    def embed_texts(self, texts: List[str], titles: Optional[List[str]] = None, batch_size: int = 64) -> List[List[float]]:
        if not texts:
            return []
        formatted = []
        for i, text in enumerate(texts):
            cleaned = _clip(text.strip())
            if cleaned.startswith("task: ") or cleaned.startswith("title: "):
                formatted.append(cleaned)
            else:
                title = titles[i] if titles and i < len(titles) else "none"
                formatted.append(f"title: {title or 'none'} | text: {cleaned}")
        # Lock per batch so live queries interleave with indexing instead of waiting for all of it.
        vectors: List[List[float]] = []
        for i in range(0, len(formatted), batch_size):
            with self._model_lock:
                chunk = self.model.encode(formatted[i : i + batch_size], batch_size=batch_size, normalize_embeddings=True)
                _empty_cache(self.device)
            vectors.extend(chunk.tolist())
        return vectors

    def embed_audio(self, samples: Sequence[float], sampling_rate: int = 16000) -> Optional[List[float]]:
        try:
            audio = {"array": numpy.asarray(samples, dtype=numpy.float32), "sampling_rate": sampling_rate}
            with self._model_lock:
                vec = self.model.encode({"audio": audio}, normalize_embeddings=True)
            return vec.tolist()
        except Exception:
            return None

    def embed_image(self, image_input: Any) -> Optional[List[float]]:
        try:
            if isinstance(image_input, PIL.Image.Image):
                img = image_input
            else:
                img = PIL.Image.open(image_input)
            image = _fit_image(img.convert("RGB"))
            with self._model_lock:
                vec = self.model.encode({"image": image}, normalize_embeddings=True)
            return vec.tolist()
        except Exception:
            return None

    def embed_images(self, image_paths: List[Path], batch_size: int = 16) -> List[Optional[List[float]]]:
        results: List[Optional[List[float]]] = [None] * len(image_paths)
        valid_indices = []
        valid_images = []
        for idx, p in enumerate(image_paths):
            try:
                img = _fit_image(PIL.Image.open(p).convert("RGB"))
                valid_indices.append(idx)
                valid_images.append({"image": img})
            except Exception:
                pass

        if not valid_images:
            return results

        for i in range(0, len(valid_images), batch_size):
            chunk_inputs = valid_images[i : i + batch_size]
            chunk_indices = valid_indices[i : i + batch_size]
            with self._model_lock:
                chunk_vectors = self.model.encode(chunk_inputs, normalize_embeddings=True)
                _empty_cache(self.device)
            vectors = chunk_vectors.tolist()
            for orig_idx, vec in zip(chunk_indices, vectors):
                results[orig_idx] = vec
        return results

