"""Serve the built site locally.

    python serve.py                 # serves the site folder on http://localhost:8000 with COOP/COEP headers
    python serve.py 9000            # another port
    python serve.py --no-coi        # omit the headers, to mimic GitHub Pages
"""
import http.server, socketserver, sys, os
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
COI = "--no-coi" not in sys.argv
PORT = int(args[0]) if args else 8000
ROOT = Path(__file__).resolve().parent  # 사이트가 이 스크립트와 같은 폴더에 있다(dist 없이)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True  # 빠른 재시작(TIME_WAIT 무시)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
                      ".onnx": "application/octet-stream", ".json": "application/json"}

    def end_headers(self):
        if COI:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass
    # 원본과 달리: 로그를 조용히 두는 대신 stderr에 한 줄만 남긴다.


if __name__ == "__main__":
    os.chdir(ROOT)
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"layaAgent-ko(Ollama판): http://localhost:{PORT}/  (Ctrl+C로 종료)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
