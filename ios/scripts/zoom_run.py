"""부록 A 3-1의 확대 실험과 같은 기기의 WebKit 로그를 함께 남겨요."""

import argparse
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import time


PREDICATE = 'subsystem == "com.apple.WebKit" AND category == "ViewGestures"'


def run_to_file(command, path, **options):
    with path.open("wb") as log:
        return subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, **options).returncode


def stop_stream(process):
    if process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    return process.wait()


def entry_count(path):
    count = 0
    with path.open(encoding="utf-8", errors="replace") as lines:
        for line in lines:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and row.get("subsystem") == "com.apple.WebKit" and row.get("category") == "ViewGestures":
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("udid", help="이번 진단용으로 만든 시뮬레이터의 UDID")
    parser.add_argument("cases", help="A,C,D 또는 B처럼 쉼표로 나눈 실험")
    parser.add_argument("out", type=Path, help="새 결과 폴더")
    parser.add_argument("derived", type=Path, help="테스트 빌드 폴더")
    parser.add_argument("--first", type=int, choices=range(1, 11), default=1, help="첫 경우를 이어 측정할 시작 회차")
    parser.add_argument("--built", action="store_true", help="준비한 Debug 테스트 빌드를 사용해요")
    parser.add_argument("--device", default="iphone16", help="기록에 쓸 기기 이름")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    sim = ["xcrun", "simctl"]
    status = {"udid": args.udid, "cases": args.cases, "start": time.time()}
    path = out / "status.json"

    def save():
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(path)

    status["bootExit"] = run_to_file(sim + ["bootstatus", args.udid, "-b"], out / "boot.log")
    save()
    if status["bootExit"]:
        return status["bootExit"]

    ios = Path(__file__).resolve().parents[1]
    xcode = [
        "xcodebuild", "-project", str(ios / "ScoreAnatomy.xcodeproj"), "-scheme", "ScoreAnatomy",
        "-configuration", "Debug", "-destination", "platform=iOS Simulator,id=" + args.udid,
        "-derivedDataPath", str(args.derived.resolve()), "-parallel-testing-enabled", "NO",
        "-resultBundlePath", str(out / "zoom.xcresult"),
        "-only-testing:ScoreAnatomyUITests/ZoomDiagnosticsTests/testZoomDiagnostics",
        "-test-timeouts-enabled", "YES", "-default-test-execution-time-allowance", "3600",
        "-maximum-test-execution-time-allowance", "3600",
    ]
    if args.built:
        xcode.append("test-without-building")
    else:
        xcode.extend(["OTHER_LDFLAGS=$(inherited) -Wl,-S", "test"])
    env = dict(os.environ, TEST_RUNNER_SA_OUT=str(out), TEST_RUNNER_SA_DEVICE=args.device,
               TEST_RUNNER_SA_ZOOM_CASES=args.cases, TEST_RUNNER_SA_ZOOM_FIRST=str(args.first))
    log = sim + ["spawn", args.udid, "log"]
    raw = out / "viewgestures.ndjson"
    status["streamStart"] = time.time()
    with raw.open("wb") as rows, (out / "stream-errors.log").open("wb") as errors:
        stream = subprocess.Popen(log + ["stream", "--style", "ndjson", "--level", "debug",
                                         "--predicate", PREDICATE], stdout=rows, stderr=errors)
        try:
            time.sleep(1)
            status["streamAliveAtStart"] = stream.poll() is None
            save()
            status["xcodeExit"] = run_to_file(xcode, out / "xcode.log", env=env)
        finally:
            status["streamAliveAtEnd"] = stream.poll() is None
            status["streamEnd"] = time.time()
            status["streamExit"] = stop_stream(stream)
            save()
    status["streamEntries"] = entry_count(raw)
    if not status["streamEntries"] or not status["streamAliveAtEnd"]:
        minutes = math.ceil((status["streamEnd"] - status["streamStart"]) / 60) + 1
        history = out / "viewgestures-show.ndjson"
        with history.open("wb") as rows, (out / "show-errors.log").open("wb") as errors:
            status["showExit"] = subprocess.run(
                log + ["show", "--style", "ndjson", "--info", "--debug",
                       "--last", f"{minutes}m", "--predicate", PREDICATE],
                stdout=rows, stderr=errors,
            ).returncode
        status["showEntries"] = entry_count(history)
    status["end"] = time.time()
    save()
    return status["xcodeExit"]


if __name__ == "__main__":
    raise SystemExit(main())
