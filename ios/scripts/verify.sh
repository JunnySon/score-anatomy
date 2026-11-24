#!/bin/bash
# 모고칸(저장소 score-anatomy) iOS 앱 껍데기의 자동 검증(작업 지시서 2의 6장, 작업 지시서 3-2, 작업 지시서 4의 2부). 빌드, 단위 테스트, 화면 테스트, 정적 검사, 캡처를 모두 돌리고
# docs/ios_검증결과.md 를 쓴다. 저장소 어디에서 불러도 된다: ios/scripts/verify.sh
#
# 이 맥에 남기는 것: 빌드 산출물과 테스트 결과는 ios/build 에만 둔다(-derivedDataPath ios/build).
# 검증에 쓸 시뮬레이터는 이름이 "SA검증-" 으로 시작하게 새로 만들고, 끝나면(중간에 멈춰도) 지운다.
# 원래 있던 시뮬레이터와 시스템 설정은 건드리지 않는다. 언어와 지역은 실행 인자로 준다(화면 테스트 쪽).
# 시험 자료 받기 테스트에 쓰는 시험 서버(ios/scripts/exam_server.py)는 127.0.0.1 에서만 열고 끝나면(중간에 멈춰도) 끈다.
set -u -o pipefail

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$IOS_DIR/.." && pwd)"
BUILD="$IOS_DIR/build"
OUT="$BUILD/verify"
PROJECT="$IOS_DIR/ScoreAnatomy.xcodeproj"
SCHEME="ScoreAnatomy"
PREFIX="SA검증"
REPORT=(python3 "$IOS_DIR/scripts/verify_report.py")
# 저장소가 데스크톱 폴더(개인정보 보호로 접근이 관리되는 곳)에 있으면 XCTest 가 실패 위치를 기호화하려고 빌드 중간 파일을 열다
# 멈춘다(open 에서 막힘). 테스트 빌드에만 디버그 맵을 넣지 않는 링커 설정(-S)을 더한다. 실패한 줄은 소스의 파일과 줄 번호로
# 따로 기록되므로 잃는 것이 없다(docs/ios_결정기록.md).
TEST_LDFLAGS='OTHER_LDFLAGS=$(inherited) -Wl,-S'
TEST_TIME=(-test-timeouts-enabled YES -default-test-execution-time-allowance 600 -maximum-test-execution-time-allowance 900)
CREATED=""
SERVER_PID=""
TESTDATA_COPY=""

