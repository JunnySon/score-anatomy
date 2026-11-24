# iOS 앱 껍데기 검증 결과

결론: 13개 항목 가운데 통과 12, 실패 0, 확인하지 못함 1. 추가 확인(14번)은 통과. `ios/scripts/verify.sh` 가 2026-11-24 11:37에 돌려 쓴 문서예요. 실제로 돌린 것만 통과로 셌고, 건너뛴 테스트나 빠진 결과는 통과로 세지 않았어요.

- 맥: macOS 26.6.2 (25G83), Xcode 26.4.1(빌드 17E202), SDK iphonesimulator 26.4 (23E252), XcodeGen 2.47.0
- 저장소: 브랜치 ios-v1, 커밋 c5329a1
- 시뮬레이터(검증에 쓰려고 새로 만들고 끝나면 지움): iPhone 17, iPhone SE 3세대, iPad (A16) (iOS 26.4.1), iPhone 16 (iOS 18.4, 참고용)
- 데스크톱 폴더 대응: 테스트 빌드에만 링커 설정 `-Wl,-S`(디버그 맵 빼기)를 덧붙였어요. 테스트 바이너리의 디버그 맵 항목 0개(0이어야 해요). 이유는 docs/ios_결정기록.md 에 있어요. 앱 코드와 프로젝트 설정은 그대로예요.

