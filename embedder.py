from pathlib import Path
from typing import Any, List, Optional
import open_clip
import PIL.Image
import torch

class Embedder:
    def __init__(self, model_name: str = "ViT-B-32", pretrained: str = "laion2b_s34b_b79k"):
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            model_name,
            pretrained=pretrained,
            device=self.device,
        )
        self.tokenizer = open_clip.get_tokenizer(model_name)
        self.model.eval()

    def embed_text(self, text: str) -> List[float]:
        tokens = self.tokenizer([text]).to(self.device)
        with torch.no_grad():
            features = self.model.encode_text(tokens)
            features = features / features.norm(dim=-1, keepdim=True)
        return features.cpu().squeeze(0).tolist()

    def embed_texts(self, texts: List[str], batch_size: int = 64) -> List[List[float]]:
        all_embeddings: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            tokens = self.tokenizer(batch).to(self.device)
            with torch.no_grad():
                features = self.model.encode_text(tokens)
                features = features / features.norm(dim=-1, keepdim=True)
            all_embeddings.extend(features.cpu().tolist())
        return all_embeddings

    def embed_image(self, image_input: Any) -> Optional[List[float]]:
        try:
            if isinstance(image_input, PIL.Image.Image):
                img = image_input
            else:
                img = PIL.Image.open(image_input)
            if hasattr(img, "draft"):
                img.draft("RGB", (224, 224))
            image = img.convert("RGB")
            tensor = self.preprocess(image).unsqueeze(0).to(self.device)
            with torch.no_grad():
                features = self.model.encode_image(tensor)
                features = features / features.norm(dim=-1, keepdim=True)
            return features.cpu().squeeze(0).tolist()
        except Exception:
            return None

    def embed_images(self, image_paths: List[Path], batch_size: int = 16) -> List[Optional[List[float]]]:
        results: List[Optional[List[float]]] = [None] * len(image_paths)
        valid_indices = []
        valid_tensors = []
        for idx, p in enumerate(image_paths):
            try:
                img = PIL.Image.open(p)
                if hasattr(img, "draft"):
                    img.draft("RGB", (224, 224))
                tensor = self.preprocess(img.convert("RGB"))
                valid_indices.append(idx)
                valid_tensors.append(tensor)
            except Exception:
                pass

        if not valid_tensors:
            return results

        for i in range(0, len(valid_tensors), batch_size):
            chunk_tensors = torch.stack(valid_tensors[i : i + batch_size]).to(self.device)
            chunk_indices = valid_indices[i : i + batch_size]
            with torch.no_grad():
                features = self.model.encode_image(chunk_tensors)
                features = features / features.norm(dim=-1, keepdim=True)
            vectors = features.cpu().tolist()
            for orig_idx, vec in zip(chunk_indices, vectors):
                results[orig_idx] = vec
        return results
