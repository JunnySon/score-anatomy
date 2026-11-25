#!/usr/bin/env python3
"""시험 자료 받기의 시험 서버(작업 지시서 4의 3-3). 이 맥의 기본 도구(python3 표준 라이브러리)만 쓴다.

테스트 전용 발행물(exam-data/testdata 의 네 폴더, 읽기만 함)을 127.0.0.1 에서 내주고, 받은 요청의 머리글을 받아 적고,
느린 응답, 큰 응답, 넘기는 응답(3xx), 끊김 같은 경우를 낼 수 있다. 단위 테스트와 화면 테스트가 쓴다(verify.sh 가 켜고 끈다).

  python3 ios/scripts/exam_server.py --testdata exam-data/testdata [--port 0] [--port-file 파일] [--log 파일]

주소(세션은 테스트마다 다른 이름을 쓴다):
  /s/<세션>/<경로>               세션의 설정대로 내준다(앱이 받는 주소는 http://127.0.0.1:<포트>/s/<세션>/).
  /control/ping                  살아 있는지.
  /control/<세션>/set?...        세션 설정. pub(발행물 폴더 이름), mode, only(이 경로에만 mode 를 씀), status, delay(초),
                                 target(넘길 주소), size(바이트). 주지 않은 값은 기본값으로 돌아간다.
  /control/<세션>/log            그 세션이 받은 요청(시각, 방법, 경로, 머리글 이름과 값 그대로)의 JSON.
  /control/<세션>/clear          받은 요청 기록을 비운다.
mode:
  normal     발행물 폴더의 파일을 바이트 그대로 내준다(없으면 404).
  status     status 상태로 답한다(본문은 짧은 글).
  redirect   302 와 Location: target 으로 답한다.
  slow       delay 초 뒤에 normal 로 답한다.
  trickle    머리글을 보낸 뒤 본문을 delay 초에 한 바이트씩 보낸다.
  biglength  길이 머리글을 size(기본 6MB)로 보내고 본문을 그만큼 보내려 한다.
  bigstream  길이 머리글 없이 size 바이트를 보내고 연결을 닫는다.
  cut        길이 머리글은 다 적고 본문을 반만 보낸 뒤 연결을 닫는다.
  gzip       파일을 gzip 으로 줄여 Content-Encoding: gzip 으로 보낸다.
  drop       아무 응답 없이 연결을 닫는다.
요청 기록에는 접속한 곳(주소, 포트)을 적지 않는다. 이 서버는 이 맥(127.0.0.1)에서만 열린다.
"""
import argparse
import gzip
import json
import os
import signal
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCK = threading.Lock()
SESSIONS = {}
REQUESTS = []
PUBLICATIONS = {"test-only-valid", "test-only-older-seq", "test-only-bad-signature", "test-only-changed-byte"}
DEFAULTS = {"pub": None, "mode": "normal", "only": None, "status": 404, "delay": 0.0, "target": None, "size": 6 * 1024 * 1024}
TESTDATA = None
LOG_FILE = None
CHUNK = 64 * 1024


def session(name):
    with LOCK:
        if name not in SESSIONS:
            SESSIONS[name] = {"config": dict(DEFAULTS), "log": []}
        return SESSIONS[name]


