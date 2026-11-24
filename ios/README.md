# 모고칸 iOS 앱 껍데기

아이폰 앱(홈 화면 이름 "모고칸", 2026-11-24 에 정함)은 화면 전체를 차지하는 웹뷰 하나에 이 저장소(score-anatomy)의 앱용 웹 묶음을 싣는 얇은 껍데기예요. 화면과 계산은 웹 코드가 그대로 맡고, 껍데기는 기록 파일 저장, 햅틱, 글자 크기 전달, 복사, 바깥 통신 차단만 맡아요. 웹과의 약속은 [docs/앱_다리_규격.md](../docs/앱_다리_규격.md) 에 있고, 이 껍데기는 그 가운데 규격 1(1~6장)을 따라요. 정해진 주소에서 받은 시험 자료를 웹에 넘기는 규격 2(7장)는 구현하지 않았어요(작업 지시서 4). 웹 묶음 0.3.1 은 규격 1과 2를 받아서(manifest 의 bridge 1, bridgeMax 2) 규격 1 껍데기에서 그대로 돌고, 이때는 시험 선택 화면에 받은 자료 안내와 "새로 확인"이 나오지 않아요.

## 1. Xcode 에서 열기

1. Xcode 26 이상을 설치해요(App Store 또는 developer.apple.com).
2. Finder 에서 `ios/ScoreAnatomy.xcodeproj` 를 두 번 눌러 열어요. XcodeGen 은 없어도 돼요(만든 프로젝트 파일을 함께 커밋해 뒀어요).
3. 창 위쪽 가운데의 실행 대상에서 시뮬레이터(예: iPhone 17)를 골라요.
4. 왼쪽 위의 실행 버튼(삼각형)이나 Command + R 로 켜요. Debug 빌드라 시험용 묶음(진행자용 화면 포함)이 실려요.

명령줄로 시뮬레이터용 빌드만 할 때:

```bash
xcodebuild -project ios/ScoreAnatomy.xcodeproj -scheme ScoreAnatomy -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build build
```

내 아이폰에 올리는 방법(Apple 계정, Team, 번들 ID, 개발자 모드)은 [docs/ios_실기기_확인표.md](../docs/ios_실기기_확인표.md) 에 처음 쓰는 사람 기준으로 적었어요.

## 2. 구조

| 경로 | 내용 |
| --- | --- |
| `project.yml` | XcodeGen 설정. 프로젝트 파일은 이것으로 만들어요 |
| `ScoreAnatomy.xcodeproj` | 만든 프로젝트 파일(커밋함, 손으로 고치지 않음) |
| `Config/Shared.xcconfig` | 번들 ID(SA_BUNDLE_ID)와 서명 팀(DEVELOPMENT_TEAM, 비어 있음). `Signing.local.xcconfig` 가 있으면 그 값으로 덮어써요 |
| `ScoreAnatomy/App` | 앱 시작점(SwiftUI), 배경색, 불러오기 실패 안내 |
| `ScoreAnatomy/Shell` | 웹뷰를 만들고 싣는 껍데기의 중심(ShellController), 통신 차단(NetworkGuard) |
| `ScoreAnatomy/Bridge` | 다리 규격 번호, 웹이 보낸 메시지 읽기, 웹에 알리는 글자, `window.__SA_APP__` 스크립트 |
| `ScoreAnatomy/Store` | 기록 파일(store.json) 저장, 보관, 저장하는 동안 잡아 두는 백그라운드 시간 |
| `ScoreAnatomy/Device` | 글자 크기 배율, 햅틱, 복사 |
| `ScoreAnatomy/Debug` | 시험과 캡처에만 쓰는 장치(DEBUG 빌드 전용, Release 에서는 파일째 빠짐) |
| `ScoreAnatomy/Resources` | 아이콘(임시), 켤 때 배경색, PrivacyInfo.xcprivacy |
| `ScoreAnatomy/Web` | 웹 묶음(app-test, app-release)과 manifest.json. 웹 쪽 산출물이라 여기서 고치지 않아요 |
| `ScoreAnatomyTests` | 단위 테스트(저장, 글자 크기, manifest 의 SHA-256, 차단 규칙, 다리 메시지) |
| `ScoreAnatomyUITests` | 화면 테스트(XCUITest). 빠른 누름과 웹이 받은 이벤트(FastTapTests), 웹에서 고친 화면(WebFixScreenTests), Release 와 Debug 의 모양 비교(LookTests)도 여기 있어요 |
| `scripts/verify.sh` | 자동 검증 전체. 결과는 docs/ios_검증결과.md |
| `scripts/sync_version.py` | 앱 버전(project.yml 의 MARKETING_VERSION)을 웹 묶음의 버전(manifest.json 의 version)에 맞춰요. `--check` 는 견주기만 해요 |

