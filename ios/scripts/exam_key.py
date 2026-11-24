#!/usr/bin/env python3
"""시험 자료 공개 키를 앱에 넣고, 배포용(Release) 앱에 테스트 전용 키가 없는지 검사한다(작업 지시서 4의 3-3).

Xcode 의 빌드 단계(project.yml 의 postBuildScripts)가 부른다. 빌드 스크립트 샌드박스(ENABLE_USER_SCRIPT_SANDBOXING) 때문에
읽는 파일은 모두 그 단계의 입력(inputFiles)으로 적어 둬야 한다(적지 않은 파일은 읽히지 않는다).

명령:
  install   exam-data/public-key.txt(진짜 공개 키, 표준 base64 한 줄)를 읽어 앱의 exam-public-key.txt 로 쓴다.
            파일이 없으면 빈 파일을 쓴다(그러면 앱은 시험 자료를 받지 않는다). 모양이 틀리면 빌드를 실패시킨다.
            Release 에서 테스트 전용 키면 빌드를 실패시킨다. 공개 키의 자리는 이 한 곳뿐이다(바꾸는 설정이 없다).
  scan      Release 빌드에서만: 앱(.app) 안의 파일을 모두 훑어 테스트 전용 키가 들어 있으면 빌드를 실패시킨다.
            앱 안에 입력으로 적지 않은 파일이 있으면(읽을 수 없어 검사하지 못하니) 그것도 실패다. 서명 파일만 건너뛴다.
  selftest <폴더>  scan 과 같은 찾기를 폴더 안의 모든 파일에 한다. 찾으면 종료 코드 1(verify.sh 가 검사 자체를 확인할 때 쓴다).
  keys      찾는 테스트 전용 키의 지문을 적는다.

찾는 것: 테스트 전용 공개 키 두 개(exam-data/testdata/test-only-public-key.txt, 지문 f7e7dc5cfc6ce2a0. 서명이 틀린 테스트 발행물에만 쓴
다른 키, 지문 99e0a1fa9d0331bc. 둘째 키는 파일로 두지 않았고 scripts/exams/sign.ts 의 TEST_ONLY_KEY_NAMES 둘째 이름의 SHA-256 을
Ed25519 씨앗으로 만든 키다)와 그 비밀 키 씨앗 두 개를, 바이트 그대로, 표준 base64(패딩 있음, 없음), base64url, 16진수(소문자, 대문자)로.
공개 키 값은 ScoreAnatomyTests 의 단위 테스트가 CryptoKit 으로 같은 이름에서 다시 만들어 이 파일의 값, 지문과 같은지 확인한다.
"""
import base64
import hashlib
import os
import re
import sys
import unicodedata

TEST_ONLY_KEY_NAMES = ["score-anatomy/test-only-signing-key/v1", "score-anatomy/test-only-other-key/v1"]
# 테스트 전용 공개 키(표준 base64). 지문은 공개 키 32바이트의 SHA-256 앞 16자다.
TEST_ONLY_PUBLIC_KEYS = {
    "f7e7dc5cfc6ce2a0": "9B32e0bSiW0YClKPJ0E5dNWeKt1evBdQgz87l9vLgY4=",
    "99e0a1fa9d0331bc": "RbgLhwsz5myYIhqvbFTRtAAJ9ogTYK4+lQXUKccPhwg=",
}
KEY_FILE_NAME = "exam-public-key.txt"
PUBLIC_KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")
# 앱 안에서 검사하지 않고 건너뛰는 파일: 서명(코드 서명 단계가 앞 빌드에서 남긴 것), 프로비저닝 프로필,
# 앱 안에 들어가는 단위 테스트 꾸러미(Debug 와 Release 의 시험용 빌드에서만 생기고 배포 꾸러미에는 없다).
SKIP_PREFIXES = ("_CodeSignature/", "PlugIns/ScoreAnatomyTests.xctest/")
SKIP_FILES = ("embedded.mobileprovision",)


def fail(message):
    # Xcode 는 "error:" 로 시작하는 줄을 빌드 오류로 보여 준다.
    print(f"error: {message}")
    sys.exit(1)


def fingerprint(key):
    return hashlib.sha256(key).hexdigest()[:16]


def test_keys():
    """(이름, 바이트) 목록: 공개 키 둘과 비밀 키 씨앗 둘."""
    out = []
    for fp, text in TEST_ONLY_PUBLIC_KEYS.items():
        key = base64.b64decode(text, validate=True)
        if len(key) != 32 or fingerprint(key) != fp:
            fail(f"exam_key.py 의 테스트 전용 공개 키 값이 지문({fp})과 맞지 않아요.")
        out.append((f"테스트 전용 공개 키(지문 {fp})", key))
    for name in TEST_ONLY_KEY_NAMES:
        out.append((f"테스트 전용 비밀 키 씨앗({name})", hashlib.sha256(name.encode("utf-8")).digest()))
    return out


def patterns():
    """찾을 바이트 모양 목록: (설명, 바이트)."""
    found = []
    for label, raw in test_keys():
        b64 = base64.b64encode(raw)
        forms = {
            "바이트 그대로": raw,
            "base64": b64,
            "base64(패딩 없음)": b64.rstrip(b"="),
            "base64url": base64.urlsafe_b64encode(raw).rstrip(b"="),
            "16진수": raw.hex().encode("ascii"),
            "16진수(대문자)": raw.hex().upper().encode("ascii"),
        }
        for form, data in forms.items():
            found.append((f"{label}, {form}", data))
    found.append(("PEM 비밀 키 머리", b"BEGIN PRIVATE KEY"))
    return found


