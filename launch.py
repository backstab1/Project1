from __future__ import annotations

import argparse
import contextlib
import http.server
import io
import json
import mimetypes
import os
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from pathlib import Path
from xml.etree import ElementTree


HOST = "127.0.0.1"
DEFAULT_PORT = 7432
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
DATA_ROOT = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "CineVault"
TMDB_API_ROOT = "https://api.themoviedb.org/3"
TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p/w500"
MAX_JSON_BODY = 64 * 1024
MAX_POSTER_BYTES = 8 * 1024 * 1024


class CineVaultHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        try:
            if self.path == "/api/tmdb/token":
                body = self._read_json_body()
                token = normalize_tmdb_token(body.get("token"))
                tmdb_request("/configuration", token=token)
                save_tmdb_token(token)
                self._send_json(200, {"configured": True})
                return

            if self.path == "/api/tmdb/poster":
                body = self._read_json_body()
                local_url = cache_tmdb_poster(
                    body.get("tmdbId"),
                    body.get("posterPath"),
                )
                self._send_json(200, {"url": local_url})
                return

            if self.path != "/api/import-xlsx":
                self.send_error(404)
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 20 * 1024 * 1024:
                raise ValueError("Некорректный или слишком большой XLSX-файл.")
            rows = parse_xlsx_rows(self.rfile.read(content_length))
            self._send_json(200, {"rows": rows})

        except (
            ValueError,
            KeyError,
            IndexError,
            zipfile.BadZipFile,
            ElementTree.ParseError,
        ) as error:
            self._send_json(400, {"error": str(error)})
        except TmdbAuthenticationError as error:
            self._send_json(401, {"error": str(error)})
        except TmdbUnavailableError as error:
            self._send_json(502, {"error": str(error)})

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                self._send_json(200, {"status": "ok"})
                return
            if parsed.path == "/api/tmdb/status":
                self._send_json(200, {"configured": bool(read_tmdb_token())})
                return
            if parsed.path == "/api/tmdb/search":
                query = urllib.parse.parse_qs(parsed.query)
                title = str(query.get("query", [""])[0]).strip()
                if not title:
                    raise ValueError("Введите название фильма для поиска.")
                params = {
                    "query": title,
                    "language": "ru-RU",
                    "include_adult": "false",
                    "page": "1",
                }
                year = str(query.get("year", [""])[0]).strip()
                if year:
                    params["primary_release_year"] = year
                result = tmdb_request("/search/movie", params=params)
                self._send_json(200, {"results": result.get("results", [])[:12]})
                return
            if parsed.path.startswith("/api/tmdb/movie/"):
                movie_id = validate_tmdb_id(parsed.path.rsplit("/", 1)[-1])
                result = tmdb_request(
                    f"/movie/{movie_id}",
                    params={"language": "ru-RU"},
                )
                self._send_json(200, result)
                return
            if parsed.path.startswith("/media/posters/"):
                self._serve_cached_poster(parsed.path.rsplit("/", 1)[-1])
                return
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except TmdbAuthenticationError as error:
            self._send_json(401, {"error": str(error)})
            return
        except TmdbUnavailableError as error:
            self._send_json(502, {"error": str(error)})
            return
        super().do_GET()

    def do_DELETE(self) -> None:
        if self.path != "/api/tmdb/token":
            self.send_error(404)
            return
        delete_tmdb_token()
        self._send_json(200, {"configured": False})

    def _read_json_body(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > MAX_JSON_BODY:
            raise ValueError("Некорректный размер JSON-запроса.")
        value = json.loads(self.rfile.read(content_length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Ожидался JSON-объект.")
        return value

    def _send_json(self, status: int, value: object) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_cached_poster(self, filename: str) -> None:
        safe_name = Path(filename).name
        if safe_name != filename or not safe_name:
            self.send_error(404)
            return
        path = DATA_ROOT / "posters" / safe_name
        if not path.is_file():
            self.send_error(404)
            return
        payload = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "image/jpeg")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        http.server.SimpleHTTPRequestHandler.end_headers(self)
        self.wfile.write(payload)


class TmdbAuthenticationError(RuntimeError):
    pass


class TmdbUnavailableError(RuntimeError):
    pass


def normalize_tmdb_token(value: object) -> str:
    token = str(value or "").strip()
    if len(token) < 20 or len(token) > 2048 or any(character.isspace() for character in token):
        raise ValueError("Укажите корректный TMDB API Read Access Token.")
    return token


def validate_tmdb_id(value: object) -> int:
    try:
        movie_id = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("Некорректный идентификатор TMDB.") from error
    if movie_id <= 0:
        raise ValueError("Некорректный идентификатор TMDB.")
    return movie_id


def read_tmdb_token() -> str | None:
    environment_token = os.environ.get("CINEVAULT_TMDB_TOKEN", "").strip()
    if environment_token:
        return environment_token
    path = DATA_ROOT / "tmdb.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        token = str(value.get("token", "")).strip()
        return token or None
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def save_tmdb_token(token: str) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    path = DATA_ROOT / "tmdb.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"token": normalize_tmdb_token(token)}, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary.replace(path)


def delete_tmdb_token() -> None:
    try:
        (DATA_ROOT / "tmdb.json").unlink()
    except FileNotFoundError:
        pass


def tmdb_request(
    path: str,
    params: dict[str, object] | None = None,
    token: str | None = None,
    opener=urllib.request.urlopen,
) -> dict:
    stored_token = token or read_tmdb_token()
    if not stored_token:
        raise TmdbAuthenticationError(
            "TMDB не настроен. Добавьте API Read Access Token в настройках."
        )
    access_token = normalize_tmdb_token(stored_token)
    query = urllib.parse.urlencode(params or {})
    url = f"{TMDB_API_ROOT}{path}{'?' + query if query else ''}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "CineVault/0.10",
        },
    )
    try:
        with opener(request, timeout=12) as response:
            value = json.load(response)
        if not isinstance(value, dict):
            raise TmdbUnavailableError("TMDB вернул неожиданный ответ.")
        return value
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise TmdbAuthenticationError("TMDB отклонил токен доступа.") from error
        raise TmdbUnavailableError(f"TMDB временно недоступен (HTTP {error.code}).") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise TmdbUnavailableError("Не удалось связаться с TMDB.") from error


