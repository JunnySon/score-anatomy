# 모고칸 iOS 앱 껍데기

아이폰 앱(홈 화면 이름 "모고칸", 2026-11-24 에 정함)은 화면 전체를 차지하는 웹뷰 하나에 이 저장소(score-anatomy)의 앱용 웹 묶음을 싣는 얇은 껍데기예요. 화면과 계산은 웹 코드가 그대로 맡고, 껍데기는 기록 파일 저장, 햅틱, 글자 크기 전달, 복사, 웹뷰의 바깥 통신 차단, 그리고 정해진 주소에서 시험 자료를 받아 서명을 확인해 웹에 넘기는 일만 맡아요. 웹과의 약속은 [docs/앱_다리_규격.md](../docs/앱_다리_규격.md) 에 있고, 이 껍데기는 규격 2(7장, 작업 지시서 4)를 따라요. 규격 1(1~6장)의 일은 그대로 해요. 웹 묶음 0.3.2 는 규격 1과 2를 받아요(manifest 의 bridge 1, bridgeMax 2). 받는 주소와 진짜 공개 키는 아직 없어서(6장) 지금 앱은 받기를 하지 않고, 이때 시험 선택 화면에는 받은 자료 안내와 "새로 확인"이 나오지 않아요(규격 1 때와 같은 화면). 최소 버전은 iOS 18.0 이에요.

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
| `Config/Shared.xcconfig` | 번들 ID(SA_BUNDLE_ID), 서명 팀(DEVELOPMENT_TEAM, 비어 있음), 시험 자료를 받는 주소(SA_EXAM_BASE_URL, 비어 있음). `Signing.local.xcconfig` 가 있으면 그 값으로 덮어써요 |
| `ScoreAnatomy/App` | 앱 시작점(SwiftUI), 배경색, 불러오기 실패 안내 |
| `ScoreAnatomy/Shell` | 웹뷰를 만들고 싣는 껍데기의 중심(ShellController), 웹뷰의 통신 차단(NetworkGuard) |
| `ScoreAnatomy/Bridge` | 다리 규격 번호, 웹이 보낸 메시지 읽기, 웹에 알리는 글자, `window.__SA_APP__` 스크립트 |
| `ScoreAnatomy/Remote` | 시험 자료 받기(규격 2): 엄격한 JSON 읽기, 발행물 확인(서명, 모양, SHA-256), URLSession 받기(껍데기가 통신하는 유일한 곳), 보관, 언제 받을지 |
| `ScoreAnatomy/Store` | 기록 파일(store.json) 저장, 보관, 저장하는 동안 잡아 두는 백그라운드 시간 |
| `ScoreAnatomy/Device` | 글자 크기 배율, 햅틱, 복사 |
| `ScoreAnatomy/Debug` | 시험과 캡처에만 쓰는 장치(DEBUG 빌드 전용, Release 에서는 파일째 빠짐) |
| `ScoreAnatomy/Resources` | 아이콘(임시), 켤 때 배경색, PrivacyInfo.xcprivacy |
| `ScoreAnatomy/Web` | 웹 묶음(app-test, app-release)과 manifest.json. 웹 쪽 산출물이라 여기서 고치지 않아요 |
| `ScoreAnatomyTests` | 단위 테스트(저장, 글자 크기, manifest 의 SHA-256, 차단 규칙, 다리 메시지, 받는 쪽 RemoteTests) |
| `ScoreAnatomyUITests` | 화면 테스트(XCUITest). 빠른 누름(FastTapTests), 3-2 되풀이 재기(HeldDoubleTapTests, 기록용), 받기 화면(RemoteFetchTests), 웹에서 고친 화면(WebFixScreenTests), Release 와 Debug 의 모양 비교(LookTests)도 여기 있어요 |
| `scripts/verify.sh` | 자동 검증 전체. 결과는 docs/ios_검증결과.md |
| `scripts/sync_version.py` | 앱 버전(project.yml 의 MARKETING_VERSION)을 웹 묶음의 버전(manifest.json 의 version)에 맞춰요. `--check` 는 견주기만 해요 |
| `scripts/exam_key.py` | 빌드 단계가 불러요. exam-data/public-key.txt 를 앱에 넣고, Release 앱에 테스트 전용 키가 있으면 빌드를 실패시켜요 |
| `scripts/exam_server.py` | 시험 자료 받기의 시험 서버(127.0.0.1, python3 표준 라이브러리만). 테스트 전용 발행물을 내주고 요청 머리글을 받아 적어요 |