| 번호 | 항목 | 결과 | 숫자 | 최소 기준 |
| --- | --- | --- | --- | --- |
| 1 | 빌드(Debug, Release, 시뮬레이터) | 통과 | Xcode 26.4.1(빌드 17E202), SDK iphonesimulator 26.4 (23E252). Debug ok, 컴파일러 경고 0개. Release ok, 컴파일러 경고 0개(도구 안내 줄 1줄은 경고가 아니라 따로 셈). Release 앱: 시험용 묶음 없음, '테스트 시작하기' 0건, DEBUG 표식 0건, libswiftWebKit 연결 0건, 시스템 밖 라이브러리 0개, 묶음 SHA-256 일치, 버전 0.2.0(manifest 와 같음). 대조로 Debug 앱에는 '테스트 시작하기' 1건, DEBUG 표식 7건이 있다. 커밋된 프로젝트 파일과 project.yml 일치. manifest 의 SHA-256 일치. 기기용 컴파일(서명 없음) 성공 | 두 빌드 성공, 컴파일러 경고 0, Release 안의 시험용 묶음과 DEBUG 표식 0건(Debug 에서는 찾아져야 검사가 맞다), 프로젝트 파일이 project.yml 과 같음 |
| 2 | 단위 테스트 | 통과 | 41개 중 통과 41, 실패 0, 건너뜀 0 | 39개 이상 실행, 실패 0, 건너뜀 0 |
| 3 | 화면 흐름(예시 시험 A, iPhone 17) | 통과 | 1개 중 통과 1, 실패 0, 건너뜀 0. 흐름 153초, 햅틱 메시지 49번(받아들인 키 누름 49번), 계단 3개 | 1개 통과(78점, 7점, 8점, 3~7점, 약 75점, 6~10점, 3등급 문구, 계단 3개와 카드 표기 확인) |
| 4 | 다시 켜기 | 통과 | 2개 중 통과 2, 실패 0, 건너뜀 0. 12번째 답 키 누름이 끝난 뒤(XCUITest 가 앱이 쉬는 것을 확인한 뒤) store.json 에 12개가 보이기까지 0.00초 | 2개 통과(12번까지 이어서 보기, 채점 기록 유지) |
| 5 | 사람 손 박자 | 통과 | 3개 중 통과 3, 실패 0, 건너뜀 0. 표시 두 번 누름: 실제 간격 0.40~0.42초(첫 click 은 손을 뗀 뒤 2ms 에 옴. 참고: 손을 떼고 곧바로 다시 누르는 XCUITest doubleTap 은 '20번, 넣은 답 3, 고민', 이벤트 touchstart:0, touchend:0, touchstart:0, touchend:0, click:2, dblclick:2), 9번 고친 뒤 이어 누름: 실제 간격 0.38~0.40초, 마지막 문항 뒤 이어 누름: 실제 간격 0.38~0.44초. XCUITest 의 좌표 누름은 한 번에 0.35초 넘게 걸려 지시서의 0.15초, 0.2초, 0.3초 간격을 그대로 낼 수 없었어요. 보호 시간(0.5초) 안의 가장 빠른 간격으로 확인했어요. | 3개 통과, 실제 누름 간격이 보호 시간 0.5초보다 짧음 |
| 6 | 통신과 권한 | 통과 | 2개 중 통과 2, 실패 0, 건너뜀 0. 대조 실행(규칙 없음): 닿은 연결 30건, 요청 내용 30건. 차단 실행: 하위 자원 요청 10가지(fetch 2, XHR, 그림, 스크립트, 스타일, 비컨, 웹소켓, 서버 이벤트, iframe)와 스크립트의 새 창이 수신기에 닿은 연결 0건, 문서 이동까지 모두 닿은 요청 내용 0건, 껍데기가 취소한 이동 7건(iframe, 스크립트의 링크와 새 창 링크와 location 과 form, 사람이 누른 링크와 새 창 링크)과 새 창 만들기 단계에서 거절한 것 0건. 참고: 링크로 가는 이동에서 WebKit 이 내용 없이 미리 맺은 연결 1건(웹 묶음에는 바깥 링크가 없다). 정적 검사: 네트워크 API 0건, 외부 패키지 0개, 권한 문구 0개(Release Info.plist 0개), 알림 API 0건, 추적 API 0건, 권한이 필요한 기기 API 0건, DEBUG 밖 소스의 http(s) 주소 글자 0건, Release 바이너리의 네트워크 기호 0건, 웹 묶음 안의 바깥 링크와 새 창과 미리 연결 표시 0건. PrivacyInfo.xcprivacy 있음(추적 False, 추적 도메인 0개, 수집 자료 0개, 사유 API 선언 0개). 소스에서 찾은 사유 API 이름 0건, Release 바이너리의 사유 API 기호 0건. Info.plist: 암호화 사용 False, 방향 ['UIInterfaceOrientationPortrait'] | 탐침 2개 통과(차단 0건 도달, 대조 1건 이상 도달), 정적 검사 모두 0, 개인정보 매니페스트 있음(추적 없음, 수집 없음), 찾은 사유 API 와 선언이 같음(둘 다 0), 암호화 사용 NO, 세로 고정 |
| 7 | 글자 크기 | 통과 | 4개 중 통과 4, 실패 0, 건너뜀 0, 켜 둔 채 바꾸기 1개 중 통과 1, 실패 0, 건너뜀 0. 루트 글자: live-accessibility-medium 26.35px, AccessibilityM 26.35px, L 16.00px, AccessibilityXXXL 32.00px, XXXL 21.65px | 4개 통과(기본, 가장 큰 일반 크기, 접근성 크기 둘), 켜 둔 채 바꾸기 1개 통과 |
| 8 | 작은 화면(iPhone SE 3세대) | 통과 | 흐름 1개 중 통과 1, 실패 0, 건너뜀 0, 작은 화면 1개 중 통과 1, 실패 0, 건너뜀 0. 화면 375.0x667.0pt, 넘친 높이(문서, 본문) 모두 0 이하 | 흐름 1개와 작은 화면 1개 통과 |
| 9 | iPad(아이폰 앱 호환 방식) | 통과 | iPad (A16), 26.4.1: 1개 중 통과 1, 실패 0, 건너뜀 0 | 시작 화면 테스트 1개 통과 |
| 10 | 최소 버전(iOS 17) | 확인하지 못함 | iOS 17 런타임이 이 맥에 없다(지시대로 내려받지 않음). 참고: 이 맥에 있던 가장 낮은 런타임 18.4에서 3번 흐름 1개 중 통과 0, 실패 1, 건너뜀 0. | iOS 17 런타임이 있으면 3번 통과 |
| 11 | 금지 문자 | 통과 | 검사한 파일 40개에서 금지 문자 0건. 보이는 글자(화면을 불러오지 못했어요. 앱을 다시 켜 주세요., 점수 해부) 느낌표 0, 이모지 0. 이 브랜치 커밋 메시지 8개의 금지 문자 0건 | 모두 0 |
| 12 | 접근성 감사(기록용) | 통과 | 1개 중 통과 1, 실패 0, 건너뜀 0. 감사한 화면 4개, 걸린 것 38건(아래 표) | 네 화면 모두 감사를 돌리고 걸린 것을 기록(통과가 접근성을 보장하지 않음) |
| 13 | 캡처 | 통과 | 목록 36장 중 36장, 빠진 것 0, 겹친 것 0, 크기 다름 0. 캡처 테스트 4개 중 통과 4, 실패 0, 건너뜀 0 | 9화면 x 2테마 x 2기기 = 36장, 빠진 것과 겹친 것 0 |
| 14 | 추가: 다리 통합, 글 입력, Release 실행 | 통과 | 다리 통합(보관, 더 높은 version, 저장 실패, 불러오기 실패) 4개 중 통과 4, 실패 0, 건너뜀 0. 시작 화면(iPhone 17) 1개 중 통과 1, 실패 0, 건너뜀 0. 진행자용 화면의 키보드 글 입력 1개 중 통과 1, 실패 0, 건너뜀 0. Release 구성으로 켜기 1개 중 통과 1, 실패 0, 건너뜀 0 | 모두 통과. 13개 항목 밖이지만 판정과 종료 코드에 넣는다 |

