#!/usr/bin/env python3
"""앱 버전을 웹 묶음의 버전에 맞춘다(작업 지시서 3-2의 3-1).

앱 버전(project.yml 의 MARKETING_VERSION, 앱의 CFBundleShortVersionString)은 앱에 싣는 웹 묶음의 버전
(ios/ScoreAnatomy/Web/manifest.json 의 version)과 같아야 한다. 웹 묶음을 새로 받아 넣은 뒤 이 스크립트를 돌린다.

쓰는 법(저장소 어디에서 불러도 된다):
  ios/scripts/sync_version.py          다르면 project.yml 을 고치고 프로젝트 파일을 다시 만든다.
  ios/scripts/sync_version.py --check  고치지 않고 견주기만 한다(verify.sh 가 시작할 때 부른다).

프로젝트 파일은 XcodeGen 2.47.0 이 있으면 그것으로 다시 만들고, 없거나 판이 다르면 프로젝트 파일의
MARKETING_VERSION 줄만 바꾼다(다른 판의 XcodeGen 은 버전과 상관없는 줄까지 바꿀 수 있어서).
다시 만든 뒤에는 프로젝트 폴더와 Info.plist 에서 MARKETING_VERSION 줄 말고 바뀐 것이 없는지 본다.
서명 설정(Config/*.xcconfig)은 읽지도 고치지도 않는다.

종료 코드: 0 같음(또는 맞춤), 1 다름(--check), 2 읽지 못함이나 고치지 못함, 3 버전 말고도 바뀐 줄이 있음.
"""
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

XCODEGEN_VERSION = "2.47.0"
IOS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(IOS_DIR, "ScoreAnatomy", "Web", "manifest.json")
PROJECT_YML = os.path.join(IOS_DIR, "project.yml")
PROJECT_DIR = os.path.join(IOS_DIR, "ScoreAnatomy.xcodeproj")
PBXPROJ = os.path.join(PROJECT_DIR, "project.pbxproj")
INFO_PLIST = os.path.join(IOS_DIR, "ScoreAnatomy", "Info.plist")
# CFBundleShortVersionString 에 쓸 수 있는 모양: 마침표로 나눈 정수 1~3개.
VERSION_RE = re.compile(r"^[0-9]+(\.[0-9]+){0,2}$")
YML_RE = re.compile(r'^(\s*MARKETING_VERSION:\s*)(["\']?)([^"\'\s#]+)(["\']?)(\s*(#.*)?)$')
PBX_RE = re.compile(r"MARKETING_VERSION = ([^;]+);")


def say(text):
    print(f"[버전] {text}")


def stop(code, text):
    say(text)
    sys.exit(code)


def manifest_version():
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            version = json.load(f).get("version")
    except (OSError, ValueError) as error:
        stop(2, f"manifest.json 을 읽지 못했어요: {error}")
    if not isinstance(version, str) or not VERSION_RE.match(version):
        stop(2, f"manifest.json 의 version({version!r})이 앱 버전으로 쓸 수 있는 모양(예: 0.3.1)이 아니에요. 웹 묶음을 확인해 주세요.")
    return version


def yml_versions(lines):
    found = [(i, m) for i, m in ((i, YML_RE.match(line.rstrip("\n"))) for i, line in enumerate(lines)) if m]
    return found


def pbx_versions(text):
    return [v.strip().strip('"') for v in PBX_RE.findall(text)]


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError as error:
        stop(2, f"{os.path.relpath(path, IOS_DIR)} 을 읽지 못했어요: {error}")


def xcodegen_version():
    exe = shutil.which("xcodegen")
    if not exe:
        return None, None
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return exe, None
    return exe, out.replace("Version:", "").strip()


def snapshot(folder):
    """프로젝트 폴더의 파일 내용(사람마다 생기는 xcuserdata 는 뺀다)."""
    files = {}
    for root, dirs, names in os.walk(folder):
        dirs[:] = [d for d in dirs if d != "xcuserdata"]
        for name in names:
            path = os.path.join(root, name)
            with open(path, "rb") as f:
                files[os.path.relpath(path, folder)] = f.read()
    return files


