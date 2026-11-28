#!/usr/bin/env python3
"""verify.sh 의 도우미. 테스트 결과를 읽고, 소스와 앱 꾸러미를 검사하고, docs/ios_검증결과.md 를 쓴다.

명령:
  xcresult <결과.xcresult> <출력.json>        테스트 결과 요약
  scan <ios 폴더> <저장소 폴더> <출력.json>   소스 검사(금지 문자, 네트워크 API, 권한, 사유 API)
  app <앱 폴더> <manifest.json> <종류> <출력.json>  앱 꾸러미 검사(종류: debug, release)
  captures <원본 폴더> <docs/screens-ios> <출력.json>  캡처 모으기와 빠진 것, 겹친 것 검사
  extras <runs 폴더> <docs/screens-ios/extra>    목록 밖 참고 캡처 모으기
  first034 <결과 폴더> <실행명> <기기> <버전>     다음 제스처 중단 여부 (초과 3, 판독 불가한 초과 신호 4)
  held-stop <실행 폴더>                      기존 누름 원본에서 다음 제스처 중단 여부 확인
  render <결과 폴더> <문서 경로>             docs/ios_검증결과.md 쓰기

작업 지시서 4(2부)에서 더한 것: 받는 쪽(ios/ScoreAnatomy/Remote) 검사. 껍데기가 통신하는 곳은 ReleaseFetcher.swift 한 파일뿐이어야 하고,
Release 앱에 테스트 전용 키와 App Transport Security 예외가 없어야 한다(17~22번).
"""
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import unicodedata

# 금지 문자는 글자 대신 코드 번호로 적는다(이 파일 자신이 검사에 걸리지 않게).
FORBIDDEN = {chr(c): f"U+{c:04X}" for c in (0x2014, 0x2013, 0x00B7, 0x318D, 0x30FB, 0x2027)}
EMOJI = re.compile("[" + chr(0x1F000) + "-" + chr(0x1FAFF) + chr(0x2600) + "-" + chr(0x27BF) + chr(0xFE0F) + "]")

# 껍데기 소스에 없어야 하는 네트워크 API(시험 코드는 대상이 아니다).
NETWORK_APIS = [
    r"\bURLSession\b", r"\bNSURLSession\b", r"\bNSURLConnection\b", r"\bURLRequest\b", r"\bNSURLRequest\b",
    r"\bimport Network\b", r"\bNWConnection\b", r"\bNWListener\b", r"\bNWPathMonitor\b", r"\bNWBrowser\b",
    r"\bCFStream", r"\bCFSocket", r"\bgetaddrinfo\b", r"\bsocket\(", r"\bSCNetworkReachability",
    r"\bWKWebsiteDataStore\.default\b", r"\bMultipeerConnectivity\b", r"\bCloudKit\b", r"\b(?:URLSessionWebSocketTask|URLSessionStreamTask|webSocketTask|streamTask)\b", r"\bNW[A-Z]\w*",
]
NOTIFICATION_APIS = [r"\bUNUserNotificationCenter\b", r"\bimport UserNotifications\b", r"registerForRemoteNotifications", r"requestAuthorization\("]
TRACKING_APIS = [r"\bATTrackingManager\b", r"\bAppTrackingTransparency\b", r"\bASIdentifierManager\b", r"\bAdSupport\b", r"\bSKAdNetwork\b"]
PERMISSION_APIS = [r"\bAVCaptureDevice\b", r"\bPHPhotoLibrary\b", r"\bCLLocationManager\b", r"\bCNContactStore\b", r"\bEKEventStore\b", r"\bCMMotionManager\b", r"\bLAContext\b", r"\brequestRecordPermission\b"]
# 사유를 적어야 하는 API(Apple 의 required reason API 목록에서 이 앱과 관련 있을 수 있는 이름).
REQUIRED_REASON = {
    "NSPrivacyAccessedAPICategoryUserDefaults": [r"\bUserDefaults\b", r"\bNSUserDefaults\b", r"@AppStorage"],
    "NSPrivacyAccessedAPICategoryFileTimestamp": [r"\bcreationDate\b", r"\bmodificationDate\b", r"contentModificationDate", r"\battributesOfItem\b", r"fileModificationDate", r"NSFileCreationDate", r"NSFileModificationDate", r"\bf?getattrlist", r"getattrlistbulk", r"getattrlistat", r"\bstat\(", r"\bfstat\(", r"\blstat\(", r"\bfstatat\(", r"creationDateKey", r"contentModificationDateKey", r"contentAccessDateKey", r"attributeModificationDateKey"],
    "NSPrivacyAccessedAPICategorySystemBootTime": [r"\bsystemUptime\b", r"\bmach_absolute_time\b"],
    "NSPrivacyAccessedAPICategoryDiskSpace": [r"volumeAvailableCapacity", r"volumeTotalCapacity", r"\bstatfs\(", r"\bfstatfs\(", r"\bstatvfs\(", r"\bfstatvfs\(", r"systemFreeSize", r"systemSize", r"NSFileSystemFreeSize", r"NSFileSystemSize"],
    "NSPrivacyAccessedAPICategoryActiveKeyboards": [r"\bactiveInputModes\b"],
}
# 바이너리에서 찾는 기호(앱 코드가 직접 부르는 것).
BINARY_SYMBOLS = {
    "network": ["_OBJC_CLASS_$_NSURLSession", "_OBJC_CLASS_$_NSURLConnection", "_nw_connection_create", "_nw_listener_create", "_socket", "_connect", "_getaddrinfo", "_CFSocketCreate", "_CFStreamCreatePairWithSocketToHost", "_$s10Foundation10URLSessionC"],
    "notification": ["_OBJC_CLASS_$_UNUserNotificationCenter"],
    "requiredReason": ["_OBJC_CLASS_$_NSUserDefaults", "_$s10Foundation12UserDefaultsC", "_stat", "_fstat", "_lstat", "_fstatat", "_getattrlist", "_fgetattrlist", "_getattrlistbulk", "_getattrlistat", "_mach_absolute_time", "_statfs", "_fstatfs", "_statvfs", "_fstatvfs"],
}
DEBUG_MARKERS = ["-SAStoreDir", "-SAProbe", "-SASeed", "-SAForceLoadFailure", "-SAEventLog", "__saEventLog", "shell-stats.json", "probe-network.json", "setInspectable:",
                 "-SAExamURL", "-SAExamKeyFile", "-SAExamInterval"]
# 껍데기가 통신하는 곳(작업 지시서 4의 3-3). 네트워크 API 는 이 파일에서만 쓴다.
NETWORK_ALLOWED_FILE = os.path.join("ios", "ScoreAnatomy", "Remote", "ReleaseFetcher.swift")
# Release 바이너리에서 받아들이는 네트워크 기호(URLSession). 소켓, Network 프레임워크 같은 다른 길은 여전히 0 이어야 한다.
ALLOWED_NETWORK_SYMBOLS = ("_OBJC_CLASS_$_NSURLSession", "_$s10Foundation10URLSessionC")


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)


# ---------------------------------------------------------------- xcresult

def cmd_xcresult(path, out, device=""):
    result = {"path": path, "ok": False, "tests": [], "summary": {}, "device": device}
    try:
        raw = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", path, "--format", "json"], capture_output=True, text=True, timeout=300)
        tree = json.loads(raw.stdout)
        summary_raw = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", path, "--format", "json"], capture_output=True, text=True, timeout=300)
        result["summary"] = json.loads(summary_raw.stdout) if summary_raw.stdout.strip() else {}
    except Exception as e:  # noqa: BLE001
        result["error"] = str(e)
        save(out, result)
        return

    def walk(node, suite):
        kind = node.get("nodeType")
        if kind == "Test Case":
            failures = []
            for child in node.get("children", []) or []:
                if child.get("nodeType") in ("Failure Message", "Skip Reason"):
                    failures.append(child.get("name", ""))
            result["tests"].append({
                "suite": suite,
                "name": node.get("name", "").replace("()", ""),
                "result": node.get("result"),
                "duration": node.get("durationInSeconds"),
                "messages": failures,
            })
            return
        name = node.get("name", suite) if kind == "Test Suite" else suite
        for child in node.get("children", []) or []:
            walk(child, name)

    for node in tree.get("testNodes", []):
        walk(node, "")
    result["ok"] = True
    save(out, result)


# ---------------------------------------------------------------- 소스 검사

def text_files(root, exts):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ("build", ".tools", "Web", "xcuserdata", ".git")]
        for name in files:
            if os.path.splitext(name)[1] in exts or name in exts:
                yield os.path.join(base, name)


def cmd_scan(ios_dir, repo_dir, out):
    shell_dir = os.path.join(ios_dir, "ScoreAnatomy")
    report = {"forbidden": [], "network": [], "networkAllowed": [], "notification": [], "tracking": [], "permissionApis": [], "requiredReason": {}, "httpLiterals": [], "visibleText": {}, "packages": [], "scanned": 0}

    # 금지 문자: 껍데기 소스와 리소스, 테스트, 스크립트, 설정, iOS 문서.
    targets = list(text_files(ios_dir, {".swift", ".plist", ".xcprivacy", ".json", ".yml", ".xcconfig", ".sh", ".py", ".md", ".pbxproj", ".xcscheme", ".strings"}))
    docs = os.path.join(repo_dir, "docs")
    targets += [os.path.join(docs, n) for n in sorted(os.listdir(docs)) if n.startswith("ios_") and n.endswith(".md")]
    for path in targets:
        try:
            text = open(path, encoding="utf-8").read()
        except Exception:
            continue
        report["scanned"] += 1
        for line_no, line in enumerate(text.splitlines(), 1):
            for ch, name in FORBIDDEN.items():
                if ch in line:
                    report["forbidden"].append({"file": os.path.relpath(path, repo_dir), "line": line_no, "char": name})

    # API 검사: 껍데기 소스(앱 타깃)만. DEBUG 전용 파일은 따로 표시한다.
    for path in text_files(shell_dir, {".swift"}):
        rel = os.path.relpath(path, repo_dir)
        debug_only = os.path.basename(path).startswith("Debug")
        code = strip_comments(open(path, encoding="utf-8").read())
        for key, patterns in (("network", NETWORK_APIS), ("notification", NOTIFICATION_APIS), ("tracking", TRACKING_APIS), ("permissionApis", PERMISSION_APIS)):
            for pattern in patterns:
                for m in re.finditer(pattern, code):
                    entry = {"file": rel, "api": m.group(0), "debugOnly": debug_only}
                    if key == "network" and unicodedata.normalize("NFC", rel) == NETWORK_ALLOWED_FILE and m.group(0) in ("URLSession", "URLRequest"):
                        report["networkAllowed"].append(entry)
                    else:
                        report[key].append(entry)
        for category, patterns in REQUIRED_REASON.items():
            for pattern in patterns:
                for m in re.finditer(pattern, code):
                    report["requiredReason"].setdefault(category, []).append({"file": rel, "api": m.group(0), "debugOnly": debug_only})
        for m in re.finditer(r"(?:https?|wss?)://[^\s\"'`)]*", code):
            report["httpLiterals"].append({"file": rel, "text": m.group(0)[:60], "debugOnly": debug_only})

    # 사용자에게 보이는 글자: 껍데기가 띄우는 안내문, 앱 이름.
    visible = []
    app_swift = open(os.path.join(shell_dir, "App", "ScoreAnatomyApp.swift"), encoding="utf-8").read()
    visible += re.findall(r'static let loadFailed = "([^"]*)"', app_swift)
    info = plistlib.load(open(os.path.join(shell_dir, "Info.plist"), "rb"))
    visible.append(info.get("CFBundleDisplayName", ""))
    report["visibleText"] = {
        "texts": visible,
        "exclamation": sum(t.count("!") for t in visible),
        "emoji": sum(len(EMOJI.findall(t)) for t in visible),
        "forbidden": sum(t.count(ch) for t in visible for ch in FORBIDDEN),
    }
    report["permissionKeys"] = sorted(k for k in info if re.match(r"^NS.*UsageDescription$", k))
    report["infoPlist"] = {k: info.get(k) for k in ("CFBundleDisplayName", "ITSAppUsesNonExemptEncryption", "UISupportedInterfaceOrientations", "LSRequiresIPhoneOS", "NSAppTransportSecurity", "SAExamBaseURL")}

    # 외부 패키지: Swift Package, CocoaPods, Carthage.
    pbx = open(os.path.join(ios_dir, "ScoreAnatomy.xcodeproj", "project.pbxproj"), encoding="utf-8").read()
    for marker in ("XCRemoteSwiftPackageReference", "XCLocalSwiftPackageReference", "packageProductDependencies = (\n\t\t\t\t", "Pods_"):
        if marker in pbx:
            report["packages"].append(marker.strip())
    for name in ("Package.swift", "Package.resolved", "Podfile", "Podfile.lock", "Cartfile"):
        for base, dirs, files in os.walk(ios_dir):
            dirs[:] = [d for d in dirs if d not in ("build", ".tools")]
            if name in files:
                report["packages"].append(os.path.relpath(os.path.join(base, name), repo_dir))

    # 웹 묶음 안의 바깥 링크(사람이 누르면 WebKit 이 미리 연결할 수 있다), 새 창, 자원 미리 연결 표시.
    bundle_links = {}
    for name in ("app-test", "app-release"):
        text = open(os.path.join(shell_dir, "Web", name, "index.html"), encoding="utf-8").read()
        bundle_links[name] = {
            "absoluteHref": len(re.findall(r"href\s*=\s*[\"']https?:", text)),
            "windowOpen": text.count("window.open"),
            "targetBlank": text.count("_blank"),
            "linkPreconnectTag": len(re.findall(r"<link[^>]+rel=[\"']?(?:preconnect|dns-prefetch|prefetch)", text)),
        }
    report["bundleLinks"] = bundle_links

    privacy = plistlib.load(open(os.path.join(shell_dir, "Resources", "PrivacyInfo.xcprivacy"), "rb"))
    report["privacyManifest"] = {
        "tracking": privacy.get("NSPrivacyTracking"),
        "trackingDomains": privacy.get("NSPrivacyTrackingDomains", []),
        "collected": privacy.get("NSPrivacyCollectedDataTypes", []),
        "accessedCategories": [t.get("NSPrivacyAccessedAPIType") for t in privacy.get("NSPrivacyAccessedAPITypes", [])],
    }
    # 커밋 메시지(이 브랜치에서 더한 것)의 금지 문자.
    try:
        log = subprocess.run(["git", "-C", repo_dir, "log", "origin/main..HEAD", "--format=%H%n%B%n---"], capture_output=True, text=True).stdout
        report["commitMessages"] = {"count": log.count("\n---"), "forbidden": sum(log.count(ch) for ch in FORBIDDEN)}
    except Exception as e:  # noqa: BLE001
        report["commitMessages"] = {"error": str(e)}
    save(out, report)