- Debug 빌드는 시험용 묶음(`Web/app-test`), Release 빌드는 배포용 묶음(`Web/app-release`)만 실어요. 고르는 곳은 `project.yml` 의 `EXCLUDED_SOURCE_FILE_NAMES` 예요.
- 기록은 앱 전용 폴더(Application Support/번들 ID/store.json)에만 둬요. 서버로 보내지 않아요. 기기 백업에서 일부러 빼지는 않아요.
- 받아들인 시험 자료는 같은 폴더의 `remote/remote.json` 에 둬요(Caches 가 아님). 바꿀 때는 새 파일을 다 쓴 뒤 이름 바꾸기 한 번으로 바꿔치기해요.
- 앱 껍데기에는 외부 패키지, 권한 요청, 분석이나 광고 도구, 계정, 알림, 뒤에서 받기가 없어요. 네트워크 API 는 `Remote/ReleaseFetcher.swift` 한 파일에서만 쓰고(verify 6번, 20번이 확인), 정해진 주소 하나의 index.json, index.json.sig, 시험 파일만 받아요. 웹뷰의 바깥 통신 차단은 그대로예요.
- 앱 이름(홈 화면, 웹 묶음 0.3.2 부터 시작 화면 제목과 문서 제목도)은 "모고칸"이에요. 번들 ID(com.junnyson.scoreanatomy, 임시)와 타깃, 프로젝트 이름(ScoreAnatomy)은 그대로예요. "점수 해부"는 앱 안의 화면 이름으로 남아요.

## 3. 테스트와 검증

```bash
caffeinate -dims ios/scripts/verify.sh
```

- 시뮬레이터를 새로 만들어(이름이 `SA검증-` 으로 시작) 빌드, 단위 테스트, 화면 테스트, 정적 검사, 캡처를 모두 돌리고 끝나면 그 시뮬레이터를 지워요. 시험 서버도 켰다가 꺼요. 걸린 시간은 docs/ios_검증결과.md 의 실행 시각에 적혀요.
- 도는 동안 맥이 잠들면 화면 테스트가 멈춰 실패해요. 전원 어댑터를 꽂고 덮개를 연 채로, 위처럼 `caffeinate` 로 감싸 돌려요. 끝난 뒤 `pmset -g log | grep -E "Sleep|Wake"` 로 실행 시각 사이에 잠든 기록이 없는지 봐요(덮개가 닫히면 caffeinate 가 있어도 잠들어요).
- 시작할 때 앱 버전이 웹 묶음 버전과 다르면 아무것도 돌리지 않고 멈춰요(5장).
- 결과는 [docs/ios_검증결과.md](../docs/ios_검증결과.md), 캡처는 `docs/screens-ios`, 3-2 되풀이 재기의 이벤트 기록은 `docs/ios_누름기록`, 로그와 테스트 결과 묶음은 `ios/build/verify` 에 남아요(커밋하지 않음).
- Xcode 에서 테스트만 돌릴 때는 Command + U 예요. 화면 테스트는 DEBUG 전용 실행 인자로 기록 폴더를 따로 쓰고 탐침을 켜요(`ScoreAnatomy/Debug/DebugOptions.swift`). 빠른 누름 테스트는 `-SAEventLog` 로 웹이 받은 이벤트를 적어요. 받기 테스트는 시험 서버가 있어야 해서 verify.sh 밖에서는 건너뛰어요(verify 에서는 건너뜀이 0이어야 해요).
- 간격을 정한 누름(TouchSynth)은 XCUITest 안의 비공개 장치를 써요. 이 맥(Xcode 26.4.1)에서는 누름 시작 사이를 0.07초 남짓(아주 빠른 두 번 누름)과 0.28초 이상으로만 만들 수 있었어요(`ScoreAnatomyUITests/Support/TouchSynth.swift` 의 설명).
- 주의: 저장소가 맥의 데스크톱 폴더 안에 있으면 Xcode 26.4 의 XCTest 가 테스트 실패를 기록하다 멈춰요(실패 메시지 없이 시간 초과). 실패 위치를 찾으려고 빌드 중간 파일(ios/build 아래 .o)을 열다 막혀요. verify.sh 는 테스트 빌드에만 링커 설정 `-Wl,-S`(디버그 맵 빼기)를 덧붙여 피해요. 같은 까닭(데스크톱 폴더의 개인정보 보호)으로 단위 테스트를 돌리는 앱은 저장소의 파일을 읽지 못해서, verify.sh 가 테스트 전용 발행물을 데스크톱 밖 임시 폴더에 복사해 넘겨요. Xcode 에서 직접 테스트를 돌리다 멈추면 저장소를 데스크톱 밖(예: 홈 폴더 아래 Developer)으로 옮기거나 verify.sh 를 써요. 한글이 든 경로 자체는 문제가 아니었어요.

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

