import io
import json
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import launch
from launch import (
    CineVaultHandler,
    cache_tmdb_poster,
    delete_tmdb_token,
    find_available_port,
    parse_arguments,
    parse_xlsx_rows,
    read_tmdb_token,
    save_tmdb_token,
    tmdb_request,
)


class XlsxImportTests(unittest.TestCase):
    def test_reads_first_sheet_with_inline_strings(self):
        workbook = """<?xml version="1.0" encoding="UTF-8"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets><sheet name="Films" sheetId="1" r:id="rId1"/></sheets>
        </workbook>""".encode("utf-8")
        relationships = """<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1"
            Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
            Target="worksheets/sheet1.xml"/>
        </Relationships>""".encode("utf-8")
        sheet = """<?xml version="1.0" encoding="UTF-8"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1">
              <c r="A1" t="inlineStr"><is><t>Название</t></is></c>
              <c r="B1" t="inlineStr"><is><t>Год</t></is></c>
            </row>
            <row r="2">
              <c r="A2" t="inlineStr"><is><t>Начало</t></is></c>
              <c r="B2"><v>2010</v></c>
            </row>
          </sheetData>
        </worksheet>""".encode("utf-8")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook)
            archive.writestr("xl/_rels/workbook.xml.rels", relationships)
            archive.writestr("xl/worksheets/sheet1.xml", sheet)

        rows = parse_xlsx_rows(buffer.getvalue())
        self.assertEqual(rows, [{"Название": "Начало", "Год": "2010"}])


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


class TmdbTests(unittest.TestCase):
    TOKEN = "test-token-that-is-long-enough-for-validation"

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.data_root_patch = mock.patch.object(
            launch,
            "DATA_ROOT",
            Path(self.temporary_directory.name),
        )
        self.data_root_patch.start()

    def tearDown(self):
        self.data_root_patch.stop()
        self.temporary_directory.cleanup()

    def test_token_is_stored_outside_browser_database(self):
        save_tmdb_token(self.TOKEN)
        self.assertEqual(read_tmdb_token(), self.TOKEN)
        delete_tmdb_token()
        self.assertIsNone(read_tmdb_token())

    def test_tmdb_request_uses_bearer_token_and_russian_query(self):
        captured = {}

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return io.BytesIO(b'{"results": []}')

        result = tmdb_request(
            "/search/movie",
            params={"query": "Начало", "language": "ru-RU"},
            token=self.TOKEN,
            opener=opener,
        )

        self.assertEqual(result, {"results": []})
        self.assertIn("language=ru-RU", captured["request"].full_url)
        self.assertEqual(
            captured["request"].get_header("Authorization"),
            f"Bearer {self.TOKEN}",
        )
        self.assertEqual(captured["timeout"], 12)

    def test_poster_is_cached_under_local_data_root(self):
        def opener(request, timeout):
            self.assertIn("image.tmdb.org", request.full_url)
            self.assertEqual(timeout, 20)
            return io.BytesIO(b"poster-bytes")

        url = cache_tmdb_poster(27205, "/poster.jpg", opener=opener)

        self.assertEqual(url, "/media/posters/tmdb-27205.jpg")
        self.assertEqual(
            (launch.DATA_ROOT / "posters" / "tmdb-27205.jpg").read_bytes(),
            b"poster-bytes",
        )


if __name__ == "__main__":
    unittest.main()