def other_changes(before, after, info_before, info_after):
    """MARKETING_VERSION 줄 말고 바뀐 줄의 목록."""
    changes = []
    for name in sorted(set(before) | set(after)):
        if name not in before:
            changes.append(f"새로 생긴 파일: {name}")
            continue
        if name not in after:
            changes.append(f"없어진 파일: {name}")
            continue
        if before[name] == after[name]:
            continue
        old = before[name].decode("utf-8", "replace").splitlines()
        new = after[name].decode("utf-8", "replace").splitlines()
        for line in difflib.unified_diff(old, new, lineterm="", n=0):
            if line.startswith(("---", "+++", "@@")):
                continue
            if "MARKETING_VERSION = " in line:
                continue
            changes.append(f"{name}: {line}")
    if info_before != info_after:
        changes.append("Info.plist 가 바뀜")
    return changes


def main():
    check_only = "--check" in sys.argv[1:]
    want = manifest_version()
    lines = read(PROJECT_YML).splitlines(keepends=True)
    found = yml_versions(lines)
    if len(found) != 1:
        stop(2, f"project.yml 에서 MARKETING_VERSION 줄을 하나 찾아야 하는데 {len(found)}개를 찾았어요.")
    yml_index, yml_match = found[0]
    yml_value = yml_match.group(3)
    pbx_values = pbx_versions(read(PBXPROJ))
    if not pbx_values:
        stop(2, "프로젝트 파일(project.pbxproj)에서 MARKETING_VERSION 을 찾지 못했어요.")

    summary = f"manifest.json {want}, project.yml {yml_value}, 프로젝트 파일 {', '.join(sorted(set(pbx_values)))}({len(pbx_values)}곳)"
    if yml_value == want and all(v == want for v in pbx_values):
        stop(0, f"같아요: {summary}")
    if check_only:
        stop(1, f"앱 버전이 웹 묶음의 버전과 달라요: {summary}. ios/scripts/sync_version.py 로 맞춘 뒤 다시 돌려 주세요.")

    before = snapshot(PROJECT_DIR)
    with open(INFO_PLIST, "rb") as f:
        info_before = f.read()
    if yml_value != want:
        m = yml_match
        lines[yml_index] = f'{m.group(1)}"{want}"{m.group(5) or ""}\n'
        with open(PROJECT_YML, "w", encoding="utf-8") as f:
            f.writelines(lines)
        say(f"project.yml: {yml_value} -> {want}")

    exe, version = xcodegen_version()
    if exe and version == XCODEGEN_VERSION:
        result = subprocess.run([exe, "generate", "--quiet", "--spec", PROJECT_YML, "--project", IOS_DIR],
                                capture_output=True, text=True, cwd=IOS_DIR)
        if result.returncode != 0:
            stop(2, f"XcodeGen 으로 프로젝트 파일을 다시 만들지 못했어요: {result.stderr.strip() or result.stdout.strip()}")
        how = f"XcodeGen {version} 으로 다시 만들었어요"
    else:
        text = read(PBXPROJ)
        text = PBX_RE.sub(f"MARKETING_VERSION = {want};", text)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=PROJECT_DIR, delete=False) as tmp:
            tmp.write(text)
        os.replace(tmp.name, PBXPROJ)
        reason = "XcodeGen 이 없어서" if not exe else f"XcodeGen 판이 {version} 이라서({XCODEGEN_VERSION} 이 아님)"
        how = f"{reason} 프로젝트 파일의 MARKETING_VERSION 줄만 바꿨어요"

    pbx_after = pbx_versions(read(PBXPROJ))
    if not pbx_after or any(v != want for v in pbx_after):
        stop(2, f"프로젝트 파일의 MARKETING_VERSION 이 {want} 가 되지 않았어요: {pbx_after}")
    with open(INFO_PLIST, "rb") as f:
        info_after = f.read()
    changes = other_changes(before, snapshot(PROJECT_DIR), info_before, info_after)
    say(f"프로젝트 파일: {how}(MARKETING_VERSION {len(pbx_after)}곳이 {want})")
    if changes:
        say("버전 말고도 바뀐 줄이 있어요. 서명 설정이나 다른 설정이 바뀌지 않았는지 git diff 로 확인해 주세요:")
        for line in changes[:40]:
            print("  " + line)
        sys.exit(3)
    say("버전 말고 바뀐 줄은 없어요(서명 설정과 그 밖의 설정 그대로).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
