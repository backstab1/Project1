from __future__ import annotations

import argparse
import contextlib
import http.server
import json
import socket
import sys
import threading
import webbrowser
from pathlib import Path


HOST = "127.0.0.1"
DEFAULT_PORT = 7432
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


class CineVaultHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/api/health":
            self._send_json(200, {"status": "ok"})
            return
        super().do_GET()

    def _send_json(self, status: int, value: object) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def find_available_port(start: int = DEFAULT_PORT, attempts: int = 20) -> int:
    for port in range(start, start + attempts):
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            if sock.connect_ex((HOST, port)) != 0:
                return port
    raise RuntimeError("Не удалось найти свободный локальный порт для CineVault.")


def parse_arguments(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Локальный сервер CineVault")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"первый порт для запуска (по умолчанию {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="не открывать браузер автоматически",
    )
    parser.add_argument(
        "--app",
        action="store_true",
        help="открыть сразу библиотеку, минуя стартовую страницу",
    )
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> None:
    options = parse_arguments(arguments)
    if not 1 <= options.port <= 65535:
        raise SystemExit("Порт должен находиться в диапазоне 1–65535.")

    port = find_available_port(options.port)
    server = http.server.ThreadingHTTPServer((HOST, port), CineVaultHandler)
    origin = f"http://{HOST}:{port}"
    # Приложение одно: витрина — его первый экран, библиотека — якорь #catalog.
    # Флаг --app пропускает витрину и открывает сразу каталог.
    url = f"{origin}/#catalog" if options.app else f"{origin}/"

    if not options.no_browser:
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