log() { printf '[verify %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

remove_prefixed_sims() {
  # 이름이 "SA검증-" 으로 시작하는 시뮬레이터(이 스크립트가 만든 것)를 모두 끄고 지운다.
  for udid in $(xcrun simctl list devices -j | python3 -c '
import json, sys
for rt, devs in json.load(sys.stdin)["devices"].items():
    for d in devs:
        if d["name"].startswith(sys.argv[1] + "-"):
            print(d["udid"])
' "$PREFIX"); do
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  done
}

cleanup() {
  # 만든 시뮬레이터를 지운다. create_sim 은 $(...) 안(하위 셸)에서 돌아서 목록은 부르는 쪽에서 모으고,
  # 혹시 빠진 것이 있어도 남지 않게 이름으로도 한 번 더 지운다.
  for udid in $CREATED; do
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  done
  remove_prefixed_sims
  log "검증용 시뮬레이터를 지웠다(남은 것: $(xcrun simctl list devices | grep -c "$PREFIX-"))"
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
    log "시험 서버를 껐다"
  fi
  [ -n "$TESTDATA_COPY" ] && rm -rf "$TESTDATA_COPY"
}
# 앱 버전(project.yml)과 웹 묶음 버전(manifest.json)이 같은지 먼저 본다. 다르면 아무것도 돌리지 않고 멈춘다
# (시뮬레이터를 지우는 정리 trap 을 걸기 전이라 다른 검증의 시뮬레이터도, 지난 결과 폴더도 건드리지 않는다).
# 맞추는 법: ios/scripts/sync_version.py
if ! python3 "$IOS_DIR/scripts/sync_version.py" --check; then
  log "앱 버전이 웹 묶음 버전과 달라서 검증을 시작하지 않고 멈춘다. ios/scripts/sync_version.py 로 맞춘 뒤 다시 돌려 주세요."
  exit 2
fi

trap cleanup EXIT

meta() {
  # meta.json 에 키와 값 하나를 더한다.
  python3 - "$OUT/meta.json" "$1" "$2" <<'PY'
import json, sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    data = {}
data[key] = value
json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
}

runtime_for() {
  # 이 맥에 있는 iOS 런타임 가운데 주어진 주 버전(예: 17)의 식별자. 없으면 빈 글자. 주 버전이 latest 면 가장 새 것.
  xcrun simctl list runtimes -j | python3 -c '
import json, sys
want = sys.argv[1]
rs = [r for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and r.get("platform", "iOS") == "iOS" and "iOS" in r.get("name", "")]
if want != "latest":
    rs = [r for r in rs if r["version"].split(".")[0] == want]
rs.sort(key=lambda r: [int(x) for x in r["version"].split(".")])
print((rs[-1]["identifier"] + " " + rs[-1]["version"]) if rs else "")
' "$1"
}

create_sim() {
  # 이름, 기기 종류, 런타임 → UDID(실패하면 빈 글자)
  local udid
  udid=$(xcrun simctl create "$1" "$2" "$3" 2>/dev/null) || udid=""
  if [ -n "$udid" ]; then
    xcrun simctl boot "$udid" >/dev/null 2>&1 || true
    xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true
    # 캡처의 상태 표시줄을 고정한다(새로 만든 시뮬레이터에만).
    xcrun simctl status_bar "$udid" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
    xcrun simctl ui "$udid" appearance light >/dev/null 2>&1 || true
    xcrun simctl ui "$udid" content_size large >/dev/null 2>&1 || true
  fi
  echo "$udid"
}

run_ui() {
  # 이름, UDID, 기기 표시, 그다음은 -only-testing 대상들
  local label=$1 udid=$2 device=$3
  shift 3
  local dir="$OUT/runs/$label"
  mkdir -p "$dir"
  local args=()
  for t in "$@"; do args+=("-only-testing:$t"); done
  log "화면 테스트 $label ($device): $*"
  env "${EXAM_ENV[@]}" TEST_RUNNER_SA_OUT="$dir" TEST_RUNNER_SA_DEVICE="$device" TEST_RUNNER_SA_THEME="${UI_THEME:-light}" TEST_RUNNER_SA_LOOK="$OUT/look" xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$BUILD" -resultBundlePath "$OUT/$label.xcresult" \
    "${args[@]}" "${TEST_TIME[@]}" test-without-building > "$OUT/$label.log" 2>&1
  local code=$?
  "${REPORT[@]}" xcresult "$OUT/$label.xcresult" "$OUT/ui-$label.json" "$device"
  log "화면 테스트 $label 끝(종료 코드 $code)"
}

rm -rf "$OUT"
mkdir -p "$OUT"
log "결과 폴더: $OUT"

# ---------------------------------------------------------------- 0. 환경
meta date "$(date '+%Y-%m-%d %H:%M')"
meta startedAt "$(date '+%Y-%m-%d %H:%M:%S')"
power_state() {
  # 출력을 모두 받아 둔 뒤 고른다(grep -q 나 head 가 파이프를 일찍 닫으면 pipefail 때문에 값이 틀어진다).
  local batt lid
  batt=$(pmset -g batt 2>/dev/null || true)
  lid=$(ioreg -r -k AppleClamshellState 2>/dev/null || true)
  local source level
  source=$(printf '%s\n' "$batt" | sed -n 1p | sed "s/Now drawing from //; s/'//g")
  level=$(printf '%s\n' "$batt" | sed -n 2p | sed 's/^ *-InternalBattery-0 ([^)]*)[[:space:]]*//')
  case "$lid" in
    *'"AppleClamshellState" = No'*) lid=열림 ;;
    *'"AppleClamshellState" = Yes'*) lid=닫힘 ;;
    *) lid="알 수 없음" ;;
  esac
  echo "$source, $level, 덮개 $lid"
}
meta power "$(power_state)"
meta macos "$(sw_vers -productVersion) ($(sw_vers -buildVersion))"
meta xcodeVersion "$(xcodebuild -version | head -1 | sed 's/Xcode //')"
meta xcodeBuild "$(xcodebuild -version | tail -1 | sed 's/Build version //')"
meta sdk "iphonesimulator $(xcodebuild -version -sdk iphonesimulator SDKVersion 2>/dev/null) ($(xcodebuild -version -sdk iphonesimulator ProductBuildVersion 2>/dev/null))"
meta xcodegen "$(xcodegen --version 2>/dev/null | sed 's/Version: //' || echo 없음)"
meta branch "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
meta commit "$(git -C "$REPO" rev-parse --short HEAD)"
dirty_state() {
  # 이 검증이 읽는 곳(ios, docs/ios_*.md, 다리 규격)에 커밋하지 않은 바뀜이나 추적하지 않는 파일이 있는지. 만들어지는 결과물은 뺀다.
  local changed
  # 한글 파일 이름을 \352 같은 이스케이프 없이 받아야 아래에서 이름으로 뺄 수 있다(core.quotePath=false).
  changed=$(git -C "$REPO" -c core.quotePath=false status --porcelain --untracked-files=all -- ios 'docs/ios_*.md' docs/앱_다리_규격.md 2>/dev/null \
    | grep -v -e 'docs/ios_검증결과.md' -e 'docs/screens-ios/' || true)
  if [ -n "$changed" ]; then echo yes; else echo no; fi
}
meta dirty "$(dirty_state)"