def strip_comments(code):
    # // 주석과 /* */ 주석을 지운다(글자 안의 // 는 남긴다: "http://" 같은 것을 찾으려고 줄 주석만 조심해서 지운다).
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
    lines = []
    for line in code.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("///") or stripped.startswith("//"):
            continue
        lines.append(line)
    return "\n".join(lines)


# ---------------------------------------------------------------- 앱 꾸러미 검사

def grep_bundle(app, needle):
    hits = []
    data = needle.encode("utf-8")
    for base, _, files in os.walk(app):
        for name in files:
            path = os.path.join(base, name)
            try:
                if data in open(path, "rb").read():
                    hits.append(os.path.relpath(path, app))
            except Exception:
                pass
    return hits


def macho_binaries(app):
    out = []
    for base, _, files in os.walk(app):
        for name in files:
            path = os.path.join(base, name)
            try:
                with open(path, "rb") as f:
                    magic = struct.unpack("<I", f.read(4))[0]
                if magic in (0xFEEDFACF, 0xCAFEBABE, 0xBEBAFECA):
                    out.append(path)
            except Exception:
                pass
    return out


def cmd_app(app, manifest_path, kind, out):
    manifest = load(manifest_path, {})
    report = {"kind": kind, "app": app, "exists": os.path.isdir(app)}
    if not report["exists"]:
        save(out, report)
        return
    report["folders"] = sorted(n for n in os.listdir(app) if os.path.isdir(os.path.join(app, n)))
    want = "app-test" if kind == "debug" else "app-release"
    other = "app-release" if kind == "debug" else "app-test"
    index = os.path.join(app, want, "index.html")
    report["bundle"] = want
    report["bundlePresent"] = os.path.isfile(index)
    report["otherBundlePresent"] = os.path.isdir(os.path.join(app, other))
    if report["bundlePresent"]:
        digest = hashlib.sha256(open(index, "rb").read()).hexdigest()
        report["sha256"] = digest
        report["sha256Matches"] = digest == manifest.get("files", {}).get(f"{want}/index.html", {}).get("sha256")
    report["testText"] = grep_bundle(app, "테스트 시작하기")
    report["debugMarkers"] = {m: grep_bundle(app, m) for m in DEBUG_MARKERS}
    report["privacyManifest"] = os.path.isfile(os.path.join(app, "PrivacyInfo.xcprivacy"))
    info = plistlib.load(open(os.path.join(app, "Info.plist"), "rb"))
    report["info"] = {k: info.get(k) for k in ("CFBundleDisplayName", "CFBundleShortVersionString", "CFBundleVersion", "CFBundleIdentifier", "MinimumOSVersion", "UIDeviceFamily", "DTSDKName", "DTXcode", "DTXcodeBuild", "DTPlatformVersion", "ITSAppUsesNonExemptEncryption")}
    report["permissionKeys"] = sorted(k for k in info if re.match(r"^NS.*UsageDescription$", k))
    report["versionMatchesManifest"] = info.get("CFBundleShortVersionString") == manifest.get("version")
    # 작업 지시서 4의 3-3: App Transport Security 예외, 받는 주소, 넣은 공개 키, 앱 안 모든 파일의 테스트 전용 키.
    report["ats"] = info.get("NSAppTransportSecurity")
    report["examBaseURL"] = info.get("SAExamBaseURL")
    key_file = os.path.join(app, "exam-public-key.txt")
    report["examKeyFileBytes"] = os.path.getsize(key_file) if os.path.isfile(key_file) else None
    scan = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "exam_key.py"), "selftest", app], capture_output=True, text=True)
    report["testKeyScan"] = {"exit": scan.returncode, "lines": scan.stdout.strip().splitlines()[-6:]}
    libs = []
    symbols = {}
    for binary in macho_binaries(app):
        rel = os.path.relpath(binary, app)
        otool = subprocess.run(["otool", "-L", binary], capture_output=True, text=True).stdout
        for line in otool.splitlines():
            line = line.strip()
            # 머리줄("파일:" 또는 "파일 (architecture arm64):")은 라이브러리가 아니다. 여러 아키텍처 바이너리는 머리줄이 여럿이다.
            if not line or line.endswith(":"):
                continue
            libs.append({"binary": rel, "lib": line.split(" (")[0], "weak": "weak" in line})
        undefined = subprocess.run(["nm", "-u", binary], capture_output=True, text=True).stdout.split()
        network_swift = sorted({u for u in undefined if u.startswith("_$s7Network")})
        symbols.setdefault("network", []).extend(f"{rel}: {u}" for u in network_swift)
        for group, names in BINARY_SYMBOLS.items():
            found = sorted({n for n in names for u in undefined if u == n or u.startswith(n) and n.endswith("C")})
            if found:
                symbols.setdefault(group, []).extend(f"{rel}: {n}" for n in found)
    for entry in libs:
        if "/Network.framework/" in entry["lib"]:
            symbols.setdefault("network", []).append(entry["binary"] + ": " + entry["lib"])
    report["linkedLibraries"] = libs
    report["nonSystemLibraries"] = sorted({l["lib"] for l in libs if not (l["lib"].startswith("/System/") or l["lib"].startswith("/usr/lib/"))})
    report["swiftWebKit"] = sorted({l["binary"] for l in libs if "libswiftWebKit" in l["lib"]})
    report["symbols"] = symbols
    save(out, report)


# ---------------------------------------------------------------- 캡처

SCREENS = ["01-시작", "02-시험선택", "03-답입력-키패드", "04-잠금", "05-입력확인", "06-표시", "07-점수해부", "08-계단", "09-기록"]
THEMES = ["light", "dark"]
DEVICES = {"iphone17": (1206, 2622), "iphonese": (750, 1334)}
WEB_MATCH = {
    "01-시작": "01-시작", "02-시험선택": "04-시험선택", "03-답입력-키패드": "08-답입력-키패드-객관식", "04-잠금": "10-답입력-키패드-잠금",
    "05-입력확인": "17-입력확인", "06-표시": "22-표시-붙임", "07-점수해부": "27-점수해부-2등급", "08-계단": "32-계단", "09-기록": "43-기록",
}


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def cmd_captures(src, dest, out):
    report = {"expected": [], "missing": [], "duplicates": [], "wrongSize": [], "copied": 0, "extra": []}
    hashes = {}
    for device, size in DEVICES.items():
        for theme in THEMES:
            for screen in SCREENS:
                rel = f"{device}/{theme}/{screen}.png"
                report["expected"].append(rel)
                source = os.path.join(src, device, theme, f"{screen}.png")
                if not os.path.isfile(source):
                    report["missing"].append(rel)
                    continue
                target = os.path.join(dest, device, theme, f"{screen}.png")
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.copyfile(source, target)
                report["copied"] += 1
                digest = hashlib.sha256(open(target, "rb").read()).hexdigest()
                hashes.setdefault(digest, []).append(rel)
                w, h = png_size(target)
                if (w, h) != size:
                    report["wrongSize"].append({"file": rel, "size": [w, h], "expected": list(size)})
    report["duplicates"] = [names for names in hashes.values() if len(names) > 1]
    # 목록 밖의 캡처(기록용): 다른 테스트가 남긴 것.
    for base, _, files in os.walk(src):
        for name in files:
            rel = os.path.relpath(os.path.join(base, name), src)
            if rel not in report["expected"] and name.endswith(".png"):
                report["extra"].append(rel)
    save(out, report)


def cmd_extras(runs_dir, dest):
    """목록(9화면 x 2테마 x 2기기) 밖의 캡처를 기기와 테마를 붙여 모은다.
    Foundation 이 쓴 파일 이름은 한글이 풀어 쓴 형태(NFD)일 수 있어 NFC 로 맞춰 견준다."""
    import unicodedata
    names = {unicodedata.normalize("NFC", n) for n in SCREENS}
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)
    copied = []
    for base, _, files in os.walk(runs_dir):
        parts = base.split(os.sep)
        if "screens" not in parts:
            continue
        rest = parts[parts.index("screens") + 1:]
        if len(rest) != 2:
            continue
        device, theme = rest
        for name in sorted(files):
            if not name.endswith(".png"):
                continue
            stem = unicodedata.normalize("NFC", name[:-4])
            if stem in names:
                continue
            target = unicodedata.normalize("NFC", f"{device}-{theme}-{stem}.png")
            shutil.copyfile(os.path.join(base, name), os.path.join(dest, target))
            copied.append(target)
    print(json.dumps({"extras": copied}, ensure_ascii=False))


# ---------------------------------------------------------------- 문서

def tests_of(results, suite=None):
    if not results or not results.get("ok"):
        return []
    return [t for t in results["tests"] if suite is None or t["suite"] == suite]


def count(tests, status):
    return sum(1 for t in tests if t["result"] == status)


def fmt_tests(tests):
    if not tests:
        return "결과 없음"
    return f"{len(tests)}개 중 통과 {count(tests, 'Passed')}, 실패 {count(tests, 'Failed')}, 건너뜀 {count(tests, 'Skipped')}"


