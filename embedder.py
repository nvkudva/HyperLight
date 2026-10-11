from pathlib import Path
from typing import Any, List, Optional
import PIL.Image
import sentence_transformers
import torch

class Embedder:
    def __init__(self, model_name: str = "google/embeddinggemma-2"):
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model = sentence_transformers.SentenceTransformer(model_name, device=self.device)

    def embed_query(self, query: str) -> List[float]:
        cleaned = query.strip()
        if cleaned.lower().startswith("code:"):
            code_query = cleaned[5:].strip()
            prompt = f"task: code retrieval | query: {code_query}"
        else:
            prompt = f"task: search result | query: {cleaned}"
        vec = self.model.encode(prompt, normalize_embeddings=True)
        return vec.tolist()

    def embed_text(self, text: str, title: Optional[str] = None, is_query: bool = False) -> List[float]:
        if is_query:
            return self.embed_query(text)
        cleaned = text.strip()
        if cleaned.startswith("task: ") or cleaned.startswith("title: "):
            doc_str = cleaned
        else:
            doc_str = f"title: {title or 'none'} | text: {cleaned}"
        vec = self.model.encode(doc_str, normalize_embeddings=True)
        return vec.tolist()

    def embed_texts(self, texts: List[str], titles: Optional[List[str]] = None, batch_size: int = 32) -> List[List[float]]:
        if not texts:
            return []
        formatted = []
        for i, text in enumerate(texts):
            cleaned = text.strip()
            if cleaned.startswith("task: ") or cleaned.startswith("title: "):
                formatted.append(cleaned)
            else:
                title = titles[i] if titles and i < len(titles) else "none"
                formatted.append(f"title: {title or 'none'} | text: {cleaned}")
        vectors = self.model.encode(formatted, batch_size=batch_size, normalize_embeddings=True)
        return vectors.tolist()

    def embed_image(self, image_input: Any) -> Optional[List[float]]:
        try:
            if isinstance(image_input, PIL.Image.Image):
                img = image_input
            else:
                img = PIL.Image.open(image_input)
            image = img.convert("RGB")
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
                img = PIL.Image.open(p).convert("RGB")
                valid_indices.append(idx)
                valid_images.append({"image": img})
            except Exception:
                pass

        if not valid_images:
            return results

        for i in range(0, len(valid_images), batch_size):
            chunk_inputs = valid_images[i : i + batch_size]
            chunk_indices = valid_indices[i : i + batch_size]
            chunk_vectors = self.model.encode(chunk_inputs, normalize_embeddings=True)
            vectors = chunk_vectors.tolist()
            for orig_idx, vec in zip(chunk_indices, vectors):
                results[orig_idx] = vec
        return results