# 앞서 멈춘 실행이 남긴 검증용 시뮬레이터를 지운다(이름이 SA검증- 으로 시작하는 것만).
remove_prefixed_sims

# 시험 자료 받기의 시험 서버(작업 지시서 4의 3-3). 테스트 전용 발행물(exam-data/testdata, 읽기만 함)을 127.0.0.1 에서 내준다.
# 단위 테스트를 돌리는 앱은 데스크톱 폴더를 읽지 못해서, 테스트 전용 발행물과 배포용 앱 검사 스크립트를 데스크톱 밖 임시 폴더에 복사해 넘긴다.
TESTDATA_COPY=$(mktemp -d "${TMPDIR:-/tmp}/sa-verify-testdata.XXXXXX")
cp -R "$REPO/exam-data/testdata" "$TESTDATA_COPY/testdata" && cp "$IOS_DIR/scripts/exam_key.py" "$TESTDATA_COPY/exam_key.py"
python3 "$IOS_DIR/scripts/exam_server.py" --testdata "$REPO/exam-data/testdata" --port-file "$OUT/exam-server-port" --log "$OUT/exam-server.log" > "$OUT/exam-server.out" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do [ -s "$OUT/exam-server-port" ] && break; sleep 0.2; done
SERVER_URL=""
[ -s "$OUT/exam-server-port" ] && SERVER_URL="http://127.0.0.1:$(cat "$OUT/exam-server-port")"
if [ -n "$SERVER_URL" ] && curl -s --max-time 3 "$SERVER_URL/control/ping" | grep -q ok; then
  meta examServer "켜짐(127.0.0.1)"
  log "시험 서버: $SERVER_URL"
else
  meta examServer "켜지 못함"
  log "시험 서버를 켜지 못했다(받기 테스트가 건너뛰어 실패로 남는다)"
fi
EXAM_ENV=(TEST_RUNNER_SA_EXAM_SERVER="$SERVER_URL" TEST_RUNNER_SA_TESTDATA="$TESTDATA_COPY/testdata" TEST_RUNNER_SA_EXAM_KEY_SCRIPT="$TESTDATA_COPY/exam_key.py")

# 프로젝트 파일이 project.yml 과 같은지(XcodeGen 이 있을 때만). 지금 프로젝트 파일을 먼저 떠 두고, 다시 만든 것과 견준 뒤
# 다르면 떠 둔 것으로 되돌린다. 검증은 늘 원래 프로젝트 파일로 한다.
if command -v xcodegen >/dev/null 2>&1; then
  rm -rf "$OUT/project-before" && mkdir -p "$OUT/project-before"
  cp -R "$PROJECT" "$OUT/project-before/" && cp "$IOS_DIR/ScoreAnatomy/Info.plist" "$OUT/project-before/"
  (cd "$IOS_DIR" && xcodegen generate --quiet >/dev/null 2>&1)
  if diff -rq "$PROJECT" "$OUT/project-before/ScoreAnatomy.xcodeproj" >/dev/null 2>&1 && cmp -s "$IOS_DIR/ScoreAnatomy/Info.plist" "$OUT/project-before/Info.plist"; then
    meta projectInSync yes
  else
    meta projectInSync "다름(project.yml 로 다시 만들면 바뀜, 원래 파일로 되돌림)"
    diff -r "$PROJECT" "$OUT/project-before/ScoreAnatomy.xcodeproj" > "$OUT/project-diff.txt" 2>&1 || true
    rm -rf "$PROJECT" && cp -R "$OUT/project-before/ScoreAnatomy.xcodeproj" "$PROJECT"
    cp "$OUT/project-before/Info.plist" "$IOS_DIR/ScoreAnatomy/Info.plist"
  fi
