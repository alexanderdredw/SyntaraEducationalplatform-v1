"""Минимальный HTTP-сервис проверки макросов (BR-FILE-03, SM-FILE).

POST /scan — тело запроса: байты файла; ответ: {"macros": bool, "suspicious": bool}.
GET /health — проверка готовности.
Сервис не хранит файлы: анализ выполняется в памяти.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from oletools.olevba import VBA_Parser

MAX_BYTES = 25 * 1024 * 1024  # BR-FILE-02: материалы до 25 МБ


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"code": "NOT_FOUND"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/scan":
            self._send(404, {"code": "NOT_FOUND"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BYTES:
            self._send(413, {"code": "PAYLOAD_TOO_LARGE"})
            return
        content = self.rfile.read(length)
        try:
            parser = VBA_Parser("upload", data=content)
            # olevba разбирает любой текст как исходник VBA; TXT/CSV не могут содержать исполняемых макросов.
            macros = parser.type != "Text" and bool(parser.detect_vba_macros())
            suspicious = macros and any(kw[0] in ("AutoExec", "Suspicious") for kw in parser.analyze_macros())
            parser.close()
        except Exception:  # неизвестный формат — макросов нет
            macros, suspicious = False, False
        self._send(200, {"macros": macros, "suspicious": suspicious})

    def log_message(self, *_args) -> None:  # не пишем имена/содержимое файлов в журнал
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