def parse_key_file(data):
    """공개 키 파일 바이트를 32바이트로. 모양이 틀리면 None(scripts/exams/sign.ts 의 parsePublicKeyText 와 같은 기준)."""
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return None
    if text.endswith("\r\n"):
        text = text[:-2]
    elif text.endswith("\n"):
        text = text[:-1]
    if not PUBLIC_KEY_RE.match(text):
        return None
    raw = base64.b64decode(text, validate=True)
    if len(raw) != 32 or base64.b64encode(raw).decode("ascii") != text:
        return None
    return raw


def cmd_install():
    srcroot = os.environ["SRCROOT"]
    source = os.path.normpath(os.path.join(srcroot, "..", "exam-data", "public-key.txt"))
    out_dir = os.path.join(os.environ["TARGET_BUILD_DIR"], os.environ["UNLOCALIZED_RESOURCES_FOLDER_PATH"])
    target = os.path.join(out_dir, KEY_FILE_NAME)
    release = os.environ.get("CONFIGURATION") == "Release"
    os.makedirs(out_dir, exist_ok=True)
    if not os.path.isfile(source):
        with open(target, "wb"):
            pass
        print("시험 자료 공개 키: exam-data/public-key.txt 가 없어 빈 파일을 넣었어요(이 앱은 시험 자료를 받지 않아요).")
        return 0
    with open(source, "rb") as f:
        raw = parse_key_file(f.read(16 * 1024))
    if raw is None:
        fail("exam-data/public-key.txt 는 Ed25519 공개 키 32바이트를 표준 base64(패딩 포함)로 적은 한 줄이어야 해요(docs/시험_배포_규격.md 2-4).")
    test_fps = set(TEST_ONLY_PUBLIC_KEYS)
    if fingerprint(raw) in test_fps:
        if release:
            fail(f"exam-data/public-key.txt 가 테스트 전용 공개 키(지문 {fingerprint(raw)})예요. 배포용 빌드에는 넣지 않아요.")
        print(f"알림: exam-data/public-key.txt 가 테스트 전용 공개 키(지문 {fingerprint(raw)})예요. Debug 빌드라 넣었어요.")
    with open(target, "w", encoding="ascii", newline="\n") as f:
        f.write(base64.b64encode(raw).decode("ascii") + "\n")
    print(f"시험 자료 공개 키: 지문 {fingerprint(raw)} 를 넣었어요.")
    return 0


def same_path(path):
    # 한글 폴더 이름이 NFC 와 NFD 두 모양으로 올 수 있어서 NFC 로 맞춰 견준다.
    return unicodedata.normalize("NFC", os.path.normpath(path))


def search(path, pats):
    with open(path, "rb") as f:
        data = f.read()
    return [label for label, needle in pats if needle in data]


def cmd_scan():
    if os.environ.get("CONFIGURATION") != "Release":
        print("테스트 키 검사: Release 빌드에서만 해요(지금은 건너뜀).")
        return 0
    app = os.path.join(os.environ["TARGET_BUILD_DIR"], os.environ["WRAPPER_NAME"])
    declared = set()
    for i in range(int(os.environ.get("SCRIPT_INPUT_FILE_COUNT", "0"))):
        declared.add(same_path(os.environ[f"SCRIPT_INPUT_FILE_{i}"]))
    pats = patterns()
    scanned = skipped = 0
    problems = []
    for base, dirs, files in os.walk(app):
        dirs.sort()
        for name in sorted(files):
            path = os.path.normpath(os.path.join(base, name))
            rel = os.path.relpath(path, app)
            if rel.startswith(SKIP_PREFIXES) or rel in SKIP_FILES:
                skipped += 1
                continue
            if same_path(path) not in declared:
                problems.append(f"{rel}: 검사 목록(project.yml 의 이 단계 inputFiles)에 없는 파일이라 검사하지 못했어요. 목록에 더해 주세요.")
                continue
            hits = search(path, pats)
            scanned += 1
            for hit in hits:
                problems.append(f"{rel}: {hit} 가 들어 있어요.")
    if scanned == 0:
        problems.append("검사한 파일이 없어요(앱을 찾지 못했어요).")
    if problems:
        for p in problems:
            print(f"error: 배포용 앱 검사: {p}")
        print(f"error: 배포용 앱(.app)에 테스트 전용 키가 있거나 검사하지 못한 파일이 있어요. 문제 {len(problems)}개.")
        return 1
    print(f"테스트 키 검사: 배포용 앱의 파일 {scanned}개를 검사했고 테스트 전용 키는 없어요(서명 파일 {skipped}개는 건너뜀).")
    return 0


def cmd_selftest(folder):
    pats = patterns()
    hits = []
    count = 0
    for base, _, files in os.walk(folder):
        for name in files:
            path = os.path.join(base, name)
            count += 1
            for hit in search(path, pats):
                hits.append(f"{os.path.relpath(path, folder)}: {hit}")
    for h in hits:
        print(f"찾음: {h}")
    print(f"파일 {count}개, 찾은 것 {len(hits)}개")
    return 1 if hits else 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    command = sys.argv[1]
    if command == "install":
        return cmd_install()
    if command == "scan":
        return cmd_scan()
    if command == "selftest" and len(sys.argv) == 3:
        return cmd_selftest(sys.argv[2])
    if command == "keys":
        for label, raw in test_keys():
            print(label, base64.b64encode(raw).decode("ascii"))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