else
  meta projectInSync "확인하지 못함(XcodeGen 없음)"
fi

# 묶음과 manifest 의 SHA-256
manifest_ok=yes
for f in app-test app-release; do
  want=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["files"][sys.argv[2] + "/index.html"]["sha256"])' "$IOS_DIR/ScoreAnatomy/Web/manifest.json" "$f")
  got=$(shasum -a 256 "$IOS_DIR/ScoreAnatomy/Web/$f/index.html" | cut -d' ' -f1)
  [ "$want" = "$got" ] || manifest_ok=no
done
meta manifestSha "$manifest_ok"
# 버전은 같은 채로 내용이 바뀔 수 있어서(0.3.1 은 웹 PR 두 개에서 내용이 달랐다) 묶음은 manifest 의 커밋과 SHA-256 으로 가려낸다.
meta manifestInfo "$(python3 -c '
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
f = m.get("files", {})
print("version {}, 커밋 {}, dirty {}, bridge {}, bridgeMax {}, app-test {}, app-release {}".format(
    m.get("version"), str(m.get("commit", ""))[:7], m.get("dirty"), m.get("bridge"), m.get("bridgeMax", "없음"),
    f.get("app-test/index.html", {}).get("sha256", "?")[:12], f.get("app-release/index.html", {}).get("sha256", "?")[:12]))
' "$IOS_DIR/ScoreAnatomy/Web/manifest.json")"

