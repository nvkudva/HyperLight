"""Text, image and audio encodes must never overlap: Metal aborts the process
when two threads run the model at once.

Run: .venv/bin/python -m unittest tests.test_embedder_lock -v
"""
import threading
import time
import unittest

import numpy
import PIL.Image

import embedder


class _OverlapDetectingModel:
    def __init__(self):
        self.active = 0
        self.overlapped = False
        self._guard = threading.Lock()

    def encode(self, inputs, **kwargs):
        with self._guard:
            self.active += 1
            if self.active > 1:
                self.overlapped = True
        time.sleep(0.05)
        with self._guard:
            self.active -= 1
        count = len(inputs) if isinstance(inputs, list) else 1
        return numpy.zeros((count, 4)) if isinstance(inputs, list) else numpy.zeros(4)


class EmbedderLockTest(unittest.TestCase):
    def test_text_and_image_encodes_do_not_overlap(self):
        emb = object.__new__(embedder.Embedder)
        emb.device = "cpu"
        emb.model = _OverlapDetectingModel()
        emb._model_lock = threading.Lock()
        image = PIL.Image.new("RGB", (8, 8))
        threads = [
            threading.Thread(target=emb.embed_texts, args=(["a", "b"],)),
            threading.Thread(target=emb.embed_image, args=(image,)),
            threading.Thread(target=emb.embed_audio, args=([0.0] * 16,)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertFalse(emb.model.overlapped)


if __name__ == "__main__":
    unittest.main()