def all_passed(tests, minimum):
    return len(tests) >= minimum and count(tests, "Passed") == len(tests)


def metrics(out_dir):
    rows = []
    for name in ("metrics.jsonl",):
        for device in os.listdir(os.path.join(out_dir, "runs")) if os.path.isdir(os.path.join(out_dir, "runs")) else []:
            path = os.path.join(out_dir, "runs", device, name)
            if os.path.isfile(path):
                for line in open(path, encoding="utf-8"):
                    line = line.strip()
                    if line:
                        try:
                            rows.append(json.loads(line))
                        except Exception:
                            pass
    return rows


FIRST034 = (("first034-16-18", "iphone16", "ios18Runtime"), ("first034-16-26", "iphone16", "mainRuntime"),
            ("first034-17-26", "iphone17", "mainRuntime"))
FIRST034_CASES = ("A", "Gkey", "Ggrade", "F", "mark-triple", "key-triple")


def first034_results(out_dir, label, device, version):
    folder = Path(out_dir) / "runs" / label / "zoom034"
    results = {case: Counter() for case in FIRST034_CASES}
    gaps, failures = [], []
    expected = {f"{case}-{n:02d}" for case in FIRST034_CASES for n in range(1, 11)}
    files = sorted([*folder.glob("*.json"), *folder.glob("*.pending")])
    missing = expected - {path.stem for path in files if path.suffix == ".json"}
    if missing:
        gaps.append(f"완성 원본 {60-len(missing)}/60")
    stop = 0
    for path in files:
        row = load(path)
        if not isinstance(row, dict):
            gaps.append(f"{path.name} 읽기 실패")
            if path.suffix == ".pending":
                stop = 4 if stop != 3 else 3
            continue
        # 누락된 끝 상태나 중복 파일이 있더라도 이미 저장한 초과 원본을 먼저 판정한다.
        events = row.get("events", [])
        try:
            case = row["case"]
            downs, entered, key_presses = Counter(), Counter(), Counter()
            over = []
            for event in events:
                kind, target = event["type"], event.get("target")
                if kind == "observed-down":
                    if target:
                        downs[target] += 1
                    control = event.get("control", "")
                    if control.startswith("key:") and control[4:].isdigit() and event.get("trusted") is True:
                        key_presses[control[4:]] += 1
                elif kind == "accepted-click" and target:
                    entered[target] += 1
                    if entered[target] > downs[target]:
                        over.append(event["now"])
            answers = row.get("answers")
            answer_case = case in ("Gkey", "key-triple")
            stored = Counter(str(v) for v in answers.values()) if answer_case and isinstance(answers, dict) else None
            extras = (stored - key_presses) if stored is not None else None
            if over or extras:
                stop = 3
                kinds = ", ".join(k for k, hit in (("DOM", over), ("저장 답", extras)) if hit)
                failures.append(f"{path.name} {kinds} 초과 입력")
            elif (row.get("elementOver") is True or path.suffix == ".pending") and stop != 3:
                stop = 4
                gaps.append(f"{path.name} 초과 신호와 원본 불일치")

            if (row["device"] != device or row["os"] != version or row["trial"] not in range(1, 11)
                    or path.stem not in expected or path.stem != f"{case}-{row['trial']:02d}" or path.suffix != ".json"):
                gaps.append(f"{path.name} 장치, 조건, 번호 또는 파일 형식 불일치")
                continue
            counts = results[case]
            counts["rows"] += 1
            counts["over"] += bool(over or extras)
            taps = 3 if case.endswith("-triple") else 2
            target, native = (("key:3", "button:3") if answer_case else
                              ("grade:1", "button:1등급") if case == "Ggrade" else ("mark:3", "mark-cell:3"))
            physical = [e for e in events if e["type"] == "pointerdown"]
            observed = [e for e in events if e["type"] == "observed-down"]
            touches = [e for e in events if e["type"] == "touchstart"]
            mousedown = sum(e["type"] == "observed-mousedown" and e.get("defaultPrevented") is True for e in events)
            presses = sum(e.get("control") == target for e in observed)
            inputs = sum(e["type"] == "accepted-click" and e.get("control") == target for e in events)
            counts[f"inputs-{inputs}"] += 1
            before, after = (row[k]["scale"] for k in ("before", "after"))
            scales = [before, after] + [e["scale"] for e in events if e["type"] == "viewport-resize"]
            if not all(type(s) in (int, float) and math.isfinite(s) and s > 0 for s in scales):
                raise ValueError("배율 증거 없음")
            peak = max(scales)
            zoom = peak > before
            counts["scaleRows"] += 1
            counts["zoom"] += zoom
            if zoom:
                failures.append(f"{path.name} 확대 {before:g} -> {peak:g}")
            counts["less"] += inputs < presses
            expected_end = str(taps) if answer_case else "grade-1" if case == "Ggrade" else "none" if taps == 3 else "guess"
            wrong_end = row["endState"] != expected_end
            if answer_case and isinstance(answers, dict):
                wrong_end |= any(answers.get(str(n)) != 3 for n in range(1, taps+1))
            counts["wrongEnd"] += wrong_end
            agree = (row.get("completeEvidence") is True and row.get("preparationDowns") == []
                     and len(physical) == row["physicalDowns"] == len(observed) == row["expectedPresses"] == taps
                     and [e["target"] for e in physical] == row["nativePointerDownTargets"]
                     and physical[0]["target"] == native and all(e.get("trusted") is True and e.get("pointerType") == "touch" for e in physical)
                     and len(touches) == taps and all(e.get("trusted") is True and e.get("touches") == 1 for e in touches)
                     and all(e.get("trusted") is True for e in observed)
                     and observed[0]["control"] == row["firstDownTarget"] == row["intended"] == target
                     and dict(downs) == row["pressedByElement"] and dict(entered) == row["enteredByElement"]
                     and inputs == row["targetEntered"] and presses == row["targetPresses"]
                     and row["domElementOver"] is bool(over) and row["overAt"] == over
                     and row["elementOver"] is bool(over or extras) and row["zoomed"] is zoom
                     and math.isclose(row["peakScale"], peak, abs_tol=1e-5) and row["expectedEndState"] == expected_end
                     and row["wrongEnd"] is wrong_end
                     and sum(t.get("what") == "touch-mousedown" for t in row["trace"]) == row["touchMousedown"] == mousedown)
            if case == "F" and len(physical) >= 2:
                gap = physical[1]["now"] - physical[0]["now"]
                # Swift는 실측 간격을 0.1ms 단위로 기록한다.
                agree = agree and gap >= 0 and math.isclose(row["gapMs"], gap, rel_tol=0, abs_tol=0.050001)
            if answer_case:
                agree = (agree and stored is not None and all(type(v) is int for v in answers.values())
                         and str(len(answers)) == row["endState"] and dict(key_presses) == row["answerPressesByValue"]
                         and dict(stored) == row["storedAnswersByValue"] and dict(extras) == row["storedExcessByValue"]
                         and row["storedAnswerOver"] is bool(extras))
            if not agree:
                gaps.append(f"{path.name} 원본 증거 부족 또는 요약 불일치")
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
            gaps.append(f"{path.name} 원본 판독 실패 ({error})")
            if (row.get("elementOver") is True or path.suffix == ".pending") and stop != 3:
                stop = 4
    return results, failures, gaps, stop


def held_stop(run):
    folder = Path(run)
    signal = folder / "input-over.json"
    confirmed, unreadable = [], []
    for path in sorted((folder / "held").glob("*.txt")):
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            unreadable.append(path.name)
            continue
        # 배율과 끝 상태 차이는 중단 이유가 아니다. 먼저 같은 DOM 요소에 들어온 입력과 누름을 시간순으로 센다.
        downs, clicks = Counter(), Counter()
        for line in raw.splitlines():
            parts = line.split(maxsplit=6)
            if len(parts) != 7 or parts[1] not in ("observed-down", "accepted-click"):
                continue
            element = parts[6].partition(" [대상 ")[0]
            if not element or element.startswith("[대상 "):
                continue
            if parts[1] == "observed-down":
                downs[element] += 1
            else:
                clicks[element] += 1
                if clicks[element] > downs[element]:
                    confirmed.append(path.name)
                    break
        else:
            # 답 키 저장 수까지 반영한 Trial.entered와 원본 pointerdown 수도 비교한다.
            entered = re.search(r"^끝 상태: .* 받아들인 누름 (\d+),", raw, re.MULTILINE)
            physical = len(re.findall(r"^[0-9.]+\s+pointerdown\s", raw, re.MULTILINE))
            if entered and int(entered[1]) > physical:
                confirmed.append(path.name)
    if signal.exists():
        proof = load(signal, {})
        if not isinstance(proof, dict) or proof.get("file") not in confirmed:
            unreadable.append(signal.name + "의 초과 원본 확인하지 못함")
    return confirmed, unreadable


