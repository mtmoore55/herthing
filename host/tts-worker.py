#!/usr/bin/env python3
"""Small localhost-only streaming Piper service for HerThing."""

import argparse
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from piper import PiperVoice


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8791)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="[tts-worker] %(message)s")
    logging.info("loading %s", args.model)
    voice = PiperVoice.load(args.model)
    lock = threading.Lock()
    logging.info("ready on http://%s:%d", args.host, args.port)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def do_POST(self):
            if self.path != "/synthesize":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 8192:
                self.send_error(400, "text body required")
                return
            text = self.rfile.read(length).decode("utf-8").strip()
            self.send_response(200)
            self.send_header("Content-Type", "audio/L16;rate=22050;channels=1")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with lock:
                for chunk in voice.synthesize(text):
                    self.wfile.write(chunk.audio_int16_bytes)
                    self.wfile.flush()

        def log_message(self, _format, *_args):
            return

    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
