from __future__ import annotations

import argparse
import contextlib
import http.server
import io
import json
import socket
import sys
import threading
import webbrowser
import zipfile
from pathlib import Path
from xml.etree import ElementTree


HOST = "127.0.0.1"
DEFAULT_PORT = 7432
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


class CineVaultHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        if self.path != "/api/import-xlsx":
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 20 * 1024 * 1024:
                raise ValueError("Некорректный или слишком большой XLSX-файл.")
            rows = parse_xlsx_rows(self.rfile.read(content_length))
            payload = json.dumps(
                {"rows": rows},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        except (
            ValueError,
            KeyError,
            IndexError,
            zipfile.BadZipFile,
            ElementTree.ParseError,
        ) as error:
            payload = json.dumps(
                {"error": str(error)},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            payload = json.dumps(
                {"status": "ok"},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


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
