import json
from typing import Any, Dict, Generator, List, Optional
import requests

NUM_CTX = 4096
CHARS_PER_TOKEN = 3
RESERVED_TOKENS = 700  # instructions and the answer itself
SOURCE_HEADER_CHARS = 300
MIN_CHUNK_CHARS = 200
UNREADABLE_REPLY = "The local Gemma model sent a reply Hyperlight could not read. Please try again."


def chunk_char_limit(question: str, system_prompt: str, source_count: int) -> int:
    """Characters of each retrieved chunk that fit in the model's context window."""
    budget = (NUM_CTX - RESERVED_TOKENS) * CHARS_PER_TOKEN - len(question) - len(system_prompt)
    return max(budget // source_count - SOURCE_HEADER_CHARS, MIN_CHUNK_CHARS)


def read_answer(response: requests.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return UNREADABLE_REPLY
    if not isinstance(data, dict):
        return UNREADABLE_REPLY
    return str(data.get("response", "")).strip()


class QAEngine:
    def __init__(self, model: str = "gemma2:2b", ollama_host: str = "http://localhost:11434"):
        self.model = model
        self.ollama_host = ollama_host

    def generate_answer(
        self,
        question: str,
        retrieved_docs: List[Dict[str, Any]],
        stream: bool = False,
        system_prompt: str = "",
    ) -> Dict[str, Any]:
        if not retrieved_docs:
            return {
                "answer": "No relevant documents found in your indexed files to answer this question.",
                "sources": [],
            }

        context_blocks = []
        sources = []
        chunk_limit = chunk_char_limit(question, system_prompt, len(retrieved_docs))
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

            context_blocks.append(f"{header}\nPath: {path}\nContent:\n{content[:chunk_limit]}\n")
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
        custom_block = ""
        if system_prompt and system_prompt.strip():
            custom_block = (
                "Additional user instructions (highest priority, follow them when answering):\n"
                f"{system_prompt.strip()}\n\n"
            )
        prompt = (
            "You are a helpful personal assistant that answers questions accurately based on the user's personal files and documents.\n"
            "Each source provides both file metadata (filename, file type, file size, date added/modified, path) and file content.\n\n"
            f"{custom_block}"
            f"{context_text}\n"
            f"User Question: {question}\n\n"
            "Instructions:\n"
            "1. Keep the answer super short: at most 2-3 short sentences, under 60 words. Give only the direct answer.\n"
            "2. Do not walk through sources one by one and do not repeat source headers, filenames, or page numbers in the answer body.\n"
            "3. Cite the source numbers inline (e.g. [Source 1]) when referencing details.\n"
            "4. If the user asks about file metadata (file size, when it was added/modified, file type), use the provided Metadata.\n"
            "5. If the answer cannot be determined from the context, clearly state that the information was not found in the indexed documents in one short sentence.\n"
            "6. Use plain text or minimal Markdown (bold only). No headings, lists, or tables unless the user explicitly asks for them.\n\n"
            "Answer:"
        )

        try:
            response = requests.post(
                f"{self.ollama_host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "keep_alive": "30m",
                    "options": {"num_ctx": NUM_CTX},
                },
                timeout=(3, 60),
            )
        except requests.RequestException as e:
            return {
                "answer": f"The local Gemma model is not reachable ({type(e).__name__}). Is Ollama running?",
                "sources": sources,
            }

        if response.status_code != 200:
            return {
                "answer": f"Error communicating with local Gemma model: {response.text}",
                "sources": sources,
            }

        return {
            "answer": read_answer(response),
            "sources": sources,
        }