- Debug 빌드는 시험용 묶음(`Web/app-test`), Release 빌드는 배포용 묶음(`Web/app-release`)만 실어요. 고르는 곳은 `project.yml` 의 `EXCLUDED_SOURCE_FILE_NAMES` 예요.
- 기록은 앱 전용 폴더(Application Support/번들 ID/store.json)에만 둬요. 서버로 보내지 않아요. 기기 백업에서 일부러 빼지는 않아요.
- 앱 껍데기에는 외부 패키지, 네트워크 API, 권한 요청, 분석이나 광고 도구, 계정이 없어요. 작업 지시서 3은 껍데기가 정해진 주소 한 곳에서 시험 자료를 받기로 정했어요. 그 받기(작업 지시서 4)가 들어오면 네트워크 API 는 그 받기에만 써요.
- 앱 이름(홈 화면)만 "모고칸"이고, 번들 ID(com.junnyson.scoreanatomy, 임시)와 타깃, 프로젝트 이름(ScoreAnatomy)은 그대로예요. 웹 묶음 안의 화면 제목은 아직 "점수 해부"예요(웹 쪽 몫, docs/ios_결정기록.md 3장).

## 3. 테스트와 검증

```bash
caffeinate -dims ios/scripts/verify.sh
```

- 시뮬레이터를 새로 만들어(이름이 `SA검증-` 으로 시작) 빌드, 단위 테스트, 화면 테스트, 정적 검사, 캡처를 모두 돌리고 끝나면 그 시뮬레이터를 지워요. 시간은 docs/ios_검증결과.md 의 실행 시각에 적혀요(2026-11-24 기준 1시간 반쯤).
- 도는 동안 맥이 잠들면 화면 테스트가 멈춰 실패해요. 전원 어댑터를 꽂고 덮개를 연 채로, 위처럼 `caffeinate` 로 감싸 돌려요. 끝난 뒤 `pmset -g log | grep -E "Sleep|Wake"` 로 실행 시각 사이에 잠든 기록이 없는지 봐요(덮개가 닫히면 caffeinate 가 있어도 잠들어요).
- 시작할 때 앱 버전이 웹 묶음 버전과 다르면 아무것도 돌리지 않고 멈춰요(5장).
- 결과는 [docs/ios_검증결과.md](../docs/ios_검증결과.md), 캡처는 `docs/screens-ios`, 로그와 테스트 결과 묶음은 `ios/build/verify` 에 남아요(커밋하지 않음).
- Xcode 에서 테스트만 돌릴 때는 Command + U 예요. 화면 테스트는 DEBUG 전용 실행 인자로 기록 폴더를 따로 쓰고 탐침을 켜요(`ScoreAnatomy/Debug/DebugOptions.swift`). 빠른 누름 테스트는 `-SAEventLog` 로 웹이 받은 이벤트를 적어요.
- 간격을 정한 누름(TouchSynth)은 XCUITest 안의 비공개 장치를 써요. 이 맥(Xcode 26.4.1)에서는 누름 시작 사이를 0.07초 남짓(아주 빠른 두 번 누름)과 0.28초 이상으로만 만들 수 있었어요(`ScoreAnatomyUITests/Support/TouchSynth.swift` 의 설명).
- 주의: 저장소가 맥의 데스크톱 폴더 안에 있으면 Xcode 26.4 의 XCTest 가 테스트 실패를 기록하다 멈춰요(실패 메시지 없이 시간 초과). 실패 위치를 찾으려고 빌드 중간 파일(ios/build 아래 .o)을 열다 막혀요. verify.sh 는 테스트 빌드에만 링커 설정 `-Wl,-S`(디버그 맵 빼기)를 덧붙여 피해요. Xcode 에서 직접 테스트를 돌리다 멈추면 저장소를 데스크톱 밖(예: 홈 폴더 아래 Developer)으로 옮기거나 verify.sh 를 써요. 한글이 든 경로 자체는 문제가 아니었어요.