def held_result(out_dir, rows, env, held18, held26):
    # (회수, 실제 누름, 테스트 이름). 결과 요약과 중간에 저장한 원본이 모두 맞아야 한다.
    groups = {
        "marks": (32, 2, "testMarkCellSpacedDoubleTaps"),
        "key": (32, 2, "testAnswerKeySpacedDoubleTaps"),
        "anatomy": (32, 2, "testAnatomySameSpotSpacedDoubleTaps"),
        "triple": (10, 3, "testTripleTapsOnMarkCell"),
        "double-first": (10, 2, "testDoubleTapAsFirstTouchAfterLaunch"),
        "triple-first": (10, 3, "testTripleTapAsFirstTouchAfterLaunch"),
        "key-double-first": (10, 2, "testDoubleTapAnswerKeyAsFirstTouch"),
        "key-triple-first": (10, 3, "testTripleTapAnswerKeyAsFirstTouch"),
    }
    missing, failures, details = [], [], []
    if env.get("gestureStop"):
        details.append(f"{env['gestureStop']} 실행 뒤 제스처 중단. 이후 기기와 Release 화면 테스트는 미실행")
    for folder, os_prefix, device, suite in (("held18", "18.4", "iphone16", held18), ("held26", "26.4", "iphone17", held26)):
        confirmed, unreadable = held_stop(Path(out_dir) / "runs" / folder)
        failures.extend(f"{folder}/{name} 원본 초과 입력" for name in confirmed)
        missing.extend(f"{folder}/{name} 원본 판독 실패" for name in unreadable)
        tests = tests_of(suite, "HeldDoubleTapTests")
        if str(env.get(folder + "Exit")) not in ("None", "0") or any(t["result"] == "Failed" for t in tests):
            failures.append(f"{folder} XCTest {fmt_tests(tests)}, 종료 코드 {env.get(folder + 'Exit')}")
        if str(env.get(folder + "Exit")) != "0":
            missing.append(folder + " 완료 기록")
        runtime = lambda r: (str(r.get("os")) == os_prefix or str(r.get("os")).startswith(os_prefix + "."))
        for slug, (n, expected, name) in groups.items():
            title = f"{folder}/{slug}"
            completed = [r for r in pick(rows, "held", device=device, slug=slug) if runtime(r)]
            trials = [r for r in pick(rows, "heldTrial", device=device, slug=slug) if runtime(r)]
            for r in trials:
                pressed, entered = r.get("pressedByElement"), r.get("enteredByElement")
                if not isinstance(pressed, dict) or not isinstance(entered, dict):
                    missing.append(f"{title} {r.get('index')}회 요소별 기록")
                    continue
                if r.get("over") is True or any(v > pressed.get(k, 0) for k, v in entered.items()):
                    failures.append(f"{title} {r.get('index')}회 초과 입력")
            if any(r.get("zoom") != 0 for r in completed):
                failures.append(title + " 요약에 확대 0회 미확인")
            if any(r.get("over", 0) > 0 for r in completed):
                failures.append(title + " 요약에 초과 입력")
            if len(completed) != 1 or completed[0].get("trials") != n or not all_passed([t for t in tests if t["name"] == name], 1):
                missing.append(title + " 완료/횟수")
            if sorted(r.get("index", 0) for r in trials) != list(range(1, n + 1)):
                missing.append(f"{title} 원본 {len(trials)}/{n}회")
            for r in trials:
                filename = f"{device}-ios{r.get('os')}-{slug}-{r.get('index', 0):02d}.txt"
                path = os.path.join(out_dir, "runs", folder, "held", filename)
                try:
                    with open(path, encoding="utf-8") as timeline:
                        raw = timeline.read()
                except (OSError, UnicodeError):
                    raw = ""
                scales = re.search(r"^배율 (\S+) -> ([^,]+),", raw, re.MULTILINE)
                observed_scales = []
                try:
                    before, after = (float(s) for s in scales.groups()) if scales else (0, 0)
                    observed_scales = [float(s) for s in re.findall(r"^[0-9.]+\s+viewport-resize scale (\S+)$", raw, re.MULTILINE)]
                    peak = max([before, after, *observed_scales])
                except ValueError:
                    before, after, peak = 0, 0, 0
                if not (all(math.isfinite(s) and s > 0 for s in [before, after, *observed_scales])
                        and before == r.get("before") and after == r.get("after") and peak == r.get("peakScale")):
                    missing.append(f"{title} {r.get('index')}회 원본 배율 증거")
                elif peak > before:
                    failures.append(f"{title} {r.get('index')}회 확대 {before:g} -> {peak:g}")
                # Swift가 남긴 요약, 껍데기의 가공 전 pointerdown, DOM 속성으로 식별한 실제 버튼을 따로 확인한다.
                # 둘째, 셋째 누름은 확대나 스크롤로 다른 데에 닿을 수 있다.
                if slug == "anatomy":
                    intended, raw_target = "grade:1", "button:1등급"
                elif slug == "key" or slug.startswith("key-"):
                    intended, raw_target = "key:3", "button:3"
                else:
                    no = ((r.get("index", 0) - 1) % 16 + 1) if slug == "marks" else 3
                    intended, raw_target = f"mark:{no}", f"mark-cell:{no}"
                first_down = re.search(r"^[0-9.]+\s+pointerdown\s[^\n]*", raw, re.MULTILINE)
                first_observed = re.search(r"^[0-9.]+\s+observed-down\s[^\n]*", raw, re.MULTILINE)
                if (r.get("intended") != intended or r.get("firstDownTarget") != intended or
                        not first_down or not first_down.group().rstrip().endswith(" " + raw_target) or
                        not first_observed or not first_observed.group().rstrip().endswith(f" [대상 {intended}]")):
                    missing.append(f"{title} {r.get('index')}회 첫 누름 대상 {intended} 확인하지 못함")
                downs = len(re.findall(r"^[0-9.]+\s+pointerdown\s", raw, re.MULTILINE))
                observed = len(re.findall(r"^[0-9.]+\s+observed-down\s", raw, re.MULTILINE))
                if (r.get("file") != filename or r.get("presses") != expected or r.get("observed") != expected or
                        downs != expected or observed != expected or min(r.get("before", -1), r.get("after", -1)) <= 0):
                    missing.append(f"{title} {r.get('index')}회 증거 누락")
        details.append(f"{folder} {fmt_tests(tests)}")
    for label, device, runtime_key in FIRST034:
        version = env.get(runtime_key)
        counts, zoom_failures, gaps, _ = first034_results(out_dir, label, device, version)
        bundle = Path(out_dir) / (label + ".xcresult")
        summary = load(Path(out_dir) / f"ui-{label}.json", {})
        tests = tests_of(summary)
        totals = summary.get("summary", {})
        destinations = [c.get("device", {}) for c in totals.get("devicesAndConfigurations", [])]
        model = {"iphone16": "iPhone 16", "iphone17": "iPhone 17"}[device]
        correct_device = (len(destinations) == 1 and destinations[0].get("modelName") == model
                          and destinations[0].get("osVersion") == version)
        if (str(env.get(label + "Exit")) != "0" or not bundle.is_dir() or summary.get("path") != str(bundle)
                or totals.get("result") != "Passed" or totals.get("passedTests") != 1 or not correct_device
                or len(tests) != 1 or tests[0]["suite"] != "ZoomDiagnosticsTests"
                or tests[0]["name"] != "testWeb034FirstGestures" or tests[0]["result"] != "Passed"):
            target_list = zoom_failures if any(t["result"] == "Failed" for t in tests) else gaps
            target_list.append(f"전용 XCTest {fmt_tests(tests)}, 종료 코드 {env.get(label + 'Exit')}")
        failures.extend(f"{label}/{s}" for s in zoom_failures)
        missing.extend(f"{label}/{s}" for s in gaps)
        for case, c in counts.items():
            distribution = ", ".join(f"{k[7:]}개 {v}회" for k, v in sorted(c.items()) if k.startswith("inputs-"))
            details.append(f"{label}/{case} 원본 {c['rows']}/10, 확대 {c['zoom']}/{c['scaleRows']}, 초과 {c['over']}/{c['rows']}, "
                           f"대상 입력 분포 {distribution or '미확인'}, 실제 누름보다 적은 입력 {c['less']}회, 끝 상태 차이 {c['wrongEnd']}회")
    status = "실패" if failures else "확인하지 못함" if missing else "통과"
    return status, ". ".join(details + failures + missing) + ". 시도별 기록: " + env.get("heldPath", "docs/ios_누름기록/verify")


