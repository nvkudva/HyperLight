import json
from typing import Any, Dict, Generator, List, Optional
import requests

class QAEngine:
    def __init__(self, model: str = "gemma2:2b", ollama_host: str = "http://localhost:11434"):
        self.model = model
        self.ollama_host = ollama_host

    def generate_answer(
        self,
        question: str,
        retrieved_docs: List[Dict[str, Any]],
        stream: bool = False,
    ) -> Dict[str, Any]:
        if not retrieved_docs:
            return {
                "answer": "No relevant documents found in your indexed files to answer this question.",
                "sources": [],
            }

        context_blocks = []
        sources = []
        for idx, doc in enumerate(retrieved_docs):
            filename = doc.get("filename", "Unknown")
            path = doc.get("path", "")
            meta = doc.get("metadata", {})
            page = meta.get("page")
            page_info = f" (Page {page})" if page else ""
            file_type = meta.get("file_type", "")
            size_human = meta.get("size_human", "")
            mod_str = meta.get("modified_str", "")
            content = doc.get("content", "").strip()

            meta_details = []
            if file_type:
                meta_details.append(f"Type: {file_type}")
            if size_human:
                meta_details.append(f"Size: {size_human}")
            if mod_str:
                meta_details.append(f"Modified/Added: {mod_str}")

            header = f"[Source {idx + 1}: {filename}{page_info}]"
            if meta_details:
                header += f"\nMetadata: {' | '.join(meta_details)}"

            context_blocks.append(f"{header}\nPath: {path}\nContent:\n{content}\n")
            sources.append({
                "source_num": idx + 1,
                "filename": filename,
                "path": path,
                "page": page,
                "file_type": file_type,
                "size_human": size_human,
                "modified_str": mod_str,
                "score": doc.get("score", 0.0),
                "excerpt": content[:300] + ("..." if len(content) > 300 else ""),
            })

        context_text = "\n".join(context_blocks)
        prompt = (
            "You are a helpful personal assistant that answers questions accurately based on the user's personal files and documents.\n"
            "Each source provides both file metadata (filename, file type, file size, date added/modified, path) and file content.\n\n"
            f"{context_text}\n"
            f"User Question: {question}\n\n"
            "Instructions:\n"
            "1. Answer the question directly and concisely using the provided context.\n"
            "2. If the user asks about file metadata (file size, when it was added/modified, file type), use the provided Metadata.\n"
            "3. Cite the source numbers (e.g. [Source 1]) when referencing details.\n"
            "4. If the answer cannot be determined from the context, clearly state that the information was not found in the indexed documents.\n\n"
            "Answer:"
        )

        response = requests.post(
            f"{self.ollama_host}/api/generate",
            json={
                "model": self.model,
                "prompt": prompt,
                "stream": False,
            },
            timeout=60,
        )

        if response.status_code != 200:
            return {
                "answer": f"Error communicating with local Gemma model: {response.text}",
                "sources": sources,
            }

        data = response.json()
        answer = data.get("response", "").strip()
        return {
            "answer": answer,
            "sources": sources,
        }