## 실기기와 제출용 빌드

- 실제 아이폰에서 켜기, 서명한 빌드, Archive 와 App Store Connect 업로드: 확인하지 못함(서명 팀과 Apple 계정을 쓰지 않는다는 지시). 사람이 docs/ios_실기기_확인표.md 로 확인해요.
- 참고로 서명 없이 기기용(iphoneos)으로 컴파일만 해 봤어요: 성공. 기기에 올린 것은 아니에요.

## 테스트별 결과

| 묶음 | 테스트 | 기기 | 결과 | 걸린 시간(초) |
| --- | --- | --- | --- | --- |
| 단위 | BackgroundTicketTests.testExpirationEndsTicketAndLaterEndDoesNothing | iphone17 | Passed | 0.0 |
| 단위 | BackgroundTicketTests.testTicketEndsOnce | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testAppInfoScriptCarriesStoreExactly | iphone17 | Passed | 0.1 |
| 단위 | BridgeTests.testAppInfoScriptStoreNullAndEmpty | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testDeliverScriptCallsWebFunctionOnlyWhenReady | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testOutboxKeepsOrder | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testParseHapticAndCopy | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testParseStoreMessages | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testToWebJSONKeepsBooleansAndNumbers | iphone17 | Passed | 0.0 |
| 단위 | ClipboardTests.testCopyPutsTextOnPasteboard | iphone17 | Passed | 0.1 |
| 단위 | FontScaleTests.testAllSettingsStayInRangeAndNeverShrink | iphone17 | Passed | 0.0 |
| 단위 | FontScaleTests.testDefaultSizeIsOne | iphone17 | Passed | 0.0 |
| 단위 | FontScaleTests.testLargerSettingsFollowBodyTextScaling | iphone17 | Passed | 0.0 |
| 단위 | FontScaleTests.testLargestSettingIsTwo | iphone17 | Passed | 0.0 |
| 단위 | FontScaleTests.testSmallerSettingsAreOne | iphone17 | Passed | 0.0 |
| 단위 | FontScaleTests.testUnspecifiedIsOne | iphone17 | Passed | 0.0 |
| 단위 | ManifestTests.testBridgeVersionAndAppVersionMatchManifest | iphone17 | Passed | 0.0 |
| 단위 | ManifestTests.testBundledIndexMatchesManifestSHA256 | iphone17 | Passed | 0.0 |
| 단위 | ManifestTests.testOnlyOneBundleIsShipped | iphone17 | Passed | 0.0 |
| 단위 | NetworkGuardTests.testOnlySameDocumentNavigationIsAllowed | iphone17 | Passed | 0.0 |
| 단위 | NetworkGuardTests.testRulesBlockHttpHttpsWsWss | iphone17 | Passed | 0.0 |
| 단위 | NetworkGuardTests.testRulesCompileInWebKit | iphone17 | Passed | 0.0 |
| 단위 | NetworkGuardTests.testSameDocumentMeansOnlyTheFragmentChanges | iphone17 | Passed | 0.0 |
| 단위 | NetworkGuardTests.testSymlinkedPathCountsAsSameDocument | iphone17 | Passed | 0.0 |
| 단위 | ShellConfigurationTests.testOnlyTheThreeBridgeHandlersAreRegistered | iphone17 | Passed | 0.0 |
| 단위 | ShellConfigurationTests.testWebViewSettings | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testArchiveFailureStopsSavesForThisRun | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testArchiveNameFormatAndCollision | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testArchiveRenamesThenStartsFresh | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testArchiveWithoutFileSucceedsAndKeepsSaving | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testDefaultLocationIsApplicationSupportBundleFolder | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testEmptyFileIsTextNotMissing | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testFileMissingReadsAsNull | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testFirstSaveCreatesFolderAndFile | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testHundredSavesKeepTheLastOne | iphone17 | Passed | 0.1 |
| 단위 | StoreFileTests.testLeftoverTemporaryFilesAreRemoved | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testOrderAcrossArchive | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testRealPermissionFailureKeepsOriginalFile | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testSavesAreAppliedInOrderEvenWhenSentQuickly | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testUnreadableBytesReadAsEmptyText | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testWriteFailureKeepsOriginalFile | iphone17 | Passed | 0.0 |
| 화면 | AccessibilityAuditTests.testAuditKeyScreens | iphone17 | Passed | 142.2 |
| 화면 | BridgeIntegrationTests.testFutureVersionIsArchived | iphone17 | Passed | 5.1 |
| 화면 | BridgeIntegrationTests.testLoadFailureShowsMessage | iphone17 | Passed | 6.5 |
| 화면 | BridgeIntegrationTests.testSaveFailureShowsNotice | iphone17 | Passed | 14.7 |
| 화면 | BridgeIntegrationTests.testUnreadableStoreIsArchivedNotOverwritten | iphone17 | Passed | 6.3 |
| 화면 | CaptureTests.testCaptureScreens | iphone17 | Passed | 159.9 |
| 화면 | FlowTests.testExampleAFlow | iphone17 | Passed | 158.2 |
| 화면 | FontScaleUITests.testAccessibilitySize | iphone17 | Passed | 19.6 |
| 화면 | FontScaleUITests.testDefaultSize | iphone17 | Passed | 19.5 |
| 화면 | FontScaleUITests.testLargestAccessibilitySizeIsCappedAtTwo | iphone17 | Passed | 19.5 |
| 화면 | FontScaleUITests.testLargestStandardSize | iphone17 | Passed | 20.4 |
| 화면 | KeyboardInputTests.testFacilitatorScreenAcceptsTyping | iphone17 | Passed | 10.2 |
| 화면 | NetworkProbeTests.testControlRunWithoutRulesWouldReachListener | iphone17 | Passed | 18.7 |
| 화면 | NetworkProbeTests.testRequestsToOutsideAreBlocked | iphone17 | Passed | 18.7 |
| 화면 | RestartTests.testGradedRecordSurvivesRestart | iphone17 | Passed | 124.1 |
| 화면 | RestartTests.testResumeAfterRestartKeepsTwelveAnswers | iphone17 | Passed | 48.8 |
| 화면 | RhythmTests.testDoubleTapOnMarkCellMakesGuess | iphone17 | Passed | 120.8 |
| 화면 | RhythmTests.testKeysAfterFixingNineAreNotEntered | iphone17 | Passed | 46.9 |
| 화면 | RhythmTests.testTapsAfterLastItemDoNotPressReviewButtons | iphone17 | Passed | 115.1 |
| 화면 | StartScreenTests.testStartScreenAppears | iphone17 | Passed | 6.9 |
| 화면(어두운 화면) | CaptureTests.testCaptureScreens | iphone17 | Passed | 160.4 |
| 화면 | FontScaleUITests.testLiveChangeIsSentToWeb | iphone17 | Passed | 6.0 |
| 화면 | CaptureTests.testCaptureScreens | iphonese | Passed | 161.4 |
| 화면 | FlowTests.testExampleAFlow | iphonese | Passed | 156.7 |
| 화면 | SmallScreenTests.testInputScreenFitsWithoutScrolling | iphonese | Passed | 101.3 |
| 화면(어두운 화면) | CaptureTests.testCaptureScreens | iphonese | Passed | 160.1 |
| 화면 | StartScreenTests.testStartScreenAppears | ipad | Passed | 7.4 |
| 화면(Release) | ReleaseSmokeTests.testReleaseBuildRunsWithoutTesterScreensOrDebugHooks | iphone17 | Passed | 18.1 |
| 화면(참고) | FlowTests.testExampleAFlow | ios18 | Failed | 550.3 |
|  | 메시지 |  | Failed to tap "21번, 넣은 답 5, 표시 없음" Button: Timed out while synthesizing event. | |