def write_log(line):
    if LOG_FILE is None:
        return
    with LOCK:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {line}\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "sa-exam-test-server"
    sys_version = ""

    def log_message(self, fmt, *args):  # noqa: A003
        # 기본 기록(접속한 곳을 적음)은 쓰지 않는다.
        return

    def send_plain(self, status, text, extra=None):
        body = (text + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.record("_other", parsed)
            return self.send_plain(400, "시험 서버의 주소가 달라요.")
        parts = parsed.path.split("/")
        try:
            if parsed.path == "/control/requests":
                with LOCK:
                    entries = list(REQUESTS)
                return self.send_json(entries)
            if parsed.path == "/control/ping":
                return self.send_plain(200, "ok")
            if len(parts) >= 4 and parts[1] == "control":
                return self.control(parts[2], parts[3], urllib.parse.parse_qs(parsed.query))
            if len(parts) >= 3 and parts[1] == "s" and parts[2]:
                return self.serve(parts[2], "/".join(parts[3:]), parsed)
            self.record("_other", parsed)
            return self.send_plain(404, "없어요.")
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def send_error(self, code, message=None, explain=None):
        # BaseHTTPRequestHandler가 지원하지 않는 메서드도 시험 서버의 전체 기록에 남긴다.
        if code == 501:
            self.record("_other", urllib.parse.urlsplit(self.path))
        super().send_error(code, message, explain)

    def do_HEAD(self):  # noqa: N802
        self.record("_other", urllib.parse.urlsplit(self.path))
        self.send_plain(405, "GET 만 받아요.", {"Allow": "GET"})

    do_POST = do_HEAD

    def record(self, name, parsed):
        entry = {
            "t": round(time.time(), 3),
            "method": self.command,
            "path": parsed.path,
            "query": parsed.query,
            "version": self.request_version,
            "headers": [[k, v] for k, v in self.headers.items()],
        }
        s = session(name)
        with LOCK:
            s["log"].append(entry)
            REQUESTS.append(entry)

    def control(self, name, action, query):
        s = session(name)
        if action == "set":
            config = dict(DEFAULTS)
            for key in ("pub", "mode", "only", "target"):
                if key in query:
                    config[key] = query[key][0]
            for key, cast in (("status", int), ("delay", float), ("size", int)):
                if key in query:
                    config[key] = cast(query[key][0])
            if config["pub"] is not None and config["pub"] not in PUBLICATIONS:
                return self.send_plain(400, "알려진 시험용 발행물을 골라 주세요.")
            with LOCK:
                s["config"] = config
            write_log(f"set {name} {config}")
            return self.send_json({"ok": True, "config": config})
        if action == "log":
            with LOCK:
                log = list(s["log"])
            return self.send_json(log)
        if action == "clear":
            with LOCK:
                s["log"] = []
            return self.send_json({"ok": True})
        return self.send_plain(404, "모르는 명령이에요.")

    def file_bytes(self, config, rest):
        if config["pub"] not in PUBLICATIONS or not rest:
            return None
        root = os.path.realpath(os.path.join(TESTDATA, config["pub"]))
        path = os.path.realpath(os.path.join(root, *rest.split("/")))
        if os.path.dirname(root) != TESTDATA or not path.startswith(root + os.sep) or not os.path.isfile(path):
            return None
        with open(path, "rb") as f:
            return f.read()

    def serve(self, name, rest, parsed):
        self.record(name, parsed)
        s = session(name)
        with LOCK:
            config = dict(s["config"])
        mode = config["mode"]
        if config["only"] and config["only"] != rest:
            mode = "normal"
        write_log(f"GET /s/{name}/{rest} mode={mode}")
        body = self.file_bytes(config, rest)
        if mode == "normal" or mode == "slow":
            if mode == "slow":
                time.sleep(config["delay"])
            if body is None:
                return self.send_plain(404, "없어요.")
            return self.send_body(body, rest)
        if mode == "cookie":
            return self.send_plain(200, "시험 응답", {"Set-Cookie": "fixture=one; Path=/", "Cache-Control": "public, max-age=600"})
        if mode == "auth":
            return self.send_plain(401, "인증이 필요해요.", {"WWW-Authenticate": 'Basic realm="test-only"'})
        if mode == "status":
            return self.send_plain(config["status"], f"상태 {config['status']}")
        if mode == "redirect":
            return self.send_plain(302, "넘겨요.", {"Location": config["target"] or "/"})
        if mode == "drop":
            self.close_connection = True
            return None
        if mode == "trickle":
            data = body if body is not None else b"x" * 1024
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            for i in range(len(data)):
                self.wfile.write(data[i:i + 1])
                self.wfile.flush()
                time.sleep(config["delay"])
            return None
        if mode == "biglength":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(config["size"]))
            self.end_headers()
            return self.stream(config["size"])
        if mode == "bigstream":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            if config["delay"] > 0:
                # 마지막 바이트만 늦춘다. 클라이언트가 본문 끝까지 기다렸는지 시험할 수 있다.
                self.stream(max(0, config["size"] - 1))
                time.sleep(config["delay"])
                self.stream(1)
            else:
                self.stream(config["size"])
            self.close_connection = True
            return None
        if mode == "cut":
            data = body if body is not None else b"x" * 4096
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data[: len(data) // 2])
            self.wfile.flush()
            self.close_connection = True
            return None
        if mode == "gzip":
            if body is None:
                return self.send_plain(404, "없어요.")
            packed = gzip.compress(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(packed)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(packed)
            return None
        return self.send_plain(500, f"모르는 mode: {mode}")

    def send_body(self, body, rest):
        self.send_response(200)
        kind = "application/json; charset=utf-8" if rest.endswith(".json") else "text/plain; charset=utf-8"
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def stream(self, size):
        sent = 0
        filler = b"x" * CHUNK
        while sent < size:
            n = min(CHUNK, size - sent)
            self.wfile.write(filler[:n])
            sent += n
        self.wfile.flush()


def main():
    global TESTDATA, LOG_FILE
    parser = argparse.ArgumentParser(description="시험 자료 받기의 시험 서버")
    parser.add_argument("--testdata", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--port-file")
    parser.add_argument("--log")
    args = parser.parse_args()
    TESTDATA = os.path.realpath(args.testdata)
    LOG_FILE = args.log
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    port = server.server_address[1]
    if args.port_file:
        with open(args.port_file + ".tmp", "w", encoding="utf-8") as f:
            f.write(str(port))
        os.replace(args.port_file + ".tmp", args.port_file)
    write_log(f"시작 127.0.0.1:{port} testdata={TESTDATA}")
    print(f"시험 서버: http://127.0.0.1:{port}/ (testdata {TESTDATA})", flush=True)

    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever()
    write_log("끝")
    return 0


if __name__ == "__main__":
    sys.exit(main())
