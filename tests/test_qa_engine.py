"""Prompt size stays inside num_ctx, and a bad Ollama body gives a friendly answer.

Run: .venv/bin/python -m unittest tests.test_qa_engine -v
"""
import unittest
from unittest import mock

import qa_engine


class _Reply:
    status_code = 200
    text = "<html>oops</html>"

    def __init__(self, body=None):
        self.body = body

    def json(self):
        if self.body is None:
            raise ValueError("not json")
        return self.body


def _docs(count, chars):
    return [{"filename": f"{i}.txt", "path": f"/d/{i}.txt", "content": "x" * chars, "metadata": {}} for i in range(count)]


class QAEngineTest(unittest.TestCase):
    def _ask(self, docs, reply):
        with mock.patch.object(qa_engine.requests, "post", return_value=reply) as post:
            result = qa_engine.QAEngine().generate_answer("what is in these files?", docs, system_prompt="be brief")
        return result, post.call_args.kwargs["json"]["prompt"]

    def test_prompt_fits_the_context_window(self):
        _, prompt = self._ask(_docs(8, 20000), _Reply({"response": "ok"}))
        self.assertLess(len(prompt), (qa_engine.NUM_CTX - qa_engine.RESERVED_TOKENS // 2) * qa_engine.CHARS_PER_TOKEN)

    def test_short_chunks_are_sent_whole(self):
        _, prompt = self._ask(_docs(2, 120), _Reply({"response": "ok"}))
        self.assertIn("x" * 120, prompt)

    def test_non_json_reply_gives_a_friendly_answer(self):
        result, _ = self._ask(_docs(1, 50), _Reply())
        self.assertEqual(result["answer"], qa_engine.UNREADABLE_REPLY)
        self.assertEqual(len(result["sources"]), 1)

    def test_unexpected_json_shape_gives_a_friendly_answer(self):
        result, _ = self._ask(_docs(1, 50), _Reply(["not", "a", "dict"]))
        self.assertEqual(result["answer"], qa_engine.UNREADABLE_REPLY)


if __name__ == "__main__":
    unittest.main()
