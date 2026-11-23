#!/bin/bash
# 점수 해부 iOS 앱 껍데기의 자동 검증(작업 지시서 2의 6장). 빌드, 단위 테스트, 화면 테스트, 정적 검사, 캡처를 모두 돌리고
# docs/ios_검증결과.md 를 쓴다. 저장소 어디에서 불러도 된다: ios/scripts/verify.sh
#
# 이 맥에 남기는 것: 빌드 산출물과 테스트 결과는 ios/build 에만 둔다(-derivedDataPath ios/build).
# 검증에 쓸 시뮬레이터는 이름이 "SA검증-" 으로 시작하게 새로 만들고, 끝나면(중간에 멈춰도) 지운다.
# 원래 있던 시뮬레이터와 시스템 설정은 건드리지 않는다. 언어와 지역은 실행 인자로 준다(화면 테스트 쪽).
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

log() { printf '[verify %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

cleanup() {
  for udid in $CREATED; do
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  done
}
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
    CREATED="$CREATED $udid"
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
  TEST_RUNNER_SA_OUT="$dir" TEST_RUNNER_SA_DEVICE="$device" xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
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
meta macos "$(sw_vers -productVersion) ($(sw_vers -buildVersion))"
meta xcodeVersion "$(xcodebuild -version | head -1 | sed 's/Xcode //')"
meta xcodeBuild "$(xcodebuild -version | tail -1 | sed 's/Build version //')"
meta sdk "iphonesimulator $(xcodebuild -version -sdk iphonesimulator SDKVersion 2>/dev/null) ($(xcodebuild -version -sdk iphonesimulator ProductBuildVersion 2>/dev/null))"
meta xcodegen "$(xcodegen --version 2>/dev/null | sed 's/Version: //' || echo 없음)"
meta branch "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
meta commit "$(git -C "$REPO" rev-parse --short HEAD)"
if [ -n "$(git -C "$REPO" status --porcelain -- ios docs/앱_다리_규격.md)" ]; then meta dirty yes; else meta dirty no; fi

# 앞서 멈춘 실행이 남긴 검증용 시뮬레이터를 지운다(이름이 SA검증- 으로 시작하는 것만).
for old in $(xcrun simctl list devices -j | python3 -c '
import json, sys
for rt, devs in json.load(sys.stdin)["devices"].items():
    for d in devs:
        if d["name"].startswith(sys.argv[1] + "-"):
            print(d["udid"])
' "$PREFIX"); do
  log "남아 있던 검증용 시뮬레이터 지움: $old"
  xcrun simctl shutdown "$old" >/dev/null 2>&1 || true
  xcrun simctl delete "$old" >/dev/null 2>&1 || true
done

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

# ---------------------------------------------------------------- 시뮬레이터
LATEST=$(runtime_for latest)
LATEST_ID=${LATEST%% *}
log "주 런타임: $LATEST"
MAIN=$(create_sim "$PREFIX-iPhone17" com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$LATEST_ID")
SE=$(create_sim "$PREFIX-iPhoneSE3" com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation "$LATEST_ID")
IPAD=$(create_sim "$PREFIX-iPad" com.apple.CoreSimulator.SimDeviceType.iPad-A16 "$LATEST_ID")
IOS17=$(runtime_for 17)
IOS18=$(runtime_for 18)
OLD=""
if [ -n "$IOS17" ]; then OLD=$(create_sim "$PREFIX-iOS17" com.apple.CoreSimulator.SimDeviceType.iPhone-15 "${IOS17%% *}"); fi
I18=""
if [ -z "$IOS17" ] && [ -n "$IOS18" ]; then I18=$(create_sim "$PREFIX-iOS18" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "${IOS18%% *}"); fi
[ -n "$MAIN" ] || { log "주 시뮬레이터를 만들지 못해 멈춘다"; exit 2; }
if [ -n "$SE" ]; then meta seSimulator ok; else meta seSimulator "만들지 못함"; fi
if [ -n "$IPAD" ]; then meta ipadSimulator ok; meta ipadName "iPad (A16), ${LATEST#* }"; else meta ipadSimulator "만들지 못함"; fi
meta ios17Runtime "${IOS17#* }"
meta ios18Runtime "${IOS18#* }"
meta simulators "iPhone 17, iPhone SE 3세대, iPad (A16) (iOS ${LATEST#* })$( [ -n "$OLD" ] && echo ", iPhone 15 (iOS ${IOS17#* })")$( [ -n "$I18" ] && echo ", iPhone 16 (iOS ${IOS18#* }, 참고용)")"

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
log "1. 기기용 컴파일(서명 없음, 기기에 올리지 않음)"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS' -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO build > "$OUT/build-device.log" 2>&1 && meta deviceBuild "성공" || meta deviceBuild "실패"

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
TEST_RUNNER_SA_OUT="$OUT/runs/unit" xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "platform=iOS Simulator,id=$MAIN" \
  -derivedDataPath "$BUILD" -resultBundlePath "$OUT/unit.xcresult" -only-testing:ScoreAnatomyTests "${TEST_TIME[@]}" test-without-building > "$OUT/unit.log" 2>&1
"${REPORT[@]}" xcresult "$OUT/unit.xcresult" "$OUT/unit.json" iphone17

# ---------------------------------------------------------------- 3~7, 12, 13: iPhone 17
run_ui main "$MAIN" iphone17 \
  ScoreAnatomyUITests/FlowTests ScoreAnatomyUITests/RestartTests ScoreAnatomyUITests/RhythmTests \
  ScoreAnatomyUITests/NetworkProbeTests ScoreAnatomyUITests/FontScaleUITests/testDefaultSize \
  ScoreAnatomyUITests/FontScaleUITests/testLargestStandardSize ScoreAnatomyUITests/FontScaleUITests/testAccessibilitySize \
  ScoreAnatomyUITests/FontScaleUITests/testLargestAccessibilitySizeIsCappedAtTwo ScoreAnatomyUITests/BridgeIntegrationTests \
  ScoreAnatomyUITests/StartScreenTests ScoreAnatomyUITests/AccessibilityAuditTests ScoreAnatomyUITests/CaptureTests \
  ScoreAnatomyUITests/KeyboardInputTests

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
  run_ui se "$SE" iphonese ScoreAnatomyUITests/FlowTests ScoreAnatomyUITests/SmallScreenTests ScoreAnatomyUITests/CaptureTests
fi

# ---------------------------------------------------------------- 9. iPad
if [ -n "$IPAD" ]; then
  run_ui ipad "$IPAD" ipad ScoreAnatomyUITests/StartScreenTests
fi

# ---------------------------------------------------------------- 10. 최소 버전
if [ -n "$OLD" ]; then
  run_ui old "$OLD" ios17 ScoreAnatomyUITests/FlowTests
elif [ -n "$I18" ]; then
  # iOS 17 런타임이 없어서 10번은 확인하지 못한다. 참고로 이 맥에 있는 가장 낮은 런타임에서 흐름을 한 번 돌린다.
  run_ui ios18 "$I18" ios18 ScoreAnatomyUITests/FlowTests
fi

# ---------------------------------------------------------------- 추가: Release 구성으로 켜기
# 1번의 Release 앱 검사를 마친 뒤에 한다. 화면 테스트를 붙이려고 이 빌드에만 ENABLE_TESTABILITY 를 켠다(코드는 같다).
log "Release 구성으로 켜기"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" \
  "$TEST_LDFLAGS" ENABLE_TESTABILITY=YES build-for-testing > "$OUT/build-release-tests.log" 2>&1 || log "Release 테스트 빌드 실패(로그: $OUT/build-release-tests.log)"
mkdir -p "$OUT/runs/release"
TEST_RUNNER_SA_OUT="$OUT/runs/release" TEST_RUNNER_SA_DEVICE=iphone17 TEST_RUNNER_SA_CONFIG=Release xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -destination "platform=iOS Simulator,id=$MAIN" -derivedDataPath "$BUILD" -resultBundlePath "$OUT/release.xcresult" \
  -only-testing:ScoreAnatomyUITests/ReleaseSmokeTests "${TEST_TIME[@]}" test-without-building > "$OUT/release.log" 2>&1
"${REPORT[@]}" xcresult "$OUT/release.xcresult" "$OUT/ui-release.json" iphone17

# ---------------------------------------------------------------- 13. 캡처 모으기
rm -rf "$OUT/screens"
mkdir -p "$OUT/screens"
[ -d "$OUT/runs/main/screens/iphone17" ] && cp -R "$OUT/runs/main/screens/iphone17" "$OUT/screens/"
[ -d "$OUT/runs/se/screens/iphonese" ] && cp -R "$OUT/runs/se/screens/iphonese" "$OUT/screens/"
rm -rf "$REPO/docs/screens-ios"
"${REPORT[@]}" captures "$OUT/screens" "$REPO/docs/screens-ios" "$OUT/captures.json"
mkdir -p "$REPO/docs/screens-ios/extra"
[ -f "$OUT/runs/ipad/screens/ipad/light/시작.png" ] && cp "$OUT/runs/ipad/screens/ipad/light/시작.png" "$REPO/docs/screens-ios/extra/ipad-시작.png"
[ -f "$OUT/runs/main/screens/iphone17/light/불러오기실패.png" ] && cp "$OUT/runs/main/screens/iphone17/light/불러오기실패.png" "$REPO/docs/screens-ios/extra/iphone17-불러오기실패.png"
for f in "$OUT"/runs/main/screens/iphone17/light/글자-*.png "$OUT"/runs/main/screens/iphone17/light/진행자-자판.png "$OUT"/runs/release/screens/iphone17/light/release-기록.png; do
  [ -f "$f" ] && cp "$f" "$REPO/docs/screens-ios/extra/iphone17-$(basename "$f")"
done

# ---------------------------------------------------------------- 문서
log "docs/ios_검증결과.md 쓰기"
"${REPORT[@]}" render "$OUT" "$REPO/docs/ios_검증결과.md"
status=$?
log "끝(실패 항목이 있으면 종료 코드 1): $status"
exit $status