1. 웹 쪽에서 `npm run build:app` 으로 묶음과 manifest.json 을 새로 만들어 커밋해요(작업 지시서 1의 방식). 이 폴더의 파일을 손으로 고치지 않아요. 웹 0.3.2 부터 묶음 내용이 바뀌면 버전도 올려야 해요(웹 쪽 `npm run verify` 11번).
2. 앱 버전을 맞춰요. 아래 스크립트가 manifest.json 의 `version` 과 `project.yml` 의 `MARKETING_VERSION`, 프로젝트 파일의 값을 견주고, 다르면 project.yml 을 고친 뒤 XcodeGen 2.47.0 으로 프로젝트 파일을 다시 만들어요(XcodeGen 이 없거나 판이 다르면 프로젝트 파일의 버전 줄만 바꿔요). 다시 만든 뒤 버전 말고 바뀐 줄(서명 설정 등)이 있으면 알리고 종료 코드 3으로 끝나요.

   ```bash
   ios/scripts/sync_version.py
   ```

   견주기만 할 때는 `ios/scripts/sync_version.py --check` 예요. verify.sh 도 시작할 때 이것으로 견주고, 다르면 멈춰요. 단위 테스트도 앱의 버전이 manifest 와 같은지 봐요.
3. 다리 규격 번호를 봐요. `ScoreAnatomy/Bridge/BridgeSpec.swift` 의 `version` 이 manifest.json 의 `bridge`(묶음이 돌아가는 가장 낮은 규격) 이상, `bridgeMax`(웹이 아는 가장 높은 규격, 없으면 `bridge`) 이하여야 해요(docs/앱_다리_규격.md 7-2, 단위 테스트가 봐요). 그 사이가 아니면 다리 규격이 바뀐 것이라 docs/앱_다리_규격.md 를 읽고 껍데기도 함께 고쳐요. 지금 묶음은 bridge 1, bridgeMax 2 이고 껍데기는 2예요.
4. 같은 버전 번호로 내용이 바뀔 수 있었어요(0.3.1 은 웹 PR 두 개에서 내용이 달랐어요). 그래서 묶음은 버전이 아니라 manifest 의 `commit` 과 SHA-256 으로 가려내요. 단위 테스트가 앱 안의 묶음과 manifest 의 SHA-256 을 견주고, verify 결과 문서 첫머리에 커밋과 SHA-256 앞자리가 적혀요.
5. `caffeinate -dims ios/scripts/verify.sh` 로 모두 통과하는지 봐요(3장).
6. 화면 문구가 바뀌어 화면 테스트가 깨지면, 바뀐 글자를 docs/결정기록.md 와 웹 소스(src/strings.ts 등)에서 확인한 뒤 테스트의 글자를 맞춰요. 테스트를 느슨하게(찾는 글자를 줄이거나 확인을 빼게) 바꾸지 않아요.
7. 앱 버전 맞춤은 따로 커밋해요(예: "앱 버전을 웹 묶음 0.3.2 에 맞춤").

## 6. 시험 자료를 받는 주소와 공개 키 넣기

앱은 정해진 주소 한 곳에서 시험 자료(발행물: index.json, index.json.sig, 시험 파일)를 받아 서명과 SHA-256 을 확인한 뒤 웹에 넘겨요(docs/시험_배포_규격.md). 주소와 진짜 공개 키 둘 다 있어야 받아요. 지금은 둘 다 없어요.

### 받는 주소