## 4. 프로젝트 파일을 다시 만들 때

`project.yml` 을 고쳤으면 다시 만들어 둘 다 커밋해요.

```bash
brew install xcodegen
```

```bash
cd ios && xcodegen generate
```

- 이 저장소는 XcodeGen 2.47.0 으로 만들었어요. 버전이 다르면 프로젝트 파일의 내용이 조금 달라질 수 있어요.
- 주의할 점: 다시 만들면 Xcode 에서 직접 바꾼 프로젝트 설정(Signing & Capabilities 에서 고른 Team, 바꾼 번들 ID 등)이 지워져요.
- 서명 팀과 번들 ID 가 지워지지 않게 하려면 Xcode 화면 대신 `ios/Config/Signing.local.xcconfig` 파일을 만들어 적어요. 이 파일은 커밋하지 않아요(.gitignore).

```
DEVELOPMENT_TEAM = ABCDE12345
SA_BUNDLE_ID = com.내이름.scoreanatomy
```

  Team ID(10자리)는 Xcode 의 Settings, Accounts 에서 계정을 고르고 팀을 보면 나와요. 이렇게 두면 `xcodegen generate` 뒤에도 그대로예요.

## 5. 웹 묶음이 바뀌었을 때 할 일

1. 웹 쪽에서 `npm run build:app` 으로 묶음과 manifest.json 을 새로 만들어 커밋해요(작업 지시서 1의 방식). 이 폴더의 파일을 손으로 고치지 않아요.
2. 앱 버전을 맞춰요. 아래 스크립트가 manifest.json 의 `version` 과 `project.yml` 의 `MARKETING_VERSION`, 프로젝트 파일의 값을 견주고, 다르면 project.yml 을 고친 뒤 XcodeGen 2.47.0 으로 프로젝트 파일을 다시 만들어요(XcodeGen 이 없거나 판이 다르면 프로젝트 파일의 버전 줄만 바꿔요). 다시 만든 뒤 버전 말고 바뀐 줄(서명 설정 등)이 있으면 알리고 종료 코드 3으로 끝나요.

   ```bash
   ios/scripts/sync_version.py
   ```

   견주기만 할 때는 `ios/scripts/sync_version.py --check` 예요. verify.sh 도 시작할 때 이것으로 견주고, 다르면 멈춰요. 단위 테스트도 앱의 버전이 manifest 와 같은지 봐요.
3. 다리 규격 번호를 봐요. `ScoreAnatomy/Bridge/BridgeSpec.swift` 의 `version` 이 manifest.json 의 `bridge`(묶음이 돌아가는 가장 낮은 규격) 이상, `bridgeMax`(웹이 아는 가장 높은 규격, 없으면 `bridge`) 이하여야 해요(docs/앱_다리_규격.md 7-2, 단위 테스트가 봐요). 그 사이가 아니면 다리 규격이 바뀐 것이라 docs/앱_다리_규격.md 를 읽고 껍데기도 함께 고쳐요. 지금 묶음은 bridge 1, bridgeMax 2 이고 껍데기는 1이에요.
4. 같은 버전 번호로 내용이 바뀔 수 있어요(0.3.1 은 웹 PR 두 개에서 내용이 달랐어요). 그래서 묶음은 버전이 아니라 manifest 의 `commit` 과 SHA-256 으로 가려내요. 단위 테스트가 앱 안의 묶음과 manifest 의 SHA-256 을 견주고, verify 결과 문서 첫머리에 커밋과 SHA-256 앞자리가 적혀요.
5. `caffeinate -dims ios/scripts/verify.sh` 로 모두 통과하는지 봐요(3장).
6. 화면 문구가 바뀌어 화면 테스트가 깨지면, 바뀐 글자를 docs/결정기록.md 와 웹 소스(src/strings.ts 등)에서 확인한 뒤 테스트의 글자를 맞춰요. 테스트를 느슨하게(찾는 글자를 줄이거나 확인을 빼게) 바꾸지 않아요.
7. 앱 버전 맞춤은 따로 커밋해요(예: "앱 버전을 웹 묶음 0.3.1 에 맞춤").