## 다리와 껍데기 통합 확인(추가)

- 보관, 저장 실패, 불러오기 실패: 4개 중 통과 4, 실패 0, 건너뜀 0. 읽지 못한 기록(글자가 아닌 바이트, 더 높은 version)은 store-보관-날짜시각.json 으로 바이트 그대로 남았고, 쓸 수 없는 폴더에서는 storeFailed 를 받은 웹이 기록 화면에 안내를 띄웠고, 묶음을 못 열면 흰 화면 대신 안내가 떴어요.
- 시작 화면(iPhone 17): 1개 중 통과 1, 실패 0, 건너뜀 0. 진행자용 화면의 키보드 글 입력: 1개 중 통과 1, 실패 0, 건너뜀 0. Release 구성으로 켜기: 1개 중 통과 1, 실패 0, 건너뜀 0

## 접근성 감사에서 걸린 것

기록용이에요. 통과했다고 접근성이 보장되지 않고, 실제 VoiceOver 사용은 사람이 docs/ios_실기기_확인표.md 로 확인해요. 판단은 docs/ios_검토기록.md 와 같은 기준으로 적었어요.

| 화면 | 종류 | 요소 | 내용 | 판단 |
| --- | --- | --- | --- | --- |
| 시작 | hitRegion | 예시 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 시작 | hitRegion | 30문항 가운데 24문항을 맞혔어요. | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 시작 | hitRegion | 100점 막대. 찍음 표시 없이 맞힌 점수 71점, 추측했다고 표시한 정답 7점, 실수라고 표시한 오답 8점 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 시작 | hitRegion | 먼저 고칠 것: 적분, 수열, 확률 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 시작 | hitRegion | 가입 없이 써요. 기록은 이 기기에 저장하고 서버로 보내지 않아요. | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 시작 | hitRegion | 이번 시험 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 53 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |
| 시작 | hitRegion | 기록 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 25 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |
| 답 입력 | hitRegion | 3문항 입력 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 답 입력 | hitRegion | 입력한 문항 수 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 답 입력 | hitRegion | 지금 넣을 문항 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 답 입력 | hitRegion | 3점 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 점수 해부 | hitRegion | 예시 시험 A | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 점수 해부 | hitRegion | 예시 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 점수 해부 | hitRegion | 78점 안에 들어 있어요 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 점수 해부 | hitRegion | 목표 등급 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 점수 해부 | hitRegion | 추정 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 점수 해부 | hitRegion | 이번 시험 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 53 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |
| 점수 해부 | hitRegion | 기록 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 25 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |
| 계단 | hitRegion | 예시 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 1 | Hit area is too small | 기록: 계단 카드의 번호(1. 적분)가 숫자, 점, 이름으로 나뉘어 접근성 요소가 됐어요. 누를 수 없는 글자라 누름 영역 예외이지만, VoiceOver 가 번호와 점을 따로 읽을 수 있어 실기기 확인표 11번에서 사람이 들어 봐요 |
| 계단 | hitRegion | .  | Hit area is too small | 기록: 계단 카드의 번호 뒤의 점. 위와 같아요 |
| 계단 | hitRegion | 놓친 배점 8점, 찍었다고 표시한 정답 4점 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 할 일 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 1. | Hit area is too small | 기록: 할 일 목록의 번호. 누를 수 없는 글자예요 |
| 계단 | hitRegion | 2. | Hit area is too small | 기록: 할 일 목록의 번호. 누를 수 없는 글자예요 |
| 계단 | hitRegion | 예시 좌표 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 12번 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 20번 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 2 | Hit area is too small | 기록: 계단 카드의 번호. 위와 같아요 |
| 계단 | hitRegion | .  | Hit area is too small | 기록: 계단 카드의 번호 뒤의 점. 위와 같아요 |
| 계단 | hitRegion | 놓친 배점 8점 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 할 일 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 1. | Hit area is too small | 기록: 할 일 목록의 번호. 누를 수 없는 글자예요 |
| 계단 | hitRegion | 2. | Hit area is too small | 기록: 할 일 목록의 번호. 누를 수 없는 글자예요 |
| 계단 | hitRegion | 예시 좌표 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 13번 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 이번 시험 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 53 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |
| 계단 | hitRegion | 기록 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 25 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |


감사와 함께 잰 실제 누름 영역(DOM, pt): 이번 시험 197 x 56, 기록 197 x 56, 이번 시험 197 x 56, 기록 197 x 56, 이번 시험 197 x 56, 기록 197 x 56

## 숫자 기록

- {"device": "iphonese", "haptics": 49, "kind": "flow", "seconds": 151.11409902572632, "steps": 3}
- {"checked": [{"overflow": {"body": 0, "doc": 0, "h": 667, "w": 375}, "screen": "객관식"}, {"overflow": {"body": 0, "doc": 0, "h": 667, "w": 375}, "screen": "잠금"}, {"overflow": {"body": 0, "doc": 0, "h": 667, "w": 375}, "screen": "단답형"}], "device": "iphonese", "kind": "small", "window": "375.0x667.0"}
- {"category": "live-accessibility-medium", "kind": "font", "rootPx": 26.352942}
- {"device": "ipad", "kind": "start", "runnerIdiom": "phone", "window": "663.0x1180.0"}
- {"device": "iphone17", "haptics": 49, "kind": "flow", "seconds": 152.87625002861023, "steps": 3}
- {"category": "UICTContentSizeCategoryAccessibilityM", "fontScale": 1.6470588235294117, "kind": "font", "rootPx": 26.352942}
- {"category": "UICTContentSizeCategoryL", "fontScale": 1, "kind": "font", "rootPx": 16}
- {"category": "UICTContentSizeCategoryAccessibilityXXXL", "fontScale": 2, "kind": "font", "rootPx": 32}
- {"category": "UICTContentSizeCategoryXXXL", "fontScale": 1.3529411764705883, "kind": "font", "rootPx": 21.647058}
- {"fieldMaxY": 260, "keyboardMinY": 583, "keyboardShown": true, "kind": "keyboard"}
- {"blockedNavigations": 7, "connections": 30, "kind": "network", "mode": "control", "requests": 30}
- {"blockedNavigations": 7, "blockedWindows": 0, "connections": 0, "kind": "network", "mode": "blocked", "outcomes": {"beacon": false, "eventSource": "error", "fetch": "error:Load failed", "fetchHttps": "error:Load failed", "iframe": "timeout", "image": "error", "script": "error", "style": "error", "websocket": "error", "windowOpenReturnedNull": true, "xhr": "error"}, "preconnects": 1, "requests": []}
- {"case": "resume12", "kind": "restart", "secondsUntilSaved": 0.0021059513092041016}
- {"case": "marks-double", "fastDoubleTapEvents": ["touchstart:0", "touchend:0", "touchstart:0", "touchend:0", "click:2", "dblclick:2"], "fastDoubleTapLabel": "20번, 넣은 답 3, 고민", "firstClickAfterTouchEndMs": 2, "gaps": [0.40042901039123535, 0.4177500009536743], "kind": "rhythm"}
- {"case": "lock", "gaps": [0.37783193588256836, 0.39677703380584717, 0.3998500108718872, 0.38359498977661133], "kind": "rhythm"}
- {"case": "last-item", "gaps": [0.3826190233230591, 0.39675700664520264, 0.43607401847839355, 0.39078497886657715, 0.39857399463653564, 0.3904210329055786, 0.40692996978759766, 0.4014800786972046], "kind": "rhythm", "notices": 0}
- {"device": "iphone17", "kind": "start", "runnerIdiom": "phone", "window": "402.0x874.0"}

## 캡처

docs/screens-ios/기기/테마/번호-화면.png 로 남겼어요. 같은 화면의 웹 캡처와의 비교는 docs/ios_화면비교.md 에 있어요.

