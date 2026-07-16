from __future__ import annotations

import contextlib
import http.server
import socket
import threading
import webbrowser
from pathlib import Path


HOST = "127.0.0.1"
DEFAULT_PORT = 7432
ROOT = Path(__file__).resolve().parent


class CineVaultHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def find_available_port(start: int = DEFAULT_PORT, attempts: int = 20) -> int:
    for port in range(start, start + attempts):
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            if sock.connect_ex((HOST, port)) != 0:
                return port
    raise RuntimeError("Не удалось найти свободный локальный порт для CineVault.")


def main() -> None:
    port = find_available_port()
    server = http.server.ThreadingHTTPServer((HOST, port), CineVaultHandler)
    url = f"http://{HOST}:{port}/"

    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    print(f"CineVault запущен: {url}")
    print("Для остановки нажмите Ctrl+C.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

