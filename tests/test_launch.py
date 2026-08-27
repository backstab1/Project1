import json
import threading
import unittest
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer

from launch import (
    CineVaultHandler,
    find_available_port,
    parse_arguments,
)


class LauncherTests(unittest.TestCase):
    def test_parses_launch_options(self):
        options = parse_arguments(["--port", "8765", "--no-browser"])
        self.assertEqual(options.port, 8765)
        self.assertTrue(options.no_browser)

    def test_health_endpoint(self):
        server = ThreadingHTTPServer(
            ("127.0.0.1", find_available_port(19000)),
            partial(CineVaultHandler),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/api/health",
                timeout=3,
            ) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(json.load(response), {"status": "ok"})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


class StaticOnlyTests(unittest.TestCase):
    """Лаунчер отдаёт статику и здоровье, и больше ничего.

    Прокси TMDB и кэш постеров переехали на сервер: токен стал секретом Edge
    Function, а картинки отдаёт CDN TMDB. Проверяем, что старые адреса не
    остались случайно.
    """

    def setUp(self):
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", find_available_port(19100)),
            partial(CineVaultHandler),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def get(self, path: str) -> int:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{self.server.server_port}{path}", timeout=3
            ) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    def test_tmdb_endpoints_are_gone(self):
        self.assertEqual(self.get("/api/tmdb/status"), 404)
        self.assertEqual(self.get("/api/tmdb/search?query=%D0%94%D1%8E%D0%BD%D0%B0"), 404)
        self.assertEqual(self.get("/media/posters/tmdb-27205.jpg"), 404)

    def test_index_is_served(self):
        self.assertEqual(self.get("/index.html"), 200)


if __name__ == "__main__":
    unittest.main()