def cmd_render(out_dir, doc_path):
    env = load(os.path.join(out_dir, "meta.json"), {})
    captures_path = env.get("capturesPath", "docs/screens-ios")
    held_path = env.get("heldPath", "docs/ios_누름기록/verify")
    scan = load(os.path.join(out_dir, "scan.json"), {})
    debug_app = load(os.path.join(out_dir, "app-debug.json"), {})
    release_app = load(os.path.join(out_dir, "app-release.json"), {})
    unit = load(os.path.join(out_dir, "unit.json"), {})
    unit18 = load(os.path.join(out_dir, "unit18.json"), {})
    main_ui = load(os.path.join(out_dir, "ui-main.json"), {})
    live = load(os.path.join(out_dir, "ui-live.json"), {})
    se_ui = load(os.path.join(out_dir, "ui-se.json"), {})
    ipad_ui = load(os.path.join(out_dir, "ui-ipad.json"), {})
    ios18_ui = load(os.path.join(out_dir, "ui-ios18.json"), {})
    held18_ui = load(os.path.join(out_dir, "ui-held18.json"), {})
    held26_ui = load(os.path.join(out_dir, "ui-held26.json"), {})
    caps = load(os.path.join(out_dir, "captures.json"), {})
    rows = metrics(out_dir)
    audit = load(os.path.join(out_dir, "runs", "main", "accessibility-audit-iphone17.json"), [])
    items = []

    def add(no, title, status, numbers, criteria):
        items.append({"no": no, "title": title, "status": status, "numbers": numbers, "criteria": criteria})

    # 1 빌드
    rel_ok = bool(release_app.get("exists") and release_app.get("bundlePresent") and not release_app.get("otherBundlePresent") and release_app.get("sha256Matches") and not release_app.get("testText") and not any(release_app.get("debugMarkers", {}).values()) and not release_app.get("swiftWebKit") and not release_app.get("nonSystemLibraries") and release_app.get("versionMatchesManifest"))
    dbg_control = bool(debug_app.get("exists") and debug_app.get("bundlePresent") and debug_app.get("testText") and any(debug_app.get("debugMarkers", {}).values()))
    warnings_ok = str(env.get("debugWarnings")) == "0" and str(env.get("releaseWarnings")) == "0"
    sync_ok = env.get("projectInSync") == "yes"
    build_ok = env.get("debugBuild") == "ok" and env.get("releaseBuild") == "ok" and rel_ok and dbg_control and warnings_ok and sync_ok and env.get("manifestSha") == "yes"
    markers_hit = sum(len(v) for v in release_app.get("debugMarkers", {}).values())
    add(1, "빌드(Debug, Release, 시뮬레이터)", "통과" if build_ok else "실패",
        f"Xcode {env.get('xcodeVersion', '?')}(빌드 {env.get('xcodeBuild', '?')}), SDK {env.get('sdk', '?')}. Debug {env.get('debugBuild')}, 컴파일러 경고 {env.get('debugWarnings')}개. Release {env.get('releaseBuild')}, 컴파일러 경고 {env.get('releaseWarnings')}개(도구 안내 줄 {env.get('toolNotes', '?')}줄은 경고가 아니라 따로 셈). Release 앱: 시험용 묶음 {'있음' if release_app.get('otherBundlePresent') else '없음'}, '테스트 시작하기' {len(release_app.get('testText', []))}건, DEBUG 표식 {markers_hit}건, libswiftWebKit 연결 {len(release_app.get('swiftWebKit', []))}건, 시스템 밖 라이브러리 {len(release_app.get('nonSystemLibraries', []))}개, 묶음 SHA-256 {'일치' if release_app.get('sha256Matches') else '불일치'}, 버전 {release_app.get('info', {}).get('CFBundleShortVersionString')}({'manifest 와 같음' if release_app.get('versionMatchesManifest') else 'manifest 와 다름'}). 대조로 Debug 앱에는 '테스트 시작하기' {len(debug_app.get('testText', []))}건, DEBUG 표식 {sum(len(v) for v in debug_app.get('debugMarkers', {}).values())}건이 있다. 커밋된 프로젝트 파일과 project.yml {('일치' if sync_ok else '불일치: ' + str(env.get('projectInSync')))}. manifest 의 SHA-256 {'일치' if env.get('manifestSha') == 'yes' else '불일치'}(묶음: {env.get('manifestInfo', '?')}). 기기용 컴파일(서명 없음) {env.get('deviceBuild', '?')}",
        "두 빌드 성공, 컴파일러 경고 0, Release 안의 시험용 묶음과 DEBUG 표식 0건(Debug 에서는 찾아져야 검사가 맞다), 프로젝트 파일이 project.yml 과 같음")

    # 2 단위
    unit_tests = tests_of(unit)
    unit18_tests = tests_of(unit18)
    units_ok = str(env.get("unitExit")) == "0" and str(env.get("unit18Exit")) == "0"
    add(2, "단위 테스트", "통과" if units_ok and all_passed(unit_tests, 92) and all_passed(unit18_tests, 92) else "실패", f"iOS {env.get('mainRuntime')} {fmt_tests(unit_tests)}, iOS {env.get('ios18Runtime')} {fmt_tests(unit18_tests)}", "각각 92개 이상 실행, 실패 0, 건너뜀 0(받는 쪽 50개 포함, 17번)")

    main_tests = tests_of(main_ui)

    def suite(name, tests=None):
        return [t for t in (tests if tests is not None else main_tests) if t["suite"] == name]

    flow = suite("FlowTests")
    add(3, "화면 흐름(예시 시험 A, iPhone 17)", "통과" if all_passed(flow, 1) else "실패", fmt_tests(flow) + flow_numbers(rows), "1개 통과(78점, 7점, 8점, 3~7점, 약 75점, 6~10점, 3등급 문구, 계단 3개와 카드 표기 확인)")

    restart = suite("RestartTests")
    add(4, "다시 켜기", "통과" if all_passed(restart, 2) else "실패", fmt_tests(restart) + restart_numbers(rows), "2개 통과(12번까지 이어서 보기, 채점 기록 유지)")

    rhythm = suite("RhythmTests")
    add(5, "사람 손 박자", "통과" if all_passed(rhythm, 3) and no_fill_in_rhythm(rows) else "실패", fmt_tests(rhythm) + rhythm_numbers(rows), "3개 통과, 실제 누름 간격이 보호 시간 0.5초보다 짧음, 채운 누름 0개")

    net = suite("NetworkProbeTests")
    pm = scan.get("privacyManifest", {})
    found_reason = sum(len(v) for v in scan.get("requiredReason", {}).values())
    release_reason_symbols = release_app.get("symbols", {}).get("requiredReason", [])
    info = scan.get("infoPlist", {})
    http_release = [h for h in scan.get("httpLiterals", []) if not h.get("debugOnly")]
    net_symbols = release_app.get("symbols", {}).get("network", [])
    other_net_symbols = [s for s in net_symbols if not any(s.split(": ")[-1].startswith(a) for a in ALLOWED_NETWORK_SYMBOLS)]
    static_ok = bool(scan) and bool(release_app) and not scan.get("network") and bool(scan.get("networkAllowed")) and not scan.get("notification") and not scan.get("tracking") and not scan.get("permissionApis") \
        and not scan.get("packages") and not scan.get("permissionKeys") and not release_app.get("permissionKeys") and release_app.get("privacyManifest") \
        and pm.get("tracking") is False and not pm.get("trackingDomains") and not pm.get("collected") and len(pm.get("accessedCategories", [])) == found_reason == 0 \
        and not release_reason_symbols and not other_net_symbols and not release_app.get("symbols", {}).get("notification") \
        and info.get("ITSAppUsesNonExemptEncryption") is False and info.get("UISupportedInterfaceOrientations") == ["UIInterfaceOrientationPortrait"] and not http_release \
        and info.get("NSAppTransportSecurity") is None and release_app.get("ats") is None \
        and all(sum(v.values()) == 0 for v in scan.get("bundleLinks", {"x": {"missing": 1}}).values())
    add(6, "통신과 권한", "통과" if all_passed(net, 2) and static_ok else "실패",
        fmt_tests(net) + network_numbers(rows) + (" 소스 검사 결과가 없다." if not scan else f" 정적 검사: 허용하지 않은 네트워크 API {len(scan.get('network', []))}건(ReleaseFetcher.swift의 URLSession, URLRequest {len(scan.get('networkAllowed', []))}건: {', '.join(sorted({n['api'] for n in scan.get('networkAllowed', [])}))}), 외부 패키지 {len(scan.get('packages', []))}개, 권한 문구 {len(scan.get('permissionKeys', []))}개(Release Info.plist {len(release_app.get('permissionKeys', []))}개), 알림 API {len(scan.get('notification', []))}건, 추적 API {len(scan.get('tracking', []))}건, 권한이 필요한 기기 API {len(scan.get('permissionApis', []))}건, DEBUG 밖 소스의 http(s) 주소 글자 {len(http_release)}건, Release 바이너리의 네트워크 기호 {len(net_symbols)}건(URLSession 말고 {len(other_net_symbols)}건), App Transport Security 예외(소스 Info.plist, Release 앱) {'없음' if info.get('NSAppTransportSecurity') is None and release_app.get('ats') is None else '있음'}, 웹 묶음 안의 바깥 링크와 새 창과 미리 연결 표시 {sum(sum(v.values()) for v in scan.get('bundleLinks', {}).values())}건. PrivacyInfo.xcprivacy {'있음' if release_app.get('privacyManifest') else '없음'}(추적 {pm.get('tracking')}, 추적 도메인 {len(pm.get('trackingDomains', []))}개, 수집 자료 {len(pm.get('collected', []))}개, 사유 API 선언 {len(pm.get('accessedCategories', []))}개). 소스에서 찾은 사유 API 이름 {found_reason}건, Release 바이너리의 사유 API 기호 {len(release_reason_symbols)}건. Info.plist: 암호화 사용 {info.get('ITSAppUsesNonExemptEncryption')}, 방향 {info.get('UISupportedInterfaceOrientations')}"),
        "웹뷰 탐침 2개 통과(차단 0건 도달, 대조 1건 이상 도달), 네트워크 API 는 ReleaseFetcher.swift 에서만(작업 지시서 4), 그 밖의 정적 검사 모두 0, Release 바이너리의 네트워크 기호는 URLSession 뿐, ATS 예외 없음, 개인정보 매니페스트 있음(추적 없음, 수집 없음), 찾은 사유 API 와 선언이 같음(둘 다 0), 암호화 사용 NO, 세로 고정")

    font = suite("FontScaleUITests")
    live_tests = tests_of(live)
    font_ok = all_passed([t for t in font if t["name"] != "testLiveChangeIsSentToWeb"], 4) and all_passed(live_tests, 1)
    add(7, "글자 크기", "통과" if font_ok else "실패", fmt_tests([t for t in font if t["name"] != "testLiveChangeIsSentToWeb"]) + f", 켜 둔 채 바꾸기 {fmt_tests(live_tests)}" + font_numbers(rows), "4개 통과(기본, 가장 큰 일반 크기, 접근성 크기 둘), 켜 둔 채 바꾸기 1개 통과")

    se_tests = tests_of(se_ui)
    se_flow = suite("FlowTests", se_tests)
    se_small = suite("SmallScreenTests", se_tests)
    if env.get("seSimulator") != "ok":
        add(8, "작은 화면(iPhone SE 3세대)", "확인하지 못함", f"시뮬레이터를 만들지 못함: {env.get('seSimulator')}", "SE 에서 3번 흐름과 작은 화면 검사 통과")
    else:
        add(8, "작은 화면(iPhone SE 3세대)", "통과" if all_passed(se_flow, 1) and all_passed(se_small, 1) else "실패", f"흐름 {fmt_tests(se_flow)}, 작은 화면 {fmt_tests(se_small)}" + small_numbers(rows), "흐름 1개와 작은 화면 1개 통과")

    ipad = suite("StartScreenTests", tests_of(ipad_ui))
    if env.get("ipadSimulator") != "ok":
        add(9, "iPad(아이폰 앱 호환 방식)", "확인하지 못함", f"시뮬레이터를 만들지 못함: {env.get('ipadSimulator')}", "시작 화면이 뜬다")
    else:
        add(9, "iPad(아이폰 앱 호환 방식)", "통과" if all_passed(ipad, 1) else "실패", f"{env.get('ipadName', '')}: " + fmt_tests(ipad) + ipad_numbers(rows), "시작 화면 테스트 1개 통과")

    # 10 최소 버전: 작업 지시서 4의 3-1 에서 최소 버전을 iOS 18.0 으로 올렸다. 이 맥의 iOS 18 런타임(18.4)으로 돌려 판정에 넣는다.
    ref = tests_of(ios18_ui)
    if env.get("ios18Runtime"):
        min_ok = str(env.get("unit18Exit")) == "0" and all_passed(unit18_tests, 92) and all_passed(suite("FlowTests", ref), 1) and all_passed(suite("RestartTests", ref), 2) and all_passed(suite("FastTapTests", ref), 16) and all_passed(suite("RemoteFetchTests", ref), 5)
        add(10, "최소 버전(iOS 18)", "통과" if min_ok else "실패",
            f"iOS {env.get('ios18Runtime')}(iPhone 16): 단위 {fmt_tests(unit18_tests)}, 흐름 {fmt_tests(suite('FlowTests', ref))}, 다시 켜기 {fmt_tests(suite('RestartTests', ref))}, 빠른 누름 {fmt_tests(suite('FastTapTests', ref))}, 받기 화면 {fmt_tests(suite('RemoteFetchTests', ref))}. iOS 18.0~18.3: 이 맥에 런타임이 없어 확인하지 못함",
            "이 맥의 iOS 18 런타임에서 흐름 1, 다시 켜기 2, 빠른 누름 16, 받기 화면 5개 통과(18.0~18.3 은 확인하지 못함으로 적음)")
    else:
        add(10, "최소 버전(iOS 18)", "확인하지 못함", "iOS 18 런타임이 이 맥에 없다.", "이 맥의 iOS 18 런타임에서 흐름, 다시 켜기, 빠른 누름, 받기 화면 통과")

    vis = scan.get("visibleText", {})
    commits = scan.get("commitMessages", {})
    forb_ok = bool(scan) and not scan.get("forbidden") and vis.get("exclamation") == 0 and vis.get("emoji") == 0 and vis.get("forbidden") == 0 and commits.get("forbidden") == 0
    add(11, "금지 문자", "통과" if forb_ok else "실패", f"검사한 파일 {scan.get('scanned')}개에서 금지 문자 {len(scan.get('forbidden', []))}건. 보이는 글자({', '.join(vis.get('texts', []))}) 느낌표 {vis.get('exclamation')}, 이모지 {vis.get('emoji')}. 이 브랜치 커밋 메시지 {commits.get('count', '?')}개의 금지 문자 {commits.get('forbidden', '?')}건", "모두 0")

    audit_tests = suite("AccessibilityAuditTests")
    ran = [a for a in audit if a.get("ran")]
    issues = sum(len(a.get("issues", [])) for a in audit)
    per_screen = ", ".join(f"{a.get('screen')} {len(a.get('issues', []))}" for a in audit)
    add(12, "접근성 감사(기록용)", "통과" if all_passed(audit_tests, 1) and len(ran) == 4 else "실패",
        f"{fmt_tests(audit_tests)}. 감사한 화면 {len(ran)}개, 걸린 것 {issues}건({per_screen}). 지난번(웹 묶음 0.3.1, 2026-11-24) 30건(시작 7, 답 입력 4, 점수 해부 7, 계단 12)",
        "네 화면 모두 감사를 돌리고 걸린 것을 기록(통과가 접근성을 보장하지 않음)")

    main_dark = tests_of(load(os.path.join(out_dir, "ui-main-dark.json"), {}))
    se_dark = tests_of(load(os.path.join(out_dir, "ui-se-dark.json"), {}))
    cap_tests = suite("CaptureTests") + suite("CaptureTests", main_dark) + suite("CaptureTests", se_tests) + suite("CaptureTests", se_dark)
    cap_ok = bool(caps) and not caps.get("missing") and not caps.get("duplicates") and not caps.get("wrongSize") and all_passed(cap_tests, 4)
    add(13, "캡처", "통과" if cap_ok else "실패", f"목록 {len(caps.get('expected', []))}장 중 {caps.get('copied', 0)}장, 빠진 것 {len(caps.get('missing', []))}, 겹친 것 {len(caps.get('duplicates', []))}, 크기 다름 {len(caps.get('wrongSize', []))}. 캡처 테스트 {fmt_tests(cap_tests)}", "9화면 x 2테마 x 2기기 = 36장, 빠진 것과 겹친 것 0")

    bridge = suite("BridgeIntegrationTests")
    start = suite("StartScreenTests")
    keyboard = suite("KeyboardInputTests")
    release_smoke = suite("ReleaseSmokeTests", tests_of(load(os.path.join(out_dir, "ui-release.json"), {})))
    extra_ok = all_passed(bridge, 4) and all_passed(start, 1) and all_passed(keyboard, 1) and all_passed(release_smoke, 1)
    add(14, "추가: 다리 통합, 글 입력, Release 실행", "통과" if extra_ok else "실패",
        f"다리 통합(보관, 더 높은 version, 저장 실패, 불러오기 실패) {fmt_tests(bridge)}. 시작 화면(iPhone 17) {fmt_tests(start)}. 진행자용 화면의 키보드 글 입력 {fmt_tests(keyboard)}. Release 구성으로 켜기 {fmt_tests(release_smoke)}",
        "모두 통과. 13개 항목 밖이지만 판정과 종료 코드에 넣는다")

    # 15 배포용 묶음의 모양(작업 지시서 3-2의 3-3)
    look_debug = suite("LookTests")
    look_release = suite("LookTests", tests_of(load(os.path.join(out_dir, "ui-release-look.json"), {})))
    compare = load(os.path.join(out_dir, "look", "compare.json"), {})
    look_screens = compare.get("screens", [])
    look_ok = all_passed(look_debug, 1) and all_passed(look_release, 1) and len(look_screens) == 9 and not compare.get("problems")
    only_debug = sorted({x for sc in look_screens for x in sc.get("onlyDebug", [])})
    add(15, "추가: Release 와 Debug 의 화면 모양(3-3)", "통과" if look_ok else "실패",
        f"Debug {fmt_tests(look_debug)}, Release {fmt_tests(look_release)}. 견준 화면 {len(look_screens)}개, 화면 전체(기록 화면은 Debug 전용 목록의 12pt 위까지) 화소 차이(채널 8 넘음) {sum(sc.get('fullDiffPixels', 0) for sc in look_screens)}화소, 자리가 다른 요소 {sum(len(sc.get('positionDiffs', [])) for sc in look_screens)}개, 화소를 견준 요소 {sum(sc.get('pixelCompared', 0) for sc in look_screens)}개, "
        f"크기가 다른 요소 {sum(len(sc.get('sizeDiffs', [])) for sc in look_screens)}개, 모양이 다른 요소 {sum(len(sc.get('pixelDiffs', [])) for sc in look_screens)}개, Release 에만 있는 요소 {sum(len(sc.get('onlyRelease', [])) for sc in look_screens)}개. "
        f"Debug 에만 있는 요소: {', '.join(only_debug) if only_debug else '없음'}. 문제: {'; '.join(compare.get('problems', [])) or '없음'}",
        "8화면(기록 화면은 맨 위와 맨 아래 둘)을 같은 누름으로 가서 찍고, 달라도 되는 곳(기록 화면의 준비 중인 기능 목록과 진행자용 링크)만 다름")

    # 16 웹에서 고친 것(결정기록 7.6, 작업 지시서 3-2의 3-4)
    fast = suite("FastTapTests")
    fix = suite("WebFixScreenTests")
    se_fix = suite("WebFixScreenTests", se_tests)
    fast_ok = all_passed(fast, 16) and all_passed(fix, 6) and all_passed(se_fix, 1)
    if env.get("seSimulator") != "ok":
        fast_status = "확인하지 못함"
    else:
        fast_status = "통과" if fast_ok else "실패"
    add(16, "추가: 웹에서 고친 것(결정기록 7.6)", fast_status,
        f"빠른 누름(iPhone 17) {fmt_tests(fast)}. 화면 쪽(iPhone 17) {fmt_tests(fix)}. 키패드 판 아래 끝(iPhone SE) {fmt_tests(se_fix)}"
        + ("" if env.get("seSimulator") == "ok" else f"(SE 시뮬레이터를 만들지 못함: {env.get('seSimulator')})") + ". 간격별 결과와 웹이 받은 이벤트는 아래 절",
        "모두 통과(SE 포함). 0.1초와 0.2초 간격은 만들 수 없어 확인하지 못함으로 적음. 진행 막대 끝의 틈과 아래 단서의 모양은 테스트가 찍기만 하고 사람이 확대 캡처로 판단함(docs/ios_화면비교.md)")

    # 17 받는 쪽 단위 테스트(작업 지시서 4의 3-3)
    remote_suites = ["StrictJSONTests", "ReleaseKeyTests", "ReleaseRunTests", "RemoteMergeTests", "RemoteStoreTests", "RemoteBridgeTests", "ReleaseNetworkTests"]
    remote_unit = [x for x in unit_tests if x["suite"] in remote_suites]
    remote_unit18 = [x for x in unit18_tests if x["suite"] in remote_suites]
    remote_names = {(x["suite"], x["name"]) for x in remote_unit}
    remote_names18 = {(x["suite"], x["name"]) for x in remote_unit18}
    same_remote = remote_names == remote_names18 and {s for s, _ in remote_names} == set(remote_suites)
    per_suite = ", ".join(f"{s} {sum(1 for x in remote_unit if x['suite'] == s)}" for s in remote_suites)
    unit_headers = load(os.path.join(out_dir, "runs", "unit", "request-headers.json"), {})
    header_text = ", ".join(f"{h[0]}: {h[1]}" for h in unit_headers.get("headers", [])) or "기록 없음"
    add(17, "추가: 받는 쪽 단위 테스트(3-3)", "통과" if units_ok and same_remote and all_passed(remote_unit, 50) and all_passed(remote_unit18, 50) else "실패",
        f"iOS {env.get('mainRuntime')} {fmt_tests(remote_unit)}({per_suite}), iOS {env.get('ios18Runtime')} {fmt_tests(remote_unit18)}. 시험 서버가 받은 요청 머리글(iOS 26.4): {header_text}",
        "50개 이상 실행(테스트 전용 발행물 네 가지, 받는 쪽 시험 순서 1~7, CryptoKit 이 문서의 키와 서명을 받음, 틀린 모양, 통신 경우, 보관 파일 깨짐), 실패 0, 건너뜀 0")

    # 18 받는 쪽 화면 테스트
    remote_ui = suite("RemoteFetchTests")
    remote_ui18 = suite("RemoteFetchTests", ref)
    fetches = pick(rows, "remoteFetch")
    fetch_text = ", ".join(f"{r.get('device')} {r.get('ms')}ms(요청 {r.get('requests')}개)" for r in fetches) or "기록 없음"
    add(18, "추가: 받는 쪽 화면 테스트(3-3)", "통과" if all_passed(remote_ui, 5) and all_passed(release_smoke, 1) else "실패",
        f"iPhone 17(iOS 26.4) {fmt_tests(remote_ui)}. iOS 18.4 {fmt_tests(remote_ui18)}(10번에서 판정). Release 가 실행 인자의 시험 서버 주소를 무시하고 받지 않으며 시험 선택 화면이 지금과 같음: {fmt_tests(release_smoke)}. 한 번 받는 데 걸린 시간(시험 서버, 받기와 확인과 보관): {fetch_text}",
        "처음 받기, 새로 확인의 두 응답과 틀린 발행물 두 가지, 통신 없이 다시 켜기, 넘기는 응답, 앞으로 돌아왔을 때 5개 통과와 Release 확인 통과")

    # 19 Release 앱에 테스트 전용 키와 ATS 예외가 없음
    key_scan = release_app.get("testKeyScan", {})
    key_lines = " ".join(key_scan.get("lines", []))
    negatives = {"keytestSecond": "둘째 테스트 공개 키(바이트)와 씨앗(16진수)", "keytestEmbedded": "앱 안 파일에 테스트 공개 키", "keytestUnknownFile": "검사 목록 밖의 파일", "keytestInstall": "exam-data/public-key.txt 가 테스트 키"}
    neg_ok = all(env.get(k) == "빌드 실패(기대대로)" for k in negatives)
    key_ok = key_scan.get("exit") == 0 and "찾은 것 0개" in key_lines and str(env.get("releaseKeyScan", "")).startswith("테스트 키 검사: 배포용 앱의 파일") \
        and neg_ok and release_app.get("ats") is None and info.get("NSAppTransportSecurity") is None and debug_app.get("ats") is None
    add(19, "추가: Release 앱에 테스트 키와 ATS 예외 없음(3-3)", "통과" if key_ok else "실패",
        f"빌드 단계 검사: {env.get('releaseKeyScan', '기록 없음')}. 기기용 빌드: {env.get('deviceKeyScan', '기록 없음')}. 빌드 밖에서 Release 앱 전체를 다시 훑음: {key_lines or '기록 없음'}. "
        f"일부러 넣은 빌드(저장소 밖 복사본): " + ", ".join(f"{v} {env.get(k, '확인하지 못함')}" for k, v in negatives.items()) +
        f". ATS 예외: 소스 Info.plist {'없음' if info.get('NSAppTransportSecurity') is None else '있음'}, Release 앱 {'없음' if release_app.get('ats') is None else '있음'}, Debug 앱 {'없음' if debug_app.get('ats') is None else '있음'}(시뮬레이터에서 예외 없이 http://127.0.0.1 에 붙어서 Debug 에도 넣지 않음). 앱에 넣은 공개 키 파일 {release_app.get('examKeyFileBytes')}바이트(0 이면 진짜 공개 키 없음)",
        "Release 빌드 단계 검사가 돌았고 0건, 테스트 키나 목록 밖 파일을 넣은 빌드 네 가지가 모두 해당 파일과 까닭으로 실패, Release 앱 전체에서 테스트 키 0건, ATS 예외 없음")

    # 20 껍데기의 요청이 정해진 주소 밖으로 나가지 않음
    net_unit = {x["name"]: x for x in unit_tests if x["suite"] in ("ReleaseNetworkTests", "RemoteBridgeTests")}
    need = ["testFullRunRequestsOnlyThePublicationFiles", "testRedirectIsNotFollowed", "testRedirectOnExamFileFailsTheWholeRun", "testLocationRules"]
    need_ok = all(net_unit.get(n, {}).get("result") == "Passed" for n in need)
    ui_need = [x for x in remote_ui if x["name"] in ("testFirstFetchShowsNoticeRefreshAndTestExam", "testRedirectIsNotFollowed")]
    paths_ok = bool(fetches) and all(r.get("paths") == ["index.json", "index.json.sig", "files/test-only-exam.2.json"] for r in fetches)
    out_ok = need_ok and all_passed(ui_need, 2) and paths_ok and not scan.get("network") and all_passed(net, 2)
    add(20, "추가: 껍데기 요청이 정해진 주소 밖으로 나가지 않음(3-3)", "통과" if out_ok else "실패",
        f"단위: " + ", ".join(f"{n} {net_unit.get(n, {}).get('result', '없음')}" for n in need) + f". 화면: {fmt_tests(ui_need)}, 앱이 시험 서버에 보낸 요청 경로 {', '.join(fetches[-1].get('paths', [])) if fetches else '기록 없음'}. "
        f"ReleaseFetcher.swift에서 허용한 API 외 {len(scan.get('network', []))}건. 웹뷰의 바깥 통신 차단은 그대로(6번 탐침 {fmt_tests(net)})",
        "요청은 정해진 주소의 index.json, index.json.sig, 시험 파일뿐, 넘기는 응답을 따라가지 않음, 주소 밖 경로를 만들지 않음, 웹뷰 차단 그대로")

    # 21 출시 준비(기록용)
    add(21, "기록: 출시 준비", "기록", f"아직 없는 것: {env.get('releaseMissing', '?')}", "없는 것을 적기만 하고 실패로 보지 않음")

    # 22. 측정이 끊겨도 남아 있는 시도별 원본과 XCTest 결과를 함께 본다.
    held = pick(rows, "held")
    held_status, held_detail = held_result(out_dir, rows, env, held18_ui, held26_ui)
    add(22, "요소별 초과 입력과 확대(iOS 18.4, 26.4)", held_status, held_detail,
        "두 기기에서 표시 칸과 답 키의 첫 두 번과 세 번을 10번씩, 세 대상의 0.29초 누름을 32번씩 측정. "
        "기존 두 기기와 3-1 세 기기 모두 시작 배율 대비 앞뒤 및 resize 최고 배율이 조금이라도 오른 회차 0. "
        "3-1은 여섯 조건을 각 10회 측정. "
        "전용 XCTest 통과와 원본 증거가 필요하며 DOM 요소별/저장 답별 초과 및 확대는 모두 0회. 입력 부족과 끝 상태 차이는 기록")

    lines = []
    lines.append("# iOS 앱 껍데기 검증 결과")
    lines.append("")
    total_fail = [i for i in items if i["status"] == "실패"]
    unknown = [i for i in items if i["status"] == "확인하지 못함"]
    core = [i for i in items if i["no"] <= 13]
    extras_status = ", ".join(f"{i['no']}번 {i['status']}" for i in items if i["no"] > 13)
    lines.append(f"결론: 13개 항목 가운데 통과 {sum(1 for i in core if i['status'] == '통과')}, 실패 {sum(1 for i in core if i['status'] == '실패')}, 확인하지 못함 {sum(1 for i in core if i['status'] == '확인하지 못함')}. 추가 확인은 {extras_status}. `ios/scripts/verify.sh` 가 {env.get('date', '?')}에 돌려 쓴 문서예요. 실제로 돌린 것만 통과로 셌고, 건너뛴 테스트나 빠진 결과는 통과로 세지 않았어요.")
    lines.append("")
    lines.append(f"- 맥: macOS {env.get('macos', '?')}, Xcode {env.get('xcodeVersion', '?')}(빌드 {env.get('xcodeBuild', '?')}), SDK {env.get('sdk', '?')}, XcodeGen {env.get('xcodegen', '?')}")
    dirty_note = ""
    if env.get("dirty") == "yes" or env.get("dirtyAtEnd") == "yes":
        dirty_note = f" (커밋하지 않은 바뀜이나 추적하지 않는 파일: 시작 {'있음' if env.get('dirty') == 'yes' else '없음'}, 끝 {'있음' if env.get('dirtyAtEnd') == 'yes' else '없음'}. 11번 소스 검사는 그때의 작업 트리를 읽어요)"
    lines.append(f"- 저장소: 브랜치 {env.get('branch', '?')}, 커밋 {env.get('commit', '?')}{dirty_note}")
    lines.append(f"- 웹 묶음: {env.get('manifestInfo', '?')}")
    lines.append(f"- 실행 시각: {env.get('startedAt', '?')} ~ {env.get('finishedAt', '?')}. 시작할 때 전원: {env.get('power', '?')}. 잠듦 확인은 docs/ios_진행기록.md 에 적어요(pmset 기록).")
    lines.append(f"- 시뮬레이터(검증에 쓰려고 새로 만들고 끝나면 지움): {env.get('simulators', '?')}")
    lines.append(f"- 데스크톱 폴더 대응: 테스트 빌드에만 링커 설정 `-Wl,-S`(디버그 맵 빼기)를 덧붙였어요. 테스트 바이너리의 디버그 맵 항목 {env.get('testDebugMapEntries', '?')}개(0이어야 해요). 이유는 docs/ios_결정기록.md 에 있어요. 앱 코드와 프로젝트 설정은 그대로예요.")
    lines.append("")
    lines.append("| 번호 | 항목 | 결과 | 숫자 | 최소 기준 |")
    lines.append("| --- | --- | --- | --- | --- |")
    for i in items:
        lines.append(f"| {i['no']} | {i['title']} | {i['status']} | {esc(i['numbers'])} | {esc(i['criteria'])} |")
    lines.append("")
    lines.append("## 실기기와 제출용 빌드")
    lines.append("")
    lines.append("- 실제 아이폰에서 켜기, 서명한 빌드, Archive 와 App Store Connect 업로드: 확인하지 못함(서명 팀과 Apple 계정을 쓰지 않는다는 지시). 사람이 docs/ios_실기기_확인표.md 로 확인해요.")
    lines.append(f"- 참고로 서명 없이 기기용(iphoneos)으로 컴파일만 해 봤어요: {env.get('deviceBuild', '?')}. 기기에 올린 것은 아니에요.")
    lines.append("")
    lines.append("## 테스트별 결과")
    lines.append("")
    lines.append("| 묶음 | 테스트 | 기기 | 결과 | 걸린 시간(초) |")
    lines.append("| --- | --- | --- | --- | --- |")
    release_ui = load(os.path.join(out_dir, "ui-release.json"), {})
    main_dark_ui = load(os.path.join(out_dir, "ui-main-dark.json"), {})
    se_dark_ui = load(os.path.join(out_dir, "ui-se-dark.json"), {})
    release_look_ui = load(os.path.join(out_dir, "ui-release-look.json"), {})
    for label, res in (("단위", unit), ("단위(iOS 18)", unit18), ("화면", main_ui), ("화면(어두운 화면)", main_dark_ui), ("화면", live), ("화면", se_ui), ("화면(어두운 화면)", se_dark_ui), ("화면", ipad_ui), ("화면(iOS 18)", ios18_ui), ("화면(Release 모양)", release_look_ui), ("화면(Release)", release_ui), ("화면(3-2 기록, iOS 18)", held18_ui), ("화면(3-2 기록, iOS 26)", held26_ui)):
        for t in tests_of(res):
            dur = t.get("duration")
            lines.append(f"| {label} | {t['suite']}.{t['name']} | {res.get('device', '')} | {t['result']} | {dur:.1f} |" if isinstance(dur, (int, float)) else f"| {label} | {t['suite']}.{t['name']} | {res.get('device', '')} | {t['result']} | |")
            for m in t.get("messages", [])[:3]:
                lines.append(f"|  | 메시지 |  | {esc(m[:300])} | |")
    lines.append("")
    lines.append("## 다리와 껍데기 통합 확인(추가)")
    lines.append("")
    if all_passed(bridge, 4):
        lines.append(f"- 보관, 저장 실패, 불러오기 실패: {fmt_tests(bridge)}. 읽지 못한 기록(글자가 아닌 바이트, 더 높은 version)은 store-보관-날짜시각.json 으로 바이트 그대로 남았고, 쓸 수 없는 폴더에서는 storeFailed 를 받은 웹이 기록 화면에 안내를 띄웠고, 묶음을 못 열면 흰 화면 대신 안내가 떴어요.")
    else:
        lines.append(f"- 보관, 저장 실패, 불러오기 실패: {fmt_tests(bridge)}. 통과하지 못한 것: " + ", ".join(f"{t['name']}({t['result']})" for t in bridge if t["result"] != "Passed") + ". 이 동작은 확인되지 않았어요.")
    lines.append(f"- 시작 화면(iPhone 17): {fmt_tests(start)}. 진행자용 화면의 키보드 글 입력: {fmt_tests(keyboard)}. Release 구성으로 켜기: {fmt_tests(release_smoke)}")
    lines.append("")
    lines.append("## 접근성 감사에서 걸린 것")
    lines.append("")
    lines.append("기록용이에요. 통과했다고 접근성이 보장되지 않고, 실제 VoiceOver 사용은 사람이 docs/ios_실기기_확인표.md 로 확인해요. 판단은 docs/ios_검토기록.md 와 같은 기준으로 적었어요.")
    lines.append("")
    lines.append("| 화면 | 종류 | 요소 | 내용 | 판단 |")
    lines.append("| --- | --- | --- | --- | --- |")
    reasons = load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit_exceptions.json"), {})
    for a in audit:
        if not a.get("issues"):
            lines.append(f"| {a.get('screen')} | 없음 |  |  |  |")
        for issue in a.get("issues", []):
            rule = reasons.get(issue.get("type"))
            if isinstance(rule, dict):
                judge = rule.get("byLabel", {}).get(issue.get("element", ""), rule.get("default", "예외 아님: 사람이 확인할 것"))
            else:
                judge = rule or "예외 아님: 사람이 확인할 것"
            lines.append(f"| {a.get('screen')} | {issue.get('type')} | {esc(issue.get('element', '')[:60])} | {esc((issue.get('summary') or '')[:120])} | {esc(judge)} |")
    lines.append("")
    targets = [t for a in audit for t in a.get("domTargets", [])]
    if targets:
        lines.append("")
        lines.append("감사와 함께 잰 실제 누름 영역(DOM, pt): " + ", ".join(f"{t.get('label')} {t.get('w')} x {t.get('h')}" for t in targets))
    lines.append("")
    lines.append("## 결정기록 7.6: 빠른 누름과 웹이 받은 이벤트")
    lines.append("")
    lines.append("웹이 받은 이벤트는 껍데기의 DEBUG 기록(-SAEventLog)이 문서가 열리기 전부터 window 의 capture 단계에서 적은 것이에요. '(채움)'은 웹의 빠진 누름 채우기가 만들어 보낸 click(trusted 가 false)이에요. 이 기록은 웹 코드보다 먼저 불려서, 손가락에서 온 click 이 먼저 적히고 그 처리 안에서 웹이 보낸 click 이 뒤에 적혀요(웹은 채운 click 을 먼저 처리해요). 간격은 웹의 이벤트 시각(timeStamp)으로 잰 ms 예요.")
    lines.append("")
    lines.append("| 기기 | iOS | 경우 | 결과 | 웹이 받은 이벤트 | pointer 누름/뗌 | touch 시작/끝 | 누른 자리(pt) | 손가락 click(detail) | 채운 click | 누름 시작 사이 | 손뗌에서 다음 누름 | 채운 누름 늘어난 수 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in pick(rows, "fasttap"):
        lines.append(f"| {r.get('device', '')} | {r.get('os', '')} | {esc(r.get('case', ''))} | {esc(r.get('result', ''))} | {esc(r.get('sequence', r.get('reason', '')))} | "
                     f"{r.get('pointerdown', '')}/{r.get('pointerup', '')} | {r.get('touchstart', '')}/{r.get('touchend', '')} | {esc(', '.join(r.get('points') or []))} | {r.get('realClicks', '')} | {r.get('madeClicks', '')} | "
                     f"{r.get('pressToPressMs', '')} | {r.get('releaseToPressMs', '')} | {r.get('filledDelta', '')} |")
    for r in pick(rows, "fasttap-card"):
        lines.append("")
        lines.append(f"- 측정 카드({r.get('device')}, iOS {r.get('os')}): '채운 누름' {r.get('filledShown')}(기록 파일 {r.get('filledStored')})")
    for r in pick(rows, "webfix"):
        lines.append(f"- {r.get('case')}({r.get('device')}, iOS {r.get('os')}): {esc(json.dumps({k: v for k, v in r.items() if k not in ('kind', 'case', 'device', 'os')}, ensure_ascii=False, sort_keys=True))[:900]}")
    lines.append("")
    lines.append("## 받기와 서명 확인(작업 지시서 4의 3-3)")
    lines.append("")
    lines.append("앱이 시험 서버(ios/scripts/exam_server.py, 이 맥의 127.0.0.1)에서 받을 때 실제로 나간 요청과 걸린 시간이에요. 진짜 주소와 진짜 공개 키는 아직 없어서(21번) Debug 의 실행 인자로 시험 서버 주소와 테스트 전용 공개 키를 줬어요.")
    lines.append("")
    for r in fetches:
        lines.append(f"- {r.get('device')}: 받기와 확인과 보관 {r.get('ms')}ms, 요청 {r.get('requests')}개({', '.join(r.get('paths', []))}), 머리글 " + ", ".join(f"{h[0]}: {h[1]}" for h in r.get("headers", [])))
    if unit_headers:
        lines.append(f"- 단위 테스트(URLSession 만으로 받은 것): {unit_headers.get('version')} {unit_headers.get('path')}, 머리글 {header_text}")
    lines.append(f"- 출시 준비에서 아직 없는 것: {env.get('releaseMissing', '?')}")
    lines.append("")
    lines.append("## 3-2: 누르는 동안 온 dblclick 규칙을 잰 것(기록용)")
    lines.append("")
    lines.append(f"표시 칸, 답 키, 점수 해부의 같은 자리를 누르는 세 실험에서는 0.29초를 목표로 TouchSynth가 두 번의 누름을 따로 보냈어요. 누름 시작 사이의 실측 최솟값과 최댓값은 표에 적었어요. 사라짐은 둘째 누름의 손가락 click 이 오지 않은 것, 채움은 웹이 click 을 만들어 보낸 것(누르는 동안 온 dblclick 규칙과 손뗌 수 규칙), 늦은 click 버림은 채운 뒤 그 누름의 진짜 click 이 늦게 와서 웹이 버린 것이에요. 사라진 경우와 채운 경우의 이벤트 기록(시각 차례, 결정기록 7.8 의 형식)은 {held_path} 에 있어요.")
    lines.append("")
    lines.append("| iOS | 경우 | 되풀이 | 사라짐(그 가운데 누르는 동안 dblclick) | 채움(누르는 동안 온 dblclick 으로) | 사라졌는데 채우지 않음 | 늦은 click 버림 | 누른 수보다 많이 들어감 | 확대 | 끝 상태 차이(첫 누름과 세 번) | 누름 시작 사이(ms) | 손뗌에서 click 까지 가장 긴 것(ms, 20ms 넘은 수) | 끝 상태 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in held:
        ends = "; ".join(f"{k} {v}번" for k, v in sorted((r.get("endStates") or {}).items()))
        wrong_end = "해당 없음" if r.get("slug") in ("marks", "key", "anatomy") else r.get("wrongEnd", "확인하지 못함")
        lines.append(f"| {r.get('os')} | {esc(r.get('target'))} | {r.get('trials')} | {r.get('lost')}({r.get('dblclickWhileHeld')}) | {r.get('filled')}({r.get('heldFilled')}) | {r.get('lostNotFilled')} | {r.get('lateDropped')} | {r.get('over')} | {r.get('zoom')} | {wrong_end} | {r.get('gapMin')}~{r.get('gapMax')} | {r.get('liftToClickMax')}({r.get('liftToClickOver20')}) | {esc(ends)[:400]} |")
    # 전체 요약 전에 멈춘 경우도 저장된 파일과 시도별 측정에서 확인할 수 있다.
    complete = {(r.get("device"), r.get("slug")) for r in held}
    names = {"marks": "표시 칸 두 번", "key": "답 키 두 번", "anatomy": "점수 해부 두 번", "triple": "표시 칸 세 번",
             "double-first": "표시 칸 첫 두 번", "triple-first": "표시 칸 첫 세 번",
             "key-double-first": "답 키 첫 두 번", "key-triple-first": "답 키 첫 세 번"}
    partial = []
    for folder, device, runtime, result in (("held18", "iphone16", env.get("ios18Runtime"), held18_ui),
                                            ("held26", "iphone17", env.get("mainRuntime"), held26_ui)):
        attempts = pick(rows, "heldTrial", device=device)
        if not attempts and not result:
            continue
        runtime = next((r["os"] for r in attempts if r.get("os")), runtime)
        directory = os.path.join(out_dir, "runs", folder, "held")
        files = set(os.listdir(directory)) if os.path.isdir(directory) else set()
        for slug, label in names.items():
            if (device, slug) in complete:
                continue
            records = [r for r in attempts if r.get("slug") == slug]
            raw = sorted(f for f in files if re.fullmatch(re.escape(f"{device}-ios{runtime}-{slug}-") + r"\d+\.txt", f)
                         and os.path.getsize(os.path.join(directory, f)) > 0)
            available = [r for r in records if r.get("file") in raw]
            scales = [r for r in available if min(r.get("before", -1), r.get("after", -1), r.get("peakScale", -1)) > 0]
            zooms = sum(r["peakScale"] > r["before"] for r in scales)
            excess = [f"{r['index']}회차 `{r['file']}`" for r in records if r.get("over") is True]
            over_text = ", ".join(excess) or ("관측 0회" if available else "확인하지 못함")
            partial.append(f"| {runtime or '?'} | {label} | {len(raw)} | {zooms}/{len(scales)} | {over_text} |")
    if partial:
        lines.extend(["", "전체 요약이 없는 경우에는 저장된 시도까지만 적었어요.", "",
                      "| iOS | 경우 | 확보한 원본 파일 수 | 확대 / 앞뒤 및 최고 배율이 있는 시도 | 초과 입력 회차와 파일 |",
                      "| --- | --- | --- | --- | --- |", *partial])
    lines.append("")
    lines.append("## Release 와 Debug 의 화면 모양(3-3)")
    lines.append("")
    lines.append(f"같은 테스트(LookTests)를 Debug 와 Release 로 돌려 같은 누름으로 같은 화면까지 가서 찍었어요(Release 에는 상태를 심는 장치가 없어요). 캡처는 {captures_path}/release/debug 와 {captures_path}/release/release 에 있어요. 세 가지로 견줬어요. 화면 전체의 화소(채널 차이 8 넘는 화소가 30개 넘으면 다름, 기록 화면은 Debug 전용 목록의 위 끝에서 12pt 위까지), 이름이 있는 접근성 요소의 있고 없음과 자리와 크기(1pt 넘게 다르면 다름, 기록 화면의 Debug 전용 목록 아래는 크기만), 요소마다 각자의 자리에서 잘라 견준 화소(채널 차이 8 넘는 화소가 0.5% 넘으면 다름)예요. 기록 화면은 맨 위에서 찍고(08-기록), 맨 아래까지 내린 것(08b-기록-아래)은 요소의 있고 없음만 견줘요.")
    lines.append("")
    lines.append("| 화면 | 요소(Debug/Release) | Debug 에만 | Release 에만 | 화면 전체 화소 차이(견준 높이) | 자리 다름 | 크기 다름 | 화소를 견준 요소 | 모양 다름 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for sc in load(os.path.join(out_dir, "look", "compare.json"), {}).get("screens", []):
        lines.append(f"| {sc.get('screen')} | {sc.get('debugElements')}/{sc.get('releaseElements')} | {esc(', '.join(sc.get('onlyDebug', [])) or '없음')} | {esc(', '.join(sc.get('onlyRelease', [])) or '없음')} | "
                     f"{sc.get('fullDiffPixels', '?')}화소({sc.get('fullComparedHeight', '?')}pt) | {esc(', '.join(sc.get('positionDiffs', [])) or '없음')} | "
                     f"{esc(', '.join(sc.get('sizeDiffs', [])) or '없음')} | {sc.get('pixelCompared')} | {esc(', '.join(sc.get('pixelDiffs', [])) or '없음')} |")
    lines.append("")
    lines.append("## 숫자 기록")
    lines.append("")
    for r in rows:
        lines.append(f"- {esc(json.dumps(r, ensure_ascii=False, sort_keys=True))[:500]}")
    lines.append("")
    lines.append("## 캡처")
    lines.append("")
    lines.append(f"{captures_path}/기기/테마/번호-화면.png 로 남겼어요. 같은 화면의 웹 캡처와의 비교는 docs/ios_화면비교.md 에 있어요.")
    if caps.get("missing"):
        lines.append(f"- 빠진 것: {', '.join(caps['missing'])}")
    if caps.get("duplicates"):
        lines.append(f"- 겹친 것: {caps['duplicates']}")
    if caps.get("wrongSize"):
        lines.append(f"- 크기 다름: {caps['wrongSize']}")
    lines.append("")
    if scan.get("forbidden"):
        lines.append("## 금지 문자가 나온 곳")
        lines.append("")
        for f in scan["forbidden"][:50]:
            lines.append(f"- {f['file']}:{f['line']} {f['char']}")
        lines.append("")
    text = "\n".join(lines) + "\n"
    for ch in FORBIDDEN:
        text = text.replace(ch, " ")
    with open(doc_path, "w", encoding="utf-8") as f:
        f.writelines(line.rstrip() + "\n" for line in text.splitlines())
    print(json.dumps({"items": [(i["no"], i["status"]) for i in items]}, ensure_ascii=False))
    sys.exit(0 if not total_fail and held_status == "통과" else 1)


def esc(text):
    return str(text).replace("|", "/").replace("\n", " ")


def pick(rows, kind, **match):
    return [r for r in rows if r.get("kind") == kind and all(r.get(k) == v for k, v in match.items())]


def flow_numbers(rows):
    f = pick(rows, "flow", device="iphone17")
    if not f:
        return ""
    return f". 흐름 {f[-1].get('seconds', 0):.0f}초, 햅틱 메시지 {f[-1].get('haptics')}번(받아들인 키 누름 49번), 계단 {f[-1].get('steps')}개"


def restart_numbers(rows):
    r = pick(rows, "restart")
    if not r:
        return ""
    return f". 12번째 답 키 누름이 끝난 뒤(XCUITest 가 앱이 쉬는 것을 확인한 뒤) store.json 에 12개가 보이기까지 {r[-1].get('secondsUntilSaved', 0):.2f}초"


def rhythm_numbers(rows):
    parts = []
    names = {"marks-double": "표시 두 번 누름", "lock": "9번 고친 뒤 이어 누름", "last-item": "마지막 문항 뒤 이어 누름"}
    for r in pick(rows, "rhythm"):
        gaps = r.get("gaps") or []
        if gaps:
            text = f"{names.get(r.get('case'), r.get('case'))}: 실제 간격 {min(gaps):.2f}~{max(gaps):.2f}초, 채운 누름 {len(r.get('madeClicks') or [])}개"
            if r.get("case") == "marks-double" and r.get("firstClickAfterTouchEndMs") is not None:
                text += f"(첫 click 은 손을 뗀 뒤 {r.get('firstClickAfterTouchEndMs'):.0f}ms 에 옴. 참고: 손을 떼고 곧바로 다시 누르는 XCUITest doubleTap 은 '{r.get('fastDoubleTapLabel', '')}', 이벤트 {', '.join(r.get('fastDoubleTapEvents', []))})"
            parts.append(text)
    note = " XCUITest 의 좌표 누름은 한 번에 0.35초 넘게 걸려 0.15초, 0.2초, 0.3초 간격을 그대로 낼 수 없었어요. 보호 시간(0.5초) 안의 가장 빠른 간격으로 확인했어요. 이 박자에서 채운 누름이 0개여야 해요(누름이 세 번 들어가지 않음)."
    return (". " + ", ".join(parts) + "." + note) if parts else ""


def no_fill_in_rhythm(rows):
    rhythm = pick(rows, "rhythm")
    return bool(rhythm) and all(len(r.get("madeClicks") or []) == 0 for r in rhythm if "madeClicks" in r) and all("madeClicks" in r for r in rhythm)


def network_numbers(rows):
    parts = []
    for r in pick(rows, "network"):
        if r.get("mode") == "blocked":
            parts.append(f"차단 실행: 하위 자원 요청 10가지(fetch 2, XHR, 그림, 스크립트, 스타일, 비컨, 웹소켓, 서버 이벤트, iframe)와 스크립트의 새 창이 수신기에 닿은 연결 {r.get('connections')}건, 문서 이동까지 모두 닿은 요청 내용 {len(r.get('requests', []))}건, 껍데기가 취소한 이동 {r.get('blockedNavigations')}건(iframe, 스크립트의 링크와 새 창 링크와 location 과 form, 사람이 누른 링크와 새 창 링크)과 새 창 만들기 단계에서 거절한 것 {r.get('blockedWindows')}건. 참고: 링크로 가는 이동에서 WebKit 이 내용 없이 미리 맺은 연결 {r.get('preconnects')}건(웹 묶음에는 바깥 링크가 없다)")
        else:
            parts.append(f"대조 실행(규칙 없음): 닿은 연결 {r.get('connections')}건, 요청 내용 {r.get('requests')}건")
    return (". " + ". ".join(parts) + ".") if parts else "."


def font_numbers(rows):
    parts = [f"{r.get('category', '').replace('UICTContentSizeCategory', '')} {r.get('rootPx', 0):.2f}px" for r in pick(rows, "font")]
    return (". 루트 글자: " + ", ".join(parts)) if parts else ""


def small_numbers(rows):
    r = pick(rows, "small")
    return f". 화면 {r[-1].get('window')}pt, 넘친 높이(문서, 본문) 모두 0 이하" if r else ""


def ipad_numbers(rows):
    r = [x for x in pick(rows, "start") if x.get("runnerIdiom") == "pad"]
    return f". iPad 에서 앱 창 {r[-1].get('window')}pt(아이폰 크기로 뜸)" if r else ""


def main():
    cmd = sys.argv[1]
    if cmd == "xcresult":
        cmd_xcresult(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "")
    elif cmd == "scan":
        cmd_scan(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "app":
        cmd_app(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif cmd == "captures":
        cmd_captures(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "extras":
        cmd_extras(sys.argv[2], sys.argv[3])
    elif cmd == "first034":
        raise SystemExit(first034_results(*sys.argv[2:6])[3])
    elif cmd == "held-stop":
        confirmed, unreadable = held_stop(sys.argv[2])
        for name in confirmed:
            print("원본에서 초과 입력 확인:", name)
        for name in unreadable:
            print("원본 판독 실패:", name)
        unresolved_signal = (Path(sys.argv[2]) / "input-over.json").is_file() and unreadable
        raise SystemExit(3 if confirmed else 4 if unresolved_signal else 0)
    elif cmd == "render":
        cmd_render(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