1. 주소를 정해요(docs/시험_배포_규격.md 6장의 조건: https, 바이트를 바꾸지 않는 정적 파일, 넘기지 않음, 접속 기록이 적은 곳). 발행물이 있는 폴더의 주소예요(그 아래에 index.json 이 있어요).
2. `ios/Config/Shared.xcconfig` 의 이 한 줄만 채워요. xcconfig 에서는 `//` 뒤를 주석으로 읽어서 `https://` 를 그대로 적으면 `https:` 까지만 남아요. 그래서 빈 값 `$()` 를 넣어 두 빗금을 떼어 적어요(빌드하면 `https://` 가 돼요).

   ```
   SA_EXAM_BASE_URL = https:/$()/exams.example.com/score-anatomy/
   ```

   위 주소는 형식 예시예요. https 만 받고(http 는 받지 않아요), 끝은 `/` 로 끝내요(빠지면 앱이 붙여요). 계정, `?` 뒤의 값, `#` 뒤의 값은 넣지 않아요(넣으면 앱이 그 주소를 쓰지 않아요).
3. 빌드한 앱에 들어간 값을 확인해요.

   ```bash
   xcodebuild -project ios/ScoreAnatomy.xcodeproj -scheme ScoreAnatomy -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build build
   ```

   ```bash
   /usr/libexec/PlistBuddy -c 'Print SAExamBaseURL' ios/build/Build/Products/Release-iphonesimulator/ScoreAnatomy.app/Info.plist
   ```

   `https://` 로 시작하는 주소가 그대로 나와야 해요.

### 진짜 공개 키

1. 키를 맡은 사람이 웹 쪽 발행 도구로 키 쌍을 만들어요(`npm run exams:keygen`, docs/시험_당일_순서.md). 비밀 키는 저장소 밖에 두고 사본을 하나 더 둬요.
2. 공개 키를 `exam-data/public-key.txt` 로 커밋해요. 공개 키의 자리는 이 한 곳뿐이에요. 빌드할 때 빌드 단계(`scripts/exam_key.py install`)가 이 파일을 읽어 앱의 `exam-public-key.txt` 로 넣어요. 파일이 없으면 빈 파일을 넣어 받기를 하지 않아요.
3. 빌드 기록에 `시험 자료 공개 키: 지문 ... 를 넣었어요.` 가 나와요. 이 지문(공개 키 32바이트의 SHA-256 앞 16자)이 발행 도구가 출력한 지문과 같은지 사람이 견줘요.
4. Release 빌드는 앱 안의 모든 파일을 훑어 테스트 전용 키(exam-data/testdata 의 키와 서명이 틀린 발행물에만 쓴 다른 키)가 있으면 실패해요. 앱에 파일을 새로 넣으면 `project.yml` 의 "배포용 앱의 테스트 키 검사" 단계 inputFiles 에도 더해요(빠지면 그 파일을 읽지 못해 빌드가 실패해요).

### 넣은 뒤

1. `caffeinate -dims ios/scripts/verify.sh` 를 돌려요. 21번(출시 준비)에 아직 없는 것이 적혀요.
2. 실제 아이폰에서 받기를 확인해요(docs/ios_실기기_확인표.md 의 시험 자료 받기 항목).

### 개발할 때 시험 서버로 받아 보기

Debug 빌드에서만 쓰는 실행 인자로 이 맥의 시험 서버 주소와 테스트 전용 공개 키를 줄 수 있어요(Release 에는 이 장치가 없어요).

```bash
python3 ios/scripts/exam_server.py --testdata exam-data/testdata --port 4180
```

```bash
curl "http://127.0.0.1:4180/control/dev/set?pub=test-only-valid"
```

그리고 Xcode 의 Scheme, Edit Scheme, Run, Arguments 에 `-SAExamURL http://127.0.0.1:4180/s/dev/` 와 `-SAExamKeyFile <키 파일 경로>` 를 더해 켜요. 키 파일은 exam-data/testdata/test-only-public-key.txt 예요. 저장소가 데스크톱 폴더 안에 있으면 Xcode 로 켠 앱이 그 파일을 읽지 못해서(개인정보 보호), /tmp 같은 곳에 복사해 그 경로를 줘요. 시험 선택 화면에 "받은 자료 기준"과 "새로 확인", "테스트 전용 시험"이 나오면 받은 거예요. `pub` 를 test-only-bad-signature 나 test-only-changed-byte 로 바꾸고 새로 확인을 누르면 받지 못했다는 안내가 나오고 자료는 그대로예요.