# ---------------------------------------------------------------- 시뮬레이터
LATEST=$(runtime_for latest)
LATEST_ID=${LATEST%% *}
log "주 런타임: $LATEST"
MAIN=$(create_sim "$PREFIX-iPhone17" com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$LATEST_ID"); CREATED="$CREATED $MAIN"
SE=$(create_sim "$PREFIX-iPhoneSE3" com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation "$LATEST_ID"); CREATED="$CREATED $SE"
IPAD=$(create_sim "$PREFIX-iPad" com.apple.CoreSimulator.SimDeviceType.iPad-A16 "$LATEST_ID"); CREATED="$CREATED $IPAD"
# 최소 버전(작업 지시서 4의 3-1): iOS 18.0. 이 맥에 있는 iOS 18 런타임(18.4)으로 돌려 판정에 넣는다(18.0~18.3 은 런타임이 없다).
IOS18=$(runtime_for 18)
I18=""
if [ -n "$IOS18" ]; then I18=$(create_sim "$PREFIX-iOS18" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "${IOS18%% *}"); CREATED="$CREATED $I18"; fi
[ -n "$MAIN" ] || { log "주 시뮬레이터를 만들지 못해 멈춘다"; exit 2; }
if [ -n "$SE" ]; then meta seSimulator ok; else meta seSimulator "만들지 못함"; fi
if [ -n "$IPAD" ]; then meta ipadSimulator ok; meta ipadName "iPad (A16), ${LATEST#* }"; else meta ipadSimulator "만들지 못함"; fi
meta ios18Runtime "${IOS18#* }"
meta simulators "iPhone 17, iPhone SE 3세대, iPad (A16) (iOS ${LATEST#* })$( [ -n "$I18" ] && echo ", iPhone 16 (iOS ${IOS18#* }, 최소 버전)")"

# ---------------------------------------------------------------- 1. 빌드
log "1. Debug 빌드(처음부터)"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$BUILD" clean build > "$OUT/build-debug.log" 2>&1 && meta debugBuild ok || meta debugBuild failed
log "1. Release 빌드(처음부터)"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath "$BUILD" clean build > "$OUT/build-release.log" 2>&1 && meta releaseBuild ok || meta releaseBuild failed
count_warnings() { grep -E ': warning: ' "$1" | grep -v 'appintentsmetadataprocessor' | sort -u | wc -l | tr -d ' '; }
meta debugWarnings "$(count_warnings "$OUT/build-debug.log")"
meta releaseWarnings "$(count_warnings "$OUT/build-release.log")"
meta toolNotes "$(grep -c 'appintentsmetadataprocessor.*warning' "$OUT/build-release.log" | tr -d ' ')"
grep -E ': warning: ' "$OUT/build-debug.log" "$OUT/build-release.log" | grep -v appintentsmetadataprocessor | sort -u > "$OUT/warnings.txt" || true
"${REPORT[@]}" app "$BUILD/Build/Products/Release-iphonesimulator/ScoreAnatomy.app" "$IOS_DIR/ScoreAnatomy/Web/manifest.json" release "$OUT/app-release.json"
# 19. Release 빌드 단계의 테스트 키 검사가 실제로 돌았는지(빌드 기록의 한 줄).
meta releaseKeyScan "$(grep -h '테스트 키 검사: 배포용 앱의 파일' "$OUT/build-release.log" | tail -1 | sed 's/^ *//')"
log "1. 기기용 컴파일(서명 없음, 기기에 올리지 않음)"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS' -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO build > "$OUT/build-device.log" 2>&1 && meta deviceBuild "성공" || meta deviceBuild "실패"
meta deviceKeyScan "$(grep -h '테스트 키 검사: 배포용 앱의 파일' "$OUT/build-device.log" | tail -1 | sed 's/^ *//')"

# 19. 테스트 전용 키가 든 Release 빌드는 실패해야 한다(작업 지시서 4의 3-3, docs/시험_배포_규격.md 3-1 의 3번).
# 저장소 밖(ios/build 아래)에 프로젝트를 복사해 일부러 넣고 Release 로 빌드한다. 저장소의 파일은 고치지 않는다.
keytest() {
  # 이름, 기대하는 오류 글자, 준비 함수
  local name=$1 expect=$2 prepare=$3 dir="$BUILD/keytest-$1"
  rm -rf "$dir" && mkdir -p "$dir/exam-data"
  rsync -a --exclude build --exclude .tools "$IOS_DIR/" "$dir/ios/"
  "$prepare" "$dir"
  if ! (cd "$dir/ios" && xcodegen generate --quiet >/dev/null 2>&1); then meta "keytest$name" "확인하지 못함(XcodeGen)"; return; fi
  if xcodebuild -project "$dir/ios/ScoreAnatomy.xcodeproj" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$dir/dd" build > "$OUT/keytest-$name.log" 2>&1; then
    meta "keytest$name" "빌드 성공(실패해야 함)"
  elif grep -q "$expect" "$OUT/keytest-$name.log"; then
    meta "keytest$name" "빌드 실패(기대대로)"
  else
    meta "keytest$name" "빌드 실패(다른 까닭, 로그 keytest-$name.log)"
  fi
  rm -rf "$dir"
}
TEST_KEY=$(cat "$REPO/exam-data/testdata/test-only-public-key.txt" | tr -d '\r\n')
# 배포용 묶음(폴더째 그대로 복사되는 파일)의 끝에 테스트 공개 키를 주석으로 붙인다.
prepare_embedded() { printf '<!-- %s -->\n' "$TEST_KEY" >> "$1/ios/ScoreAnatomy/Web/app-release/index.html"; }
prepare_unknown() { printf 'x\n' > "$1/ios/ScoreAnatomy/Resources/selftest-extra.txt"; }
prepare_install() { printf '%s\n' "$TEST_KEY" > "$1/exam-data/public-key.txt"; }
if command -v xcodegen >/dev/null 2>&1; then
  log "19. 테스트 키를 넣은 Release 빌드 세 가지(실패해야 함)"
  keytest Embedded "테스트 전용 공개 키(지문 f7e7dc5cfc6ce2a0)" prepare_embedded
  keytest UnknownFile "검사 목록" prepare_unknown
  keytest Install "테스트 전용 공개 키(지문 f7e7dc5cfc6ce2a0)예요" prepare_install
else
  for n in Embedded UnknownFile Install; do meta "keytest$n" "확인하지 못함(XcodeGen 없음)"; done
fi

# 21. 출시 준비(기록용): 아직 없는 것.
missing=()
grep -Eq '^SA_EXAM_BASE_URL *= *$' "$IOS_DIR/Config/Shared.xcconfig" && missing+=("받는 주소(Config/Shared.xcconfig 의 SA_EXAM_BASE_URL 이 빈 값)")
[ -f "$REPO/exam-data/public-key.txt" ] || missing+=("진짜 공개 키(exam-data/public-key.txt 없음)")
if grep -Eq '^DEVELOPMENT_TEAM *= *$' "$IOS_DIR/Config/Shared.xcconfig" && ! grep -Eqs '^DEVELOPMENT_TEAM *= *[A-Z0-9]' "$IOS_DIR/Config/Signing.local.xcconfig"; then missing+=("서명 팀(DEVELOPMENT_TEAM 이 빈 값)"); fi
grep -q '번들 ID 는 임시 값이다' "$IOS_DIR/Config/Shared.xcconfig" && missing+=("확정한 번들 ID(지금 $(sed -n 's/^SA_BUNDLE_ID *= *//p' "$IOS_DIR/Config/Shared.xcconfig") 는 임시 값)")
meta releaseMissing "$( [ ${#missing[@]} -gt 0 ] && printf '%s, ' "${missing[@]}" | sed 's/, $//' || echo 없음)"

# ---------------------------------------------------------------- 정적 검사(6, 11)
log "6, 11. 소스 검사"
"${REPORT[@]}" scan "$IOS_DIR" "$REPO" "$OUT/scan.json"

# ---------------------------------------------------------------- 2. 단위 테스트와 화면 테스트 빌드
log "테스트 빌드(Debug)"
# 링커 설정이 모든 테스트 바이너리에 확실히 들어가게 처음부터 다시 만든다.
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" "$TEST_LDFLAGS" clean build-for-testing > "$OUT/build-tests.log" 2>&1 || log "테스트 빌드 실패(로그: $OUT/build-tests.log)"
debug_map_entries=0
for bin in "$BUILD/Build/Products/Debug-iphonesimulator/ScoreAnatomy.app/ScoreAnatomy.debug.dylib" \
           "$BUILD/Build/Products/Debug-iphonesimulator/ScoreAnatomy.app/PlugIns/ScoreAnatomyTests.xctest/ScoreAnatomyTests" \
           "$BUILD/Build/Products/Debug-iphonesimulator/ScoreAnatomyUITests-Runner.app/PlugIns/ScoreAnatomyUITests.xctest/ScoreAnatomyUITests"; do
  [ -f "$bin" ] && debug_map_entries=$((debug_map_entries + $(dsymutil -s "$bin" 2>/dev/null | grep -c N_OSO)))
done
meta testDebugMapEntries "$debug_map_entries"
[ "$debug_map_entries" = 0 ] || log "경고: 테스트 바이너리에 디버그 맵 항목이 $debug_map_entries 개 남아 있다(실패하면 멈출 수 있다)"
"${REPORT[@]}" app "$BUILD/Build/Products/Debug-iphonesimulator/ScoreAnatomy.app" "$IOS_DIR/ScoreAnatomy/Web/manifest.json" debug "$OUT/app-debug.json"
log "2. 단위 테스트"
mkdir -p "$OUT/runs/unit"
env "${EXAM_ENV[@]}" TEST_RUNNER_SA_OUT="$OUT/runs/unit" xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "platform=iOS Simulator,id=$MAIN" \
  -derivedDataPath "$BUILD" -resultBundlePath "$OUT/unit.xcresult" -only-testing:ScoreAnatomyTests "${TEST_TIME[@]}" test-without-building > "$OUT/unit.log" 2>&1
"${REPORT[@]}" xcresult "$OUT/unit.xcresult" "$OUT/unit.json" iphone17

# ---------------------------------------------------------------- 3~7, 12, 13: iPhone 17
run_ui main "$MAIN" iphone17 \
  ScoreAnatomyUITests/FlowTests ScoreAnatomyUITests/RestartTests ScoreAnatomyUITests/RhythmTests \
  ScoreAnatomyUITests/NetworkProbeTests ScoreAnatomyUITests/FontScaleUITests/testDefaultSize \
  ScoreAnatomyUITests/FontScaleUITests/testLargestStandardSize ScoreAnatomyUITests/FontScaleUITests/testAccessibilitySize \
  ScoreAnatomyUITests/FontScaleUITests/testLargestAccessibilitySizeIsCappedAtTwo ScoreAnatomyUITests/BridgeIntegrationTests \
  ScoreAnatomyUITests/StartScreenTests ScoreAnatomyUITests/AccessibilityAuditTests ScoreAnatomyUITests/CaptureTests \
  ScoreAnatomyUITests/KeyboardInputTests ScoreAnatomyUITests/FastTapTests ScoreAnatomyUITests/WebFixScreenTests \
  ScoreAnatomyUITests/LookTests ScoreAnatomyUITests/RemoteFetchTests

# 13. 어두운 화면 캡처: 이 맥의 시뮬레이터에서는 시스템 밝기 바꾸기(simctl ui appearance)가 앱에 닿지 않아서,
# 캡처 테스트가 DEBUG 실행 인자(-SAAppearance dark)로 앱의 밝기를 정한다.
dark_capture() {
  local label=$1 udid=$2 device=$3
  UI_THEME=dark run_ui "$label" "$udid" "$device" ScoreAnatomyUITests/CaptureTests
}
dark_capture main-dark "$MAIN" iphone17

# 7. 켜 둔 채 글자 크기를 바꾸면 fontScale 로 알리는지(시뮬레이터의 글자 크기를 이 스크립트가 바꾼다).
log "7. 켜 둔 채 글자 크기 바꾸기"
LIVE="$OUT/runs/live"
mkdir -p "$LIVE"
TEST_RUNNER_SA_OUT="$LIVE" TEST_RUNNER_SA_DEVICE=iphone17 TEST_RUNNER_SA_LIVE_FONT=1 xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
  -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" -resultBundlePath "$OUT/live.xcresult" \
  -only-testing:ScoreAnatomyUITests/FontScaleUITests/testLiveChangeIsSentToWeb "${TEST_TIME[@]}" test-without-building > "$OUT/live.log" 2>&1 &
LIVE_PID=$!
for _ in $(seq 1 360); do [ -f "$LIVE/live-font-ready" ] && break; sleep 0.5; done
if [ -f "$LIVE/live-font-ready" ]; then
  xcrun simctl ui "$MAIN" content_size accessibility-medium
  sleep 0.5
  touch "$LIVE/live-font-changed"
fi
wait $LIVE_PID
xcrun simctl ui "$MAIN" content_size large >/dev/null 2>&1 || true
"${REPORT[@]}" xcresult "$OUT/live.xcresult" "$OUT/ui-live.json" iphone17

# ---------------------------------------------------------------- 8. iPhone SE 3세대
if [ -n "$SE" ]; then
  run_ui se "$SE" iphonese ScoreAnatomyUITests/FlowTests ScoreAnatomyUITests/SmallScreenTests ScoreAnatomyUITests/CaptureTests \
    ScoreAnatomyUITests/WebFixScreenTests/testKeypadPanelReachesScreenBottom
  dark_capture se-dark "$SE" iphonese
fi

# ---------------------------------------------------------------- 9. iPad
if [ -n "$IPAD" ]; then
  run_ui ipad "$IPAD" ipad ScoreAnatomyUITests/StartScreenTests
fi

# ---------------------------------------------------------------- 10. 최소 버전(iOS 18), 22. 3-2 되풀이 재기
if [ -n "$I18" ]; then
  run_ui ios18 "$I18" ios18 ScoreAnatomyUITests/FlowTests ScoreAnatomyUITests/RestartTests ScoreAnatomyUITests/FastTapTests ScoreAnatomyUITests/RemoteFetchTests
  # 22. 기록용: 누르는 동안 온 dblclick 규칙(웹 0.3.2)을 iOS 18.4 에서 되풀이해 잰다.
  run_ui held18 "$I18" iphone16 ScoreAnatomyUITests/HeldDoubleTapTests
fi
# 22. 같은 되풀이를 iOS 26.4 에서도 잰다(나빠진 것이 없는지).
run_ui held26 "$MAIN" iphone17 ScoreAnatomyUITests/HeldDoubleTapTests

# ---------------------------------------------------------------- 추가: Release 구성으로 켜기
# 1번의 Release 앱 검사를 마친 뒤에 한다. 화면 테스트를 붙이려고 이 빌드에만 ENABLE_TESTABILITY 를 켠다(코드는 같다).
log "Release 구성으로 켜기"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" \
  "$TEST_LDFLAGS" ENABLE_TESTABILITY=YES build-for-testing > "$OUT/build-release-tests.log" 2>&1 || log "Release 테스트 빌드 실패(로그: $OUT/build-release-tests.log)"
mkdir -p "$OUT/runs/release" "$OUT/runs/release-look"
# 15. 배포용 묶음의 모양(작업 지시서 3-2의 3-3): Release 앱은 기록 위치를 바꾸는 장치가 없어 앱 저장 공간을 쓴다. 앞 실행의
# 기록이 남지 않게 앱을 지운 뒤(xcodebuild 가 다시 깐다) Debug 와 같은 새 상태에서 시작한다. Debug 쪽은 위의 주 기기 실행이 찍었다.
APP_ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$BUILD/Build/Products/Release-iphonesimulator/ScoreAnatomy.app/Info.plist" 2>/dev/null || echo "")
[ -n "$APP_ID" ] && xcrun simctl uninstall "$MAIN" "$APP_ID" >/dev/null 2>&1
log "15. Release 모양 비교(LookTests)"
env "${EXAM_ENV[@]}" TEST_RUNNER_SA_OUT="$OUT/runs/release-look" TEST_RUNNER_SA_DEVICE=iphone17 TEST_RUNNER_SA_CONFIG=Release TEST_RUNNER_SA_LOOK="$OUT/look" xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" -resultBundlePath "$OUT/release-look.xcresult" \
  -only-testing:ScoreAnatomyUITests/LookTests "${TEST_TIME[@]}" test-without-building > "$OUT/release-look.log" 2>&1
"${REPORT[@]}" xcresult "$OUT/release-look.xcresult" "$OUT/ui-release-look.json" iphone17
env "${EXAM_ENV[@]}" TEST_RUNNER_SA_OUT="$OUT/runs/release" TEST_RUNNER_SA_DEVICE=iphone17 TEST_RUNNER_SA_CONFIG=Release xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" -resultBundlePath "$OUT/release.xcresult" \
  -only-testing:ScoreAnatomyUITests/ReleaseSmokeTests "${TEST_TIME[@]}" test-without-building > "$OUT/release.log" 2>&1
"${REPORT[@]}" xcresult "$OUT/release.xcresult" "$OUT/ui-release.json" iphone17

# ---------------------------------------------------------------- 13. 캡처 모으기
rm -rf "$OUT/screens"
mkdir -p "$OUT/screens"
for pair in "main:iphone17:light" "main-dark:iphone17:dark" "se:iphonese:light" "se-dark:iphonese:dark"; do
  run=${pair%%:*}; rest=${pair#*:}; device=${rest%%:*}; theme=${rest#*:}
  if [ -d "$OUT/runs/$run/screens/$device/$theme" ]; then
    mkdir -p "$OUT/screens/$device/$theme"
    cp "$OUT/runs/$run/screens/$device/$theme"/*.png "$OUT/screens/$device/$theme/" 2>/dev/null || true
  fi
done
rm -rf "$REPO/docs/screens-ios"
"${REPORT[@]}" captures "$OUT/screens" "$REPO/docs/screens-ios" "$OUT/captures.json"
# 목록(9화면 x 2테마 x 2기기) 밖의 캡처는 참고용으로 extra 에 기기와 테마를 붙여 모은다.
"${REPORT[@]}" extras "$OUT/runs" "$REPO/docs/screens-ios/extra" > "$OUT/extras.json"
# 15. Release 와 Debug 의 같은 화면(iPhone 17, 밝은 화면).
for config in Debug Release; do
  lower=$(echo "$config" | tr 'A-Z' 'a-z')
  mkdir -p "$REPO/docs/screens-ios/release/$lower"
  cp "$OUT/look/$config"/*.png "$REPO/docs/screens-ios/release/$lower/" 2>/dev/null || true
done

# 22. 3-2 되풀이 재기의 이벤트 기록(사라진 경우, 채운 경우, 세 번 누름)을 docs 아래 글자 파일로.
rm -rf "$REPO/docs/ios_누름기록"
mkdir -p "$REPO/docs/ios_누름기록"
for run in held18 held26; do
  cp "$OUT/runs/$run/held"/*.txt "$REPO/docs/ios_누름기록/" 2>/dev/null || true
done

# ---------------------------------------------------------------- 문서
meta finishedAt "$(date '+%Y-%m-%d %H:%M:%S')"
meta dirtyAtEnd "$(dirty_state)"
log "docs/ios_검증결과.md 쓰기"
"${REPORT[@]}" render "$OUT" "$REPO/docs/ios_검증결과.md"
status=$?
log "끝(실패 항목이 있으면 종료 코드 1): $status"
exit $status