def cache_tmdb_poster(
    tmdb_id: object,
    poster_path: object,
    opener=urllib.request.urlopen,
) -> str:
    movie_id = validate_tmdb_id(tmdb_id)
    normalized_path = str(poster_path or "").strip()
    filename = Path(normalized_path).name
    if (
        not normalized_path.startswith("/") or
        filename != normalized_path.lstrip("/") or
        Path(filename).suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp")
    ):
        raise ValueError("Некорректный путь постера TMDB.")

    extension = Path(filename).suffix.lower()
    target_name = f"tmdb-{movie_id}{extension}"
    poster_root = DATA_ROOT / "posters"
    poster_root.mkdir(parents=True, exist_ok=True)
    target = poster_root / target_name
    request = urllib.request.Request(
        f"{TMDB_IMAGE_ROOT}/{filename}",
        headers={"User-Agent": "CineVault/0.10"},
    )
    try:
        with opener(request, timeout=20) as response:
            content = response.read(MAX_POSTER_BYTES + 1)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        raise TmdbUnavailableError("Не удалось скачать постер TMDB.") from error
    if len(content) > MAX_POSTER_BYTES:
        raise ValueError("Постер TMDB слишком большой.")
    temporary = target.with_suffix(f"{extension}.tmp")
    temporary.write_bytes(content)
    temporary.replace(target)
    return f"/media/posters/{target_name}"


def find_available_port(start: int = DEFAULT_PORT, attempts: int = 20) -> int:
    for port in range(start, start + attempts):
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            if sock.connect_ex((HOST, port)) != 0:
                return port
    raise RuntimeError("Не удалось найти свободный локальный порт для CineVault.")


def parse_xlsx_rows(content: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared_strings = _read_shared_strings(archive)
        sheet_path = _find_first_sheet_path(archive)
        root = ElementTree.fromstring(archive.read(sheet_path))

    rows: list[list[str]] = []
    for row_element in root.findall(".//{*}sheetData/{*}row"):
        values: list[str] = []
        for cell in row_element.findall("{*}c"):
            column_index = _column_index(cell.get("r", "A1"))
            while len(values) <= column_index:
                values.append("")
            values[column_index] = _read_cell_value(cell, shared_strings)
        rows.append(values)

    if len(rows) < 2:
        raise ValueError("XLSX должен содержать заголовок и минимум одну строку.")

    headers = [value.strip() for value in rows[0]]
    if not any(headers):
        raise ValueError("Первая строка XLSX не содержит заголовков.")

    result = []
    for values in rows[1:]:
        record = {
            header: values[index] if index < len(values) else ""
            for index, header in enumerate(headers)
            if header
        }
        if any(str(value).strip() for value in record.values()):
            result.append(record)
    return result


def _read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    path = "xl/sharedStrings.xml"
    if path not in archive.namelist():
        return []
    root = ElementTree.fromstring(archive.read(path))
    return [
        "".join(node.text or "" for node in item.findall(".//{*}t"))
        for item in root.findall("{*}si")
    ]


def _find_first_sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    sheet = workbook.find(".//{*}sheets/{*}sheet")
    if sheet is None:
        raise ValueError("В XLSX нет листов.")

    relation_id = sheet.get(
        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    )
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    for relation in relationships.findall("{*}Relationship"):
        if relation.get("Id") == relation_id:
            target = relation.get("Target", "")
            normalized = target.lstrip("/")
            if not normalized.startswith("xl/"):
                normalized = f"xl/{normalized}"
            return normalized.replace("\\", "/")
    raise ValueError("Не удалось найти первый лист XLSX.")


def _read_cell_value(
    cell: ElementTree.Element,
    shared_strings: list[str],
) -> str:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//{*}t"))

    value_node = cell.find("{*}v")
    value = value_node.text if value_node is not None and value_node.text else ""
    if cell_type == "s" and value:
        index = int(value)
        return shared_strings[index] if index < len(shared_strings) else ""
    if cell_type == "b":
        return "да" if value == "1" else "нет"
    return value


def _column_index(reference: str) -> int:
    letters = "".join(character for character in reference if character.isalpha())
    result = 0
    for character in letters.upper():
        result = result * 26 + (ord(character) - ord("A") + 1)
    return max(0, result - 1)


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
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> None:
    options = parse_arguments(arguments)
    if not 1 <= options.port <= 65535:
        raise SystemExit("Порт должен находиться в диапазоне 1–65535.")

    port = find_available_port(options.port)
    server = http.server.ThreadingHTTPServer((HOST, port), CineVaultHandler)
    url = f"http://{HOST}:{port}/"

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
