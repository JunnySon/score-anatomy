# iOS 앱 껍데기 검증 결과

결론: 13개 항목 가운데 통과 12, 실패 0, 확인하지 못함 1. 추가 확인은 14번 통과, 15번 통과, 16번 통과. `ios/scripts/verify.sh` 가 2026-11-24 21:54에 돌려 쓴 문서예요. 실제로 돌린 것만 통과로 셌고, 건너뛴 테스트나 빠진 결과는 통과로 세지 않았어요.

- 맥: macOS 26.6.2 (25G83), Xcode 26.4.1(빌드 17E202), SDK iphonesimulator 26.4 (23E252), XcodeGen 2.47.0
- 저장소: 브랜치 ios-sync, 커밋 96144a8 (커밋하지 않은 바뀜이나 추적하지 않는 파일: 시작 없음, 끝 있음. 11번 소스 검사는 그때의 작업 트리를 읽어요)
- 웹 묶음: version 0.3.1, 커밋 da5217a, dirty False, bridge 1, bridgeMax 2, app-test 1fbe8140286c, app-release 34f5b80f4880
- 실행 시각: 2026-11-24 21:54:11 ~ 2026-11-24 22:58:29. 시작할 때 전원: AC Power, 84%; AC attached; not charging present: true, 덮개 열림. 잠듦 확인은 docs/ios_진행기록.md 에 적어요(pmset 기록).
- 시뮬레이터(검증에 쓰려고 새로 만들고 끝나면 지움): iPhone 17, iPhone SE 3세대, iPad (A16) (iOS 26.4.1), iPhone 16 (iOS 18.4, 참고용)
- 데스크톱 폴더 대응: 테스트 빌드에만 링커 설정 `-Wl,-S`(디버그 맵 빼기)를 덧붙였어요. 테스트 바이너리의 디버그 맵 항목 0개(0이어야 해요). 이유는 docs/ios_결정기록.md 에 있어요. 앱 코드와 프로젝트 설정은 그대로예요.

| 번호 | 항목 | 결과 | 숫자 | 최소 기준 |
| --- | --- | --- | --- | --- |
| 1 | 빌드(Debug, Release, 시뮬레이터) | 통과 | Xcode 26.4.1(빌드 17E202), SDK iphonesimulator 26.4 (23E252). Debug ok, 컴파일러 경고 0개. Release ok, 컴파일러 경고 0개(도구 안내 줄 1줄은 경고가 아니라 따로 셈). Release 앱: 시험용 묶음 없음, '테스트 시작하기' 0건, DEBUG 표식 0건, libswiftWebKit 연결 0건, 시스템 밖 라이브러리 0개, 묶음 SHA-256 일치, 버전 0.3.1(manifest 와 같음). 대조로 Debug 앱에는 '테스트 시작하기' 1건, DEBUG 표식 9건이 있다. 커밋된 프로젝트 파일과 project.yml 일치. manifest 의 SHA-256 일치(묶음: version 0.3.1, 커밋 da5217a, dirty False, bridge 1, bridgeMax 2, app-test 1fbe8140286c, app-release 34f5b80f4880). 기기용 컴파일(서명 없음) 성공 | 두 빌드 성공, 컴파일러 경고 0, Release 안의 시험용 묶음과 DEBUG 표식 0건(Debug 에서는 찾아져야 검사가 맞다), 프로젝트 파일이 project.yml 과 같음 |
| 2 | 단위 테스트 | 통과 | 42개 중 통과 42, 실패 0, 건너뜀 0 | 39개 이상 실행, 실패 0, 건너뜀 0 |
| 3 | 화면 흐름(예시 시험 A, iPhone 17) | 통과 | 1개 중 통과 1, 실패 0, 건너뜀 0. 흐름 150초, 햅틱 메시지 49번(받아들인 키 누름 49번), 계단 3개 | 1개 통과(78점, 7점, 8점, 3~7점, 약 75점, 6~10점, 3등급 문구, 계단 3개와 카드 표기 확인) |
| 4 | 다시 켜기 | 통과 | 2개 중 통과 2, 실패 0, 건너뜀 0. 12번째 답 키 누름이 끝난 뒤(XCUITest 가 앱이 쉬는 것을 확인한 뒤) store.json 에 12개가 보이기까지 0.00초 | 2개 통과(12번까지 이어서 보기, 채점 기록 유지) |
| 5 | 사람 손 박자 | 통과 | 3개 중 통과 3, 실패 0, 건너뜀 0. 표시 두 번 누름: 실제 간격 0.38~0.39초, 채운 누름 0개(첫 click 은 손을 뗀 뒤 2ms 에 옴. 참고: 손을 떼고 곧바로 다시 누르는 XCUITest doubleTap 은 '20번, 넣은 답 3, 찍음', 이벤트 touchstart:0, touchend:0, touchstart:0, touchend:0, click:1, click:2, dblclick:2), 9번 고친 뒤 이어 누름: 실제 간격 0.37~0.38초, 채운 누름 0개, 마지막 문항 뒤 이어 누름: 실제 간격 0.38~0.40초, 채운 누름 0개. XCUITest 의 좌표 누름은 한 번에 0.35초 넘게 걸려 0.15초, 0.2초, 0.3초 간격을 그대로 낼 수 없었어요. 보호 시간(0.5초) 안의 가장 빠른 간격으로 확인했어요. 이 박자에서 채운 누름이 0개여야 해요(누름이 세 번 들어가지 않음). | 3개 통과, 실제 누름 간격이 보호 시간 0.5초보다 짧음, 채운 누름 0개 |
| 6 | 통신과 권한 | 통과 | 2개 중 통과 2, 실패 0, 건너뜀 0. 대조 실행(규칙 없음): 닿은 연결 30건, 요청 내용 30건. 차단 실행: 하위 자원 요청 10가지(fetch 2, XHR, 그림, 스크립트, 스타일, 비컨, 웹소켓, 서버 이벤트, iframe)와 스크립트의 새 창이 수신기에 닿은 연결 0건, 문서 이동까지 모두 닿은 요청 내용 0건, 껍데기가 취소한 이동 7건(iframe, 스크립트의 링크와 새 창 링크와 location 과 form, 사람이 누른 링크와 새 창 링크)과 새 창 만들기 단계에서 거절한 것 0건. 참고: 링크로 가는 이동에서 WebKit 이 내용 없이 미리 맺은 연결 1건(웹 묶음에는 바깥 링크가 없다). 정적 검사: 네트워크 API 0건, 외부 패키지 0개, 권한 문구 0개(Release Info.plist 0개), 알림 API 0건, 추적 API 0건, 권한이 필요한 기기 API 0건, DEBUG 밖 소스의 http(s) 주소 글자 0건, Release 바이너리의 네트워크 기호 0건, 웹 묶음 안의 바깥 링크와 새 창과 미리 연결 표시 0건. PrivacyInfo.xcprivacy 있음(추적 False, 추적 도메인 0개, 수집 자료 0개, 사유 API 선언 0개). 소스에서 찾은 사유 API 이름 0건, Release 바이너리의 사유 API 기호 0건. Info.plist: 암호화 사용 False, 방향 ['UIInterfaceOrientationPortrait'] | 탐침 2개 통과(차단 0건 도달, 대조 1건 이상 도달), 정적 검사 모두 0, 개인정보 매니페스트 있음(추적 없음, 수집 없음), 찾은 사유 API 와 선언이 같음(둘 다 0), 암호화 사용 NO, 세로 고정 |
| 7 | 글자 크기 | 통과 | 4개 중 통과 4, 실패 0, 건너뜀 0, 켜 둔 채 바꾸기 1개 중 통과 1, 실패 0, 건너뜀 0. 루트 글자: live-accessibility-medium 26.35px, AccessibilityM 26.35px, L 16.00px, AccessibilityXXXL 32.00px, XXXL 21.65px | 4개 통과(기본, 가장 큰 일반 크기, 접근성 크기 둘), 켜 둔 채 바꾸기 1개 통과 |
| 8 | 작은 화면(iPhone SE 3세대) | 통과 | 흐름 1개 중 통과 1, 실패 0, 건너뜀 0, 작은 화면 1개 중 통과 1, 실패 0, 건너뜀 0. 화면 375.0x667.0pt, 넘친 높이(문서, 본문) 모두 0 이하 | 흐름 1개와 작은 화면 1개 통과 |
| 9 | iPad(아이폰 앱 호환 방식) | 통과 | iPad (A16), 26.4.1: 1개 중 통과 1, 실패 0, 건너뜀 0 | 시작 화면 테스트 1개 통과 |
| 10 | 최소 버전(iOS 17) | 확인하지 못함 | iOS 17 런타임이 이 맥에 없다(이 Xcode 의 xcodebuild 로는 받을 수 없었음, docs/ios_진행기록.md 3-5). 참고(iOS 18.4, 잠듦 여부는 docs/ios_진행기록.md): 흐름 1개 중 통과 1, 실패 0, 건너뜀 0, 다시 켜기 2개 중 통과 2, 실패 0, 건너뜀 0, 빠른 누름(3-4의 1번, 6번, 7번) 16개 중 통과 15, 실패 1, 건너뜀 0. | iOS 17 런타임이 있으면 흐름, 다시 켜기, 빠른 누름 통과 |
| 11 | 금지 문자 | 통과 | 검사한 파일 47개에서 금지 문자 0건. 보이는 글자(화면을 불러오지 못했어요. 앱을 다시 켜 주세요., 모고칸) 느낌표 0, 이모지 0. 이 브랜치 커밋 메시지 5개의 금지 문자 0건 | 모두 0 |
| 12 | 접근성 감사(기록용) | 통과 | 1개 중 통과 1, 실패 0, 건너뜀 0. 감사한 화면 4개, 걸린 것 30건(시작 7, 답 입력 4, 점수 해부 7, 계단 12). 지난번(웹 묶음 0.2.0, 2026-11-24) 38건(시작 7, 답 입력 4, 점수 해부 7, 계단 20) | 네 화면 모두 감사를 돌리고 걸린 것을 기록(통과가 접근성을 보장하지 않음) |
| 13 | 캡처 | 통과 | 목록 36장 중 36장, 빠진 것 0, 겹친 것 0, 크기 다름 0. 캡처 테스트 4개 중 통과 4, 실패 0, 건너뜀 0 | 9화면 x 2테마 x 2기기 = 36장, 빠진 것과 겹친 것 0 |
| 14 | 추가: 다리 통합, 글 입력, Release 실행 | 통과 | 다리 통합(보관, 더 높은 version, 저장 실패, 불러오기 실패) 4개 중 통과 4, 실패 0, 건너뜀 0. 시작 화면(iPhone 17) 1개 중 통과 1, 실패 0, 건너뜀 0. 진행자용 화면의 키보드 글 입력 1개 중 통과 1, 실패 0, 건너뜀 0. Release 구성으로 켜기 1개 중 통과 1, 실패 0, 건너뜀 0 | 모두 통과. 13개 항목 밖이지만 판정과 종료 코드에 넣는다 |
| 15 | 추가: Release 와 Debug 의 화면 모양(3-3) | 통과 | Debug 1개 중 통과 1, 실패 0, 건너뜀 0, Release 1개 중 통과 1, 실패 0, 건너뜀 0. 견준 화면 9개, 화면 전체(기록 화면은 Debug 전용 목록의 12pt 위까지) 화소 차이(채널 8 넘음) 0화소, 자리가 다른 요소 0개, 화소를 견준 요소 293개, 크기가 다른 요소 0개, 모양이 다른 요소 0개, Release 에만 있는 요소 0개. Debug 에만 있는 요소: 7일 뒤 확인, 공유 리포트, 실수 카드, 응답이 모이면 열려요., 점수대별 정답률, 준비 중이에요., 준비 중인 기능, 준비 중인 기능, region, 테스트 진행자용. 문제: 없음 | 8화면(기록 화면은 맨 위와 맨 아래 둘)을 같은 누름으로 가서 찍고, 달라도 되는 곳(기록 화면의 준비 중인 기능 목록과 진행자용 링크)만 다름 |
| 16 | 추가: 웹에서 고친 것(결정기록 7.6) | 통과 | 빠른 누름(iPhone 17) 16개 중 통과 16, 실패 0, 건너뜀 0. 화면 쪽(iPhone 17) 6개 중 통과 6, 실패 0, 건너뜀 0. 키패드 판 아래 끝(iPhone SE) 1개 중 통과 1, 실패 0, 건너뜀 0. 간격별 결과와 웹이 받은 이벤트는 아래 절 | 모두 통과(SE 포함). 0.1초와 0.2초 간격은 만들 수 없어 확인하지 못함으로 적음. 진행 막대 끝의 틈과 아래 단서의 모양은 테스트가 찍기만 하고 사람이 확대 캡처로 판단함(docs/ios_화면비교.md) |

## 실기기와 제출용 빌드

- 실제 아이폰에서 켜기, 서명한 빌드, Archive 와 App Store Connect 업로드: 확인하지 못함(서명 팀과 Apple 계정을 쓰지 않는다는 지시). 사람이 docs/ios_실기기_확인표.md 로 확인해요.
- 참고로 서명 없이 기기용(iphoneos)으로 컴파일만 해 봤어요: 성공. 기기에 올린 것은 아니에요.

## 테스트별 결과

| 묶음 | 테스트 | 기기 | 결과 | 걸린 시간(초) |
| --- | --- | --- | --- | --- |
| 단위 | BackgroundTicketTests.testExpirationEndsTicketAndLaterEndDoesNothing | iphone17 | Passed | 0.0 |
| 단위 | BackgroundTicketTests.testTicketEndsOnce | iphone17 | Passed | 0.0 |
| 단위 | BridgeTests.testAppInfoScriptCarriesStoreExactly | iphone17 | Passed | 0.0 |
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
| 단위 | ManifestTests.testManifestWithNewFieldsDecodes | iphone17 | Passed | 0.0 |
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
| 단위 | StoreFileTests.testHundredSavesKeepTheLastOne | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testLeftoverTemporaryFilesAreRemoved | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testOrderAcrossArchive | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testRealPermissionFailureKeepsOriginalFile | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testSavesAreAppliedInOrderEvenWhenSentQuickly | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testUnreadableBytesReadAsEmptyText | iphone17 | Passed | 0.0 |
| 단위 | StoreFileTests.testWriteFailureKeepsOriginalFile | iphone17 | Passed | 0.0 |
| 화면 | AccessibilityAuditTests.testAuditKeyScreens | iphone17 | Passed | 144.7 |
| 화면 | BridgeIntegrationTests.testFutureVersionIsArchived | iphone17 | Passed | 6.2 |
| 화면 | BridgeIntegrationTests.testLoadFailureShowsMessage | iphone17 | Passed | 6.0 |
| 화면 | BridgeIntegrationTests.testSaveFailureShowsNotice | iphone17 | Passed | 15.1 |
| 화면 | BridgeIntegrationTests.testUnreadableStoreIsArchivedNotOverwritten | iphone17 | Passed | 7.4 |
| 화면 | CaptureTests.testCaptureScreens | iphone17 | Passed | 161.2 |
| 화면 | FastTapTests.testAnatomyRepeatTapAfterScrollIsDiscarded | iphone17 | Passed | 132.2 |
| 화면 | FastTapTests.testDoubleTapAnswerKeyCrossesToNextGroup | iphone17 | Passed | 9.9 |
| 화면 | FastTapTests.testDoubleTapAnswerKeyFillsTwoItemsInSameGroup | iphone17 | Passed | 9.2 |
| 화면 | FastTapTests.testDoubleTapAnswerKeyOnLastItemGoesToReviewWithoutPressing | iphone17 | Passed | 8.5 |
| 화면 | FastTapTests.testDoubleTapGradeButtonGradesOnce | iphone17 | Passed | 9.3 |
| 화면 | FastTapTests.testDoubleTapMarkCellBecomesGuess | iphone17 | Passed | 9.3 |
| 화면 | FastTapTests.testDoubleTapSheetOpenAndCloseButtons | iphone17 | Passed | 11.4 |
| 화면 | FastTapTests.testDoubleTapShortAnswerDigitEntersTwoDigits | iphone17 | Passed | 8.2 |
| 화면 | FastTapTests.testDragReleasedInPlaceThenTapIsNotFilled | iphone17 | Passed | 8.7 |
| 화면 | FastTapTests.testGradedRecordFirstMarkFastDoubleTapOnTopEdge | iphone17 | Passed | 14.2 |
| 화면 | FastTapTests.testGradedRecordFirstMarkSpacedDoubleTapOnTopEdge | iphone17 | Passed | 16.6 |
| 화면 | FastTapTests.testIntervalsWhileMeasuring | iphone17 | Passed | 130.0 |
| 화면 | FastTapTests.testLongPressThenTapIsNotFilled | iphone17 | Passed | 9.5 |
| 화면 | FastTapTests.testNeighborKeysInQuickSuccessionEnterOnceEach | iphone17 | Passed | 9.9 |
| 화면 | FastTapTests.testTapThenFastDoubleTapWithinASecondFillsThreeItems | iphone17 | Passed | 9.7 |
| 화면 | FastTapTests.testTripleTapMarkCellReturnsToNone | iphone17 | Passed | 8.4 |
| 화면 | FlowTests.testExampleAFlow | iphone17 | Passed | 155.3 |
| 화면 | FontScaleUITests.testAccessibilitySize | iphone17 | Passed | 18.2 |
| 화면 | FontScaleUITests.testDefaultSize | iphone17 | Passed | 18.1 |
| 화면 | FontScaleUITests.testLargestAccessibilitySizeIsCappedAtTwo | iphone17 | Passed | 18.3 |
| 화면 | FontScaleUITests.testLargestStandardSize | iphone17 | Passed | 18.5 |
| 화면 | KeyboardInputTests.testFacilitatorScreenAcceptsTyping | iphone17 | Passed | 10.2 |
| 화면 | LookTests.testTapThroughScreens | iphone17 | Passed | 162.9 |
| 화면 | NetworkProbeTests.testControlRunWithoutRulesWouldReachListener | iphone17 | Passed | 17.2 |
| 화면 | NetworkProbeTests.testRequestsToOutsideAreBlocked | iphone17 | Passed | 17.0 |
| 화면 | RestartTests.testGradedRecordSurvivesRestart | iphone17 | Passed | 124.2 |
| 화면 | RestartTests.testResumeAfterRestartKeepsTwelveAnswers | iphone17 | Passed | 48.3 |
| 화면 | RhythmTests.testDoubleTapOnMarkCellMakesGuess | iphone17 | Passed | 120.4 |
| 화면 | RhythmTests.testKeysAfterFixingNineAreNotEntered | iphone17 | Passed | 46.6 |
| 화면 | RhythmTests.testTapsAfterLastItemDoNotPressReviewButtons | iphone17 | Passed | 115.9 |
| 화면 | StartScreenTests.testStartScreenAppears | iphone17 | Passed | 6.9 |
| 화면 | WebFixScreenTests.testAnatomyTargetGradeBringsFirstLineIntoView | iphone17 | Passed | 21.5 |
| 화면 | WebFixScreenTests.testCapturesForProgressBarAndMarksCue | iphone17 | Passed | 27.6 |
| 화면 | WebFixScreenTests.testExamDescriptionKeepsRangeAndTypeTogether | iphone17 | Passed | 4.6 |
| 화면 | WebFixScreenTests.testKeypadPanelReachesScreenBottom | iphone17 | Passed | 14.4 |
| 화면 | WebFixScreenTests.testSpecOneShellShowsNoRemoteNoticeOrRefresh | iphone17 | Passed | 8.4 |
| 화면 | WebFixScreenTests.testStepCardTitlesAreSingleAccessibilityElements | iphone17 | Passed | 20.4 |
| 화면(어두운 화면) | CaptureTests.testCaptureScreens | iphone17 | Passed | 162.2 |
| 화면 | FontScaleUITests.testLiveChangeIsSentToWeb | iphone17 | Passed | 5.3 |
| 화면 | CaptureTests.testCaptureScreens | iphonese | Passed | 161.6 |
| 화면 | FlowTests.testExampleAFlow | iphonese | Passed | 158.3 |
| 화면 | SmallScreenTests.testInputScreenFitsWithoutScrolling | iphonese | Passed | 102.6 |
| 화면 | WebFixScreenTests.testKeypadPanelReachesScreenBottom | iphonese | Passed | 14.2 |
| 화면(어두운 화면) | CaptureTests.testCaptureScreens | iphonese | Passed | 164.0 |
| 화면 | StartScreenTests.testStartScreenAppears | ipad | Passed | 7.5 |
| 화면(Release 모양) | LookTests.testTapThroughScreens | iphone17 | Passed | 167.8 |
| 화면(Release) | ReleaseSmokeTests.testReleaseBuildRunsWithoutTesterScreensOrDebugHooks | iphone17 | Passed | 8.3 |
| 화면(참고) | FastTapTests.testAnatomyRepeatTapAfterScrollIsDiscarded | ios18 | Failed | 137.4 |
|  | 메시지 |  | FastTapTests.swift:479: XCTAssertEqual failed: ("1") is not equal to ("2") - 두 누름 모두 click 으로 왔다: pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, dblclick 2, pointerup, touchend | |
| 화면(참고) | FastTapTests.testDoubleTapAnswerKeyCrossesToNextGroup | ios18 | Passed | 9.6 |
| 화면(참고) | FastTapTests.testDoubleTapAnswerKeyFillsTwoItemsInSameGroup | ios18 | Passed | 8.8 |
| 화면(참고) | FastTapTests.testDoubleTapAnswerKeyOnLastItemGoesToReviewWithoutPressing | ios18 | Passed | 8.1 |
| 화면(참고) | FastTapTests.testDoubleTapGradeButtonGradesOnce | ios18 | Passed | 9.1 |
| 화면(참고) | FastTapTests.testDoubleTapMarkCellBecomesGuess | ios18 | Passed | 8.1 |
| 화면(참고) | FastTapTests.testDoubleTapSheetOpenAndCloseButtons | ios18 | Passed | 10.9 |
| 화면(참고) | FastTapTests.testDoubleTapShortAnswerDigitEntersTwoDigits | ios18 | Passed | 7.7 |
| 화면(참고) | FastTapTests.testDragReleasedInPlaceThenTapIsNotFilled | ios18 | Passed | 8.3 |
| 화면(참고) | FastTapTests.testGradedRecordFirstMarkFastDoubleTapOnTopEdge | ios18 | Passed | 13.4 |
| 화면(참고) | FastTapTests.testGradedRecordFirstMarkSpacedDoubleTapOnTopEdge | ios18 | Passed | 13.5 |
| 화면(참고) | FastTapTests.testIntervalsWhileMeasuring | ios18 | Passed | 127.4 |
| 화면(참고) | FastTapTests.testLongPressThenTapIsNotFilled | ios18 | Passed | 8.7 |
| 화면(참고) | FastTapTests.testNeighborKeysInQuickSuccessionEnterOnceEach | ios18 | Passed | 9.6 |
| 화면(참고) | FastTapTests.testTapThenFastDoubleTapWithinASecondFillsThreeItems | ios18 | Passed | 9.4 |
| 화면(참고) | FastTapTests.testTripleTapMarkCellReturnsToNone | ios18 | Passed | 8.2 |
| 화면(참고) | FlowTests.testExampleAFlow | ios18 | Passed | 158.0 |
| 화면(참고) | RestartTests.testGradedRecordSurvivesRestart | ios18 | Passed | 123.7 |
| 화면(참고) | RestartTests.testResumeAfterRestartKeepsTwelveAnswers | ios18 | Passed | 48.6 |

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
| 계단 | hitRegion | 놓친 배점 8점, 찍었다고 표시한 정답 4점 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 할 일 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 12번 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 20번 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 놓친 배점 8점 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 할 일 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 예시 좌표 13번 | Hit area is too small | 예외: 누를 수 없는 글자(배지, 안내문, 점수, 진행 표시, 좌표 목록)라 누름 영역 기준의 대상이 아니에요. WebKit 이 글자 하나하나를 접근성 요소로 내보내서 걸렸어요 |
| 계단 | hitRegion | 이번 시험 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 53 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |
| 계단 | hitRegion | 기록 | Hit area is too small | 예외: 아래 탭 링크예요. 실제 누름 영역은 웹 CSS(.tab: flex 1, 높이 56px 이상)라 크고, 감사는 WebKit 이 알려 준 글자 상자(약 25 x 18pt)만 쟀어요. 같은 감사 결과의 domTargets 에 실제 크기를 적었어요 |


감사와 함께 잰 실제 누름 영역(DOM, pt): 이번 시험 197 x 56, 기록 197 x 56, 이번 시험 197 x 56, 기록 197 x 56, 이번 시험 197 x 56, 기록 197 x 56

## 결정기록 7.6: 빠른 누름과 웹이 받은 이벤트

웹이 받은 이벤트는 껍데기의 DEBUG 기록(-SAEventLog)이 문서가 열리기 전부터 window 의 capture 단계에서 적은 것이에요. '(채움)'은 웹의 빠진 누름 채우기가 만들어 보낸 click(trusted 가 false)이에요. 이 기록은 웹 코드보다 먼저 불려서, 손가락에서 온 click 이 먼저 적히고 그 처리 안에서 웹이 보낸 click 이 뒤에 적혀요(웹은 채운 click 을 먼저 처리해요). 간격은 웹의 이벤트 시각(timeStamp)으로 잰 ms 예요.

| 기기 | iOS | 경우 | 결과 | 웹이 받은 이벤트 | pointer 누름/뗌 | touch 시작/끝 | 누른 자리(pt) | 손가락 click(detail) | 채운 click | 누름 시작 사이 | 손뗌에서 다음 누름 | 채운 누름 늘어난 수 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ios18 | 18.4 | 점수 해부: 고른 자리를 곧 다시 누름 | 고른 칩 (     "grade-1" ), 버린 누름 +0, 스크롤 0 -> 34, 손가락 자리의 요소 '등급컷까지 남은 점수' | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, dblclick 2, pointerup, touchend | 2/2 | 2/2 | 72,583, 72,583 | [1] | [] | [286] | [219] | 0 |
| ios18 | 18.4 | 답 키(다음 문항이 다음 묶음) | 지금 칸 7번 true, 5번 2, 6번 2 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 125,718, 125,718 | [2] | [1] | [67] | [0] |  |
| ios18 | 18.4 | 답 키(같은 묶음의 이어진 빈 두 문항) | 지금 칸 3번 true, 답 1:3 2:3 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 197,718, 197,718 | [2] | [1] | [66] | [0] |  |
| ios18 | 18.4 | 답 키(마지막 문항) | 화면 /review, 열린 시트 0, 21번 4, 알림 1 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움) | 2/2 | 2/2 | 269,718, 269,718 | [2] | [1] | [66] | [0] |  |
| ios18 | 18.4 | 채점 버튼 | 화면 /score, 알림 1 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움) | 2/2 | 2/2 | 197,723, 197,723 | [2] | [1] | [66] | [0] |  |
| ios18 | 18.4 | 표시 칸(5지선다) | 3번, 넣은 답 2, 찍음 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 197,255, 197,255 | [2] | [1] | [67] | [0] |  |
| ios18 | 18.4 | 바텀시트를 여는 버튼(입력 확인의 칸) | 열린 시트 1, 알림 0 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2, click 1 | 2/2 | 2/2 | 125,217, 125,217 | [2, 1] | [1] | [67] | [0] |  |
| ios18 | 18.4 | 바텀시트를 닫는 버튼 | 열린 시트 0, 화면 /review | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움) | 2/2 | 2/2 | 365,630, 365,630 | [2] | [1] | [67] | [0] |  |
| ios18 | 18.4 | 단답형 숫자 키 | 넣는 중인 답 77 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 125,718, 125,718 | [2] | [1] | [67] | [0] |  |
| ios18 | 18.4 | 끌다가 제자리에서 뗀 뒤 다시 누름 | 답 1:1 2:1 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 52,718, 52,718 | [1, 2] | [] | [529] | [212] |  |
| ios18 | 18.4 | 채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-아주빠르게) | 표시 ["9": "guess"], 1번 칸 1 20 247 65 68 -> 1 20 247 65 68, 안내 줄 높이 26.0, 알림 0 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 268,333, 268,333 | [2] | [1] | [67] | [0] |  |
| ios18 | 18.4 | 채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-따로누름) | 표시 ["8": "guess"], 1번 칸 1 20 247 65 68 -> 1 20 247 65 68, 안내 줄 높이 26.0, 알림 0 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 196,333, 196,333 | [1, 2] | [] | [284] | [218] |  |
| ios18 | 18.4 | 측정 중 답 키 아주 빠르게(doubleTap) | 채운 누름 1, 버린 누름 0, 답 1:3 2:3 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 197,718, 197,718 | [2] | [1] | [66] | [0] | 1 |
| ios18 | 18.4 | 측정 중 표시 칸 아주 빠르게(doubleTap) | 1번, 넣은 답 3, 찍음 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 53,255, 53,255 | [2] | [1] | [67] | [0] | 1 |
| ios18 | 18.4 | 측정 중 표시 칸 따로 보낸 누름, 가장 짧게 | 2번, 넣은 답 3, 찍음 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 124,255, 124,255 | [1, 2] | [] | [293] | [226] | 0 |
| ios18 | 18.4 | 측정 중 표시 칸 따로 보낸 누름, 0.4초 | 3번, 넣은 답 2, 찍음 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 196,255, 196,255 | [1, 2] | [] | [412] | [345] | 0 |
| ios18 | 18.4 | 측정 중 표시 칸 따로 보낸 누름, 0.5초 | 4번, 넣은 답 4, 찍음 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1 | 2/2 | 2/2 | 268,255, 268,255 | [1, 1] | [] | [509] | [442] | 0 |
| ios18 | 18.4 | 측정 중 표시 칸 0.1초 | 만들 수 없음 | 이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음 | / | / |  |  |  |  |  |  |
| ios18 | 18.4 | 측정 중 표시 칸 0.2초 | 만들 수 없음 | 이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음 | / | / |  |  |  |  |  |  |
| ios18 | 18.4 | 길게 누른 뒤 곧 다시 누름 | 답 1:1 2:1 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1 | 2/2 | 2/2 | 52,718, 52,718 | [1, 1] | [] | [916] | [216] |  |
| ios18 | 18.4 | 옆 키를 빠르게 이어 누름(3, 4, 5) | 답 1:3 2:4 3:5 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1 | 3/3 | 3/3 | 196,718, 268,718, 341,718 | [1, 1, 1] | [] | [276, 287] | [209, 220] |  |
| ios18 | 18.4 | 한 번 누른 뒤 1초 안에 아주 빠르게 두 번(같은 답 키) | 답 1:3 2:3 3:3 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 3/3 | 3/3 | 196,718, 197,718, 197,718 | [1, 2] | [1] | [674, 67] | [608, 0] |  |
| ios18 | 18.4 | 세 번 빠르게 누름(표시 칸) | 3번, 넣은 답 2, 표시 없음 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2, pointerdown, touchstart, pointerup, touchend, click 1 | 3/3 | 3/3 | 197,255, 197,255, 197,255 | [2, 1] | [1] | [67, 50] | [0, 0] |  |
| iphone17 | 26.4.1 | 점수 해부: 고른 자리를 곧 다시 누름 | 고른 칩 (     "grade-1" ), 버린 누름 +1, 스크롤 0 -> 21, 손가락 자리의 요소 '1등급' | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 72,586, 72,586 | [1, 2] | [] | [287] | [221] | 0 |
| iphone17 | 26.4.1 | 답 키(다음 문항이 다음 묶음) | 지금 칸 7번 true, 5번 2, 6번 2 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 127,740, 127,740 | [2] | [1] | [67] | [0] |  |
| iphone17 | 26.4.1 | 답 키(같은 묶음의 이어진 빈 두 문항) | 지금 칸 3번 true, 답 1:3 2:3 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 201,740, 201,740 | [2] | [1] | [66] | [0] |  |
| iphone17 | 26.4.1 | 답 키(마지막 문항) | 화면 /review, 열린 시트 0, 21번 4, 알림 1 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 1, click 2, dblclick 2 | 2/2 | 2/2 | 275,740, 275,740 | [1, 2] | [] | [67] | [0] |  |
| iphone17 | 26.4.1 | 채점 버튼 | 화면 /score, 알림 1 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움) | 2/2 | 2/2 | 201,745, 201,745 | [2] | [1] | [67] | [0] |  |
| iphone17 | 26.4.1 | 표시 칸(5지선다) | 3번, 넣은 답 2, 찍음 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 201,258, 201,258 | [2] | [1] | [67] | [0] |  |
| iphone17 | 26.4.1 | 바텀시트를 여는 버튼(입력 확인의 칸) | 열린 시트 1, 알림 0 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 127,220, 127,220 | [2] | [1] | [67] | [0] |  |
| iphone17 | 26.4.1 | 바텀시트를 닫는 버튼 | 열린 시트 0, 화면 /review | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움) | 2/2 | 2/2 | 374,652, 374,652 | [2] | [1] | [66] | [0] |  |
| iphone17 | 26.4.1 | 단답형 숫자 키 | 넣는 중인 답 77 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 127,740, 127,740 | [2] | [1] | [67] | [0] |  |
| iphone17 | 26.4.1 | 끌다가 제자리에서 뗀 뒤 다시 누름 | 답 1:1 2:1 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 53,740, 53,740 | [1, 2] | [] | [532] | [215] |  |
| iphone17 | 26.4.1 | 채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-아주빠르게) | 표시 ["9": "guess"], 1번 칸 1 20 250 66 68 -> 1 20 250 66 68, 안내 줄 높이 26.0, 알림 0 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 275,336, 275,336 | [2] | [1] | [66] | [0] |  |
| iphone17 | 26.4.1 | 채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-따로누름) | 표시 ["8": "guess"], 1번 칸 1 20 250 66 68 -> 1 20 250 66 68, 안내 줄 높이 26.0, 알림 0 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 201,336, 201,336 | [1, 2] | [] | [287] | [221] |  |
| iphone17 | 26.4.1 | 측정 중 답 키 아주 빠르게(doubleTap) | 채운 누름 1, 버린 누름 0, 답 1:3 2:3 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 201,740, 201,740 | [2] | [1] | [67] | [0] | 1 |
| iphone17 | 26.4.1 | 측정 중 표시 칸 아주 빠르게(doubleTap) | 1번, 넣은 답 3, 찍음 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 2/2 | 2/2 | 53,258, 53,258 | [2] | [1] | [66] | [0] | 1 |
| iphone17 | 26.4.1 | 측정 중 표시 칸 따로 보낸 누름, 가장 짧게 | 2번, 넣은 답 3, 찍음 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 127,258, 127,258 | [1, 2] | [] | [283] | [216] | 0 |
| iphone17 | 26.4.1 | 측정 중 표시 칸 따로 보낸 누름, 0.4초 | 3번, 넣은 답 2, 찍음 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2 | 2/2 | 2/2 | 201,258, 201,258 | [1, 2] | [] | [411] | [345] | 0 |
| iphone17 | 26.4.1 | 측정 중 표시 칸 따로 보낸 누름, 0.5초 | 4번, 넣은 답 4, 찍음 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1 | 2/2 | 2/2 | 275,258, 275,258 | [1, 1] | [] | [505] | [438] | 0 |
| iphone17 | 26.4.1 | 측정 중 표시 칸 0.1초 | 만들 수 없음 | 이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음 | / | / |  |  |  |  |  |  |
| iphone17 | 26.4.1 | 측정 중 표시 칸 0.2초 | 만들 수 없음 | 이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음 | / | / |  |  |  |  |  |  |
| iphone17 | 26.4.1 | 길게 누른 뒤 곧 다시 누름 | 답 1:1 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend | 2/2 | 2/2 | 53,740, 53,740 | [1] | [] | [910] | [211] |  |
| iphone17 | 26.4.1 | 옆 키를 빠르게 이어 누름(3, 4, 5) | 답 1:3 2:4 3:5 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1 | 3/3 | 3/3 | 201,740, 275,740, 349,740 | [1, 1, 1] | [] | [280, 283] | [214, 217] |  |
| iphone17 | 26.4.1 | 한 번 누른 뒤 1초 안에 아주 빠르게 두 번(같은 답 키) | 답 1:3 2:3 3:3 | pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2 | 3/3 | 3/3 | 201,740, 201,740, 201,740 | [1, 2] | [1] | [676, 67] | [609, 0] |  |
| iphone17 | 26.4.1 | 세 번 빠르게 누름(표시 칸) | 3번, 넣은 답 2, 표시 없음 | pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2, pointerdown, touchstart, pointerup, touchend, click 1 | 3/3 | 3/3 | 201,258, 201,258, 201,258 | [2, 1] | [1] | [66, 51] | [0, 0] |  |

- 측정 카드(ios18, iOS 18.4): '채운 누름' 2번(기록 파일 2)

- 측정 카드(iphone17, iOS 26.4.1): '채운 누름' 2번(기록 파일 2)
- 키패드 판 아래 끝(iphonese, iOS 26.4.1): {"bottomRow": [[244, 245, 247], [244, 245, 247], [244, 245, 247], [244, 245, 247]], "pad": {"bg": "rgb(244, 245, 247)", "dockPaddingBottom": 0, "innerHeight": 667, "innerWidth": 375, "keysBottom": 659, "padBottom": 667, "padPaddingBottom": 8, "padTop": 526, "page": "rgb(255, 255, 255)", "safe": 0}, "padColor": [244, 245, 247], "pageColor": [255, 255, 255], "reviewDock": {"dockBottom": 667, "dockPaddingBottom": 0, "innerHeight": 667, "lastControlBottom": 667, "safe": 0}, "safeRow": [], "sheet": {"innerHeight": 667, "lastControlBottom": 643, "safe": 0, "sheetBottom": 667, "sheetPaddingBottom": 0}, "worstDistance": 0}
- 점수 해부 목표 등급(iphone17, iOS 26.4.1): {"after": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": 706, "lineTop": 638, "scrollTop": 74}, "before": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": -1, "lineTop": -1, "scrollTop": 0}, "early": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": 737, "lineTop": 669, "scrollTop": 43}, "stay": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": 672, "lineTop": 638, "scrollTop": 74}}
- 확대 캡처(light)(iphone17, iOS 26.4.1): {"dockEnd": {"h": 168, "more": false, "top": 706}, "dockTop": {"h": 168, "more": true, "top": 706}, "progressBar": {"h": 6, "label": "입력한 문항 수", "value": "17", "w": 362, "x": 20, "y": 146}}
- 확대 캡처(dark)(iphone17, iOS 26.4.1): {"dockEnd": {"h": 168, "more": false, "top": 706}, "dockTop": {"h": 168, "more": true, "top": 706}, "progressBar": {"h": 6, "label": "입력한 문항 수", "value": "17", "w": 362, "x": 20, "y": 146}}
- 예시 시험 C 설명(iphone17, iOS 26.4.1): {"chunkTop": 377, "chunks": ["1~21번 5지선다,", "22~30번 단답형"], "firstTop": 357, "innerWidth": 402, "lines": 1, "text": "22~30번 단답형"}
- 키패드 판 아래 끝(iphone17, iOS 26.4.1): {"bottomRow": [[244, 245, 247], [244, 245, 247], [244, 245, 247], [244, 245, 247]], "pad": {"bg": "rgb(244, 245, 247)", "dockPaddingBottom": 0, "innerHeight": 874, "innerWidth": 402, "keysBottom": 832, "padBottom": 874, "padPaddingBottom": 42, "padTop": 699, "page": "rgb(255, 255, 255)", "safe": 34}, "padColor": [244, 245, 247], "pageColor": [255, 255, 255], "reviewDock": {"dockBottom": 874, "dockPaddingBottom": 34, "innerHeight": 874, "lastControlBottom": 840, "safe": 34}, "safeRow": [[244, 245, 247], [244, 245, 247], [244, 245, 247], [244, 245, 247]], "sheet": {"innerHeight": 874, "lastControlBottom": 816, "safe": 34, "sheetBottom": 874, "sheetPaddingBottom": 34}, "worstDistance": 0}
- 규격 1 껍데기의 시험 선택(iphone17, iOS 26.4.1): {"bridge": 1, "hasRemote": false, "keys": "appVersion,bridge,fontScale,platform,store", "remoteHandler": "undefined", "shown": []}
- 계단 카드 제목(iphone17, iOS 26.4.1): {"numberedTexts": ["1. 적분", "2. 수열", "3. 확률", "1. 오늘 시험지의 14번, 20번, 21번을 다시 풀기", "2. 비슷한 문항 좌표", "1. 오늘 시험지의 15번과 29번을 다시 풀기", "2. 비슷한 문항 좌표", "1. 오늘 시험지의 9번과 11번을 다시 풀기", "2. 비슷한 문항 좌표"], "pieces": {".": 0, ". ": 0, "1": 0, "1.": 0, "2": 0, "2.": 0, "3": 0}, "titles": {"1. 적분": 2, "2. 수열": 2, "3. 확률": 2}, "todo1": "1. 오늘 시험지의 14번, 20번, 21번을 다시 풀기", "todo2": "2. 비슷한 문항 좌표 예시 좌표"}

## Release 와 Debug 의 화면 모양(3-3)

같은 테스트(LookTests)를 Debug 와 Release 로 돌려 같은 누름으로 같은 화면까지 가서 찍었어요(Release 에는 상태를 심는 장치가 없어요). 캡처는 docs/screens-ios/release/debug 와 release 에 있어요. 세 가지로 견줬어요. 화면 전체의 화소(채널 차이 8 넘는 화소가 30개 넘으면 다름, 기록 화면은 Debug 전용 목록의 위 끝에서 12pt 위까지), 이름이 있는 접근성 요소의 있고 없음과 자리와 크기(1pt 넘게 다르면 다름, 기록 화면의 Debug 전용 목록 아래는 크기만), 요소마다 각자의 자리에서 잘라 견준 화소(채널 차이 8 넘는 화소가 0.5% 넘으면 다름)예요. 기록 화면은 맨 위에서 찍고(08-기록), 맨 아래까지 내린 것(08b-기록-아래)은 요소의 있고 없음만 견줘요.

| 화면 | 요소(Debug/Release) | Debug 에만 | Release 에만 | 화면 전체 화소 차이(견준 높이) | 자리 다름 | 크기 다름 | 화소를 견준 요소 | 모양 다름 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-시작 | 25/25 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 25 | 없음 |
| 02-시험선택 | 22/22 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 22 | 없음 |
| 03-답입력 | 39/39 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 39 | 없음 |
| 04-입력확인 | 50/50 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 50 | 없음 |
| 05-표시 | 63/63 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 56 | 없음 |
| 06-점수해부 | 43/43 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 39 | 없음 |
| 07-계단 | 76/76 | 없음 | 없음 | 0화소(874pt) | 없음 | 없음 | 48 | 없음 |
| 08-기록 | 31/18 | 7일 뒤 확인, 공유 리포트, 실수 카드, 응답이 모이면 열려요., 점수대별 정답률, 준비 중이에요., 준비 중인 기능, 준비 중인 기능, 준비 중인 기능, region, 테스트 진행자용, 테스트 진행자용 | 없음 | 0화소(302pt) | 없음 | 없음 | 14 | 없음 |
| 08b-기록-아래 | 31/18 | 7일 뒤 확인, 공유 리포트, 실수 카드, 응답이 모이면 열려요., 점수대별 정답률, 준비 중이에요., 준비 중인 기능, 준비 중인 기능, 준비 중인 기능, region, 테스트 진행자용, 테스트 진행자용 | 없음 | ?화소(?pt) | 없음 | 없음 | None | 없음 |

## 숫자 기록

- {"device": "iphonese", "haptics": 49, "kind": "flow", "seconds": 153.3248690366745, "steps": 3}
- {"checked": [{"overflow": {"body": 0, "doc": 0, "h": 667, "w": 375}, "screen": "객관식"}, {"overflow": {"body": 0, "doc": 0, "h": 667, "w": 375}, "screen": "잠금"}, {"overflow": {"body": 0, "doc": 0, "h": 667, "w": 375}, "screen": "단답형"}], "device": "iphonese", "kind": "small", "window": "375.0x667.0"}
- {"bottomRow": [[244, 245, 247], [244, 245, 247], [244, 245, 247], [244, 245, 247]], "case": "키패드 판 아래 끝", "device": "iphonese", "kind": "webfix", "os": "26.4.1", "pad": {"bg": "rgb(244, 245, 247)", "dockPaddingBottom": 0, "innerHeight": 667, "innerWidth": 375, "keysBottom": 659, "padBottom": 667, "padPaddingBottom": 8, "padTop": 526, "page": "rgb(255, 255, 255)", "safe": 0}, "padColor": [244, 245, 247], "pageColor": [255, 255, 255], "reviewDock": {"dockBottom": 667, "dockPaddingBottom": 0, "inne
- {"case": "점수 해부: 고른 자리를 곧 다시 누름", "dblclick": 1, "device": "ios18", "discardedDelta": 0, "filledDelta": 0, "holdMs": [67, 66], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["72,583", "72,583"], "pressToPressMs": [286], "realClicks": [1], "releaseToPressMs": [219], "result": "고른 칩 (\n    \"grade-1\"\n), 버린 누름 +0, 스크롤 0 -> 34, 손가락 자리의 요소 '등급컷까지 남은 점수'", "sequence": "pointerdown, touchstart, pointerup, touchend, 
- {"case": "답 키(다음 문항이 다음 묶음)", "dblclick": 1, "device": "ios18", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["125,718", "125,718"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "지금 칸 7번 true, 5번 2, 6번 2", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:2"], "touc
- {"case": "답 키(같은 묶음의 이어진 빈 두 문항)", "dblclick": 1, "device": "ios18", "holdMs": [66, 51], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["197,718", "197,718"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "지금 칸 3번 true, 답 1:3 2:3", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:3"], "
- {"case": "답 키(마지막 문항)", "dblclick": 0, "device": "ios18", "holdMs": [66, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["269,718", "269,718"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "화면 /review, 열린 시트 0, 21번 4, 알림 1", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움)", "targets": ["button:4"], "touchcancel": 
- {"case": "채점 버튼", "dblclick": 0, "device": "ios18", "holdMs": [66, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["197,723", "197,723"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "화면 /score, 알림 1", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움)", "targets": ["button:없어요, 채점하기"], "touchcancel": 0, "touchend": 
- {"case": "표시 칸(5지선다)", "dblclick": 1, "device": "ios18", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["197,255", "197,255"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "3번, 넣은 답 2, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["mark-cell:3"], "touchcancel": 0, "
- {"case": "바텀시트를 여는 버튼(입력 확인의 칸)", "dblclick": 1, "device": "ios18", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["125,217", "125,217"], "pressToPressMs": [67], "realClicks": [2, 1], "releaseToPressMs": [0], "result": "열린 시트 1, 알림 0", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2, click 1", "targets": ["button:2번, 넣
- {"case": "바텀시트를 닫는 버튼", "dblclick": 0, "device": "ios18", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["365,630", "365,630"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "열린 시트 0, 화면 /review", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움)", "targets": ["button:닫기"], "touchcancel": 0, "touchend
- {"case": "단답형 숫자 키", "dblclick": 1, "device": "ios18", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["125,718", "125,718"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "넣는 중인 답 77", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:7"], "touchcancel": 0, "touchend"
- {"case": "끌다가 제자리에서 뗀 뒤 다시 누름", "dblclick": 1, "device": "ios18", "fillPathExercised": false, "holdMs": [317, 67], "kind": "fasttap", "madeClicks": [], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["52,718", "52,718"], "pressToPressMs": [529], "realClicks": [1, 2], "releaseToPressMs": [212], "result": "답 1:1 2:1", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2", "targets": ["bu
- {"case": "채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-아주빠르게)", "dblclick": 1, "device": "ios18", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["268,333", "268,333"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "표시 [\"9\": \"guess\"], 1번 칸 1 20 247 65 68 -> 1 20 247 65 68, 안내 줄 높이 26.0, 알림 0", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup,
- {"case": "채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-따로누름)", "dblclick": 1, "device": "ios18", "holdMs": [66, 67], "kind": "fasttap", "madeClicks": [], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["196,333", "196,333"], "pressToPressMs": [284], "realClicks": [1, 2], "releaseToPressMs": [218], "result": "표시 [\"8\": \"guess\"], 1번 칸 1 20 247 65 68 -> 1 20 247 65 68, 안내 줄 높이 26.0, 알림 0", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstar
- {"case": "측정 중 답 키 아주 빠르게(doubleTap)", "dblclick": 1, "device": "ios18", "discardedDelta": 0, "filledDelta": 1, "holdMs": [66, 50], "kind": "fasttap", "madeClicks": [1], "measure": true, "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["197,718", "197,718"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "채운 누름 1, 버린 누름 0, 답 1:3 2:3", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchen
- {"case": "측정 중 표시 칸 아주 빠르게(doubleTap)", "dblclick": 1, "device": "ios18", "discardedDelta": 0, "filledDelta": 1, "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "measure": true, "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["53,255", "53,255"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "1번, 넣은 답 3, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, cl
- {"case": "측정 중 표시 칸 따로 보낸 누름, 가장 짧게", "dblclick": 1, "device": "ios18", "discardedDelta": 0, "filledDelta": 0, "holdMs": [67, 66], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["124,255", "124,255"], "pressToPressMs": [293], "realClicks": [1, 2], "releaseToPressMs": [226], "result": "2번, 넣은 답 3, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchen
- {"case": "측정 중 표시 칸 따로 보낸 누름, 0.4초", "dblclick": 1, "device": "ios18", "discardedDelta": 0, "filledDelta": 0, "holdMs": [67, 66], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["196,255", "196,255"], "pressToPressMs": [412], "realClicks": [1, 2], "releaseToPressMs": [345], "result": "3번, 넣은 답 2, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend
- {"case": "측정 중 표시 칸 따로 보낸 누름, 0.5초", "dblclick": 0, "device": "ios18", "discardedDelta": 0, "filledDelta": 0, "holdMs": [67, 66], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["268,255", "268,255"], "pressToPressMs": [509], "realClicks": [1, 1], "releaseToPressMs": [442], "result": "4번, 넣은 답 4, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend
- {"case": "측정 중 표시 칸 0.1초", "device": "ios18", "kind": "fasttap", "measure": true, "os": "18.4", "reason": "이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음", "result": "만들 수 없음", "target": "0.1초"}
- {"case": "측정 중 표시 칸 0.2초", "device": "ios18", "kind": "fasttap", "measure": true, "os": "18.4", "reason": "이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음", "result": "만들 수 없음", "target": "0.2초"}
- {"device": "ios18", "filledShown": "2번", "filledStored": 2, "kind": "fasttap-card", "os": "18.4"}
- {"case": "길게 누른 뒤 곧 다시 누름", "dblclick": 0, "device": "ios18", "fillPathExercised": false, "holdMs": [700, 66], "kind": "fasttap", "madeClicks": [], "os": "18.4", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["52,718", "52,718"], "pressToPressMs": [916], "realClicks": [1, 1], "releaseToPressMs": [216], "result": "답 1:1 2:1", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1", "targets": ["button:1"], "touch
- {"case": "옆 키를 빠르게 이어 누름(3, 4, 5)", "dblclick": 0, "device": "ios18", "holdMs": [67, 67, 67], "kind": "fasttap", "madeClicks": [], "os": "18.4", "pointercancel": 0, "pointerdown": 3, "pointerup": 3, "points": ["196,718", "268,718", "341,718"], "pressToPressMs": [276, 287], "realClicks": [1, 1, 1], "releaseToPressMs": [209, 220], "result": "답 1:3 2:4 3:5", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchs
- {"case": "한 번 누른 뒤 1초 안에 아주 빠르게 두 번(같은 답 키)", "dblclick": 1, "device": "ios18", "holdMs": [66, 67, 50], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 3, "pointerup": 3, "points": ["196,718", "197,718", "197,718"], "pressToPressMs": [674, 67], "realClicks": [1, 2], "releaseToPressMs": [608, 0], "result": "답 1:3 2:3 3:3", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart
- {"case": "세 번 빠르게 누름(표시 칸)", "dblclick": 1, "device": "ios18", "holdMs": [67, 50, 66], "kind": "fasttap", "madeClicks": [1], "os": "18.4", "pointercancel": 0, "pointerdown": 3, "pointerup": 3, "points": ["197,255", "197,255", "197,255"], "pressToPressMs": [67, 50], "realClicks": [2, 1], "releaseToPressMs": [0, 0], "result": "3번, 넣은 답 2, 표시 없음", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2, pointerdown, t
- {"device": "ios18", "haptics": 49, "kind": "flow", "seconds": 153.48227500915527, "steps": 3}
- {"case": "resume12", "kind": "restart", "secondsUntilSaved": 0.0019299983978271484}
- {"category": "live-accessibility-medium", "kind": "font", "rootPx": 26.352942}
- {"device": "ipad", "kind": "start", "runnerIdiom": "phone", "window": "663.0x1180.0"}
- {"case": "점수 해부: 고른 자리를 곧 다시 누름", "dblclick": 1, "device": "iphone17", "discardedDelta": 1, "filledDelta": 0, "holdMs": [66, 66], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["72,586", "72,586"], "pressToPressMs": [287], "realClicks": [1, 2], "releaseToPressMs": [221], "result": "고른 칩 (\n    \"grade-1\"\n), 버린 누름 +1, 스크롤 0 -> 21, 손가락 자리의 요소 '1등급'", "sequence": "pointerdown, touchstart, pointerup, touchend, 
- {"case": "답 키(다음 문항이 다음 묶음)", "dblclick": 1, "device": "iphone17", "holdMs": [67, 49], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["127,740", "127,740"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "지금 칸 7번 true, 5번 2, 6번 2", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:2"], 
- {"case": "답 키(같은 묶음의 이어진 빈 두 문항)", "dblclick": 1, "device": "iphone17", "holdMs": [66, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["201,740", "201,740"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "지금 칸 3번 true, 답 1:3 2:3", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:3
- {"case": "답 키(마지막 문항)", "dblclick": 1, "device": "iphone17", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["275,740", "275,740"], "pressToPressMs": [67], "realClicks": [1, 2], "releaseToPressMs": [0], "result": "화면 /review, 열린 시트 0, 21번 4, 알림 1", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 1, click 2, dblclick 2", "targets": ["button:4", "
- {"case": "채점 버튼", "dblclick": 0, "device": "iphone17", "holdMs": [67, 49], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["201,745", "201,745"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "화면 /score, 알림 1", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움)", "targets": ["button:없어요, 채점하기"], "touchcancel": 0, "touche
- {"case": "표시 칸(5지선다)", "dblclick": 1, "device": "iphone17", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["201,258", "201,258"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "3번, 넣은 답 2, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["mark-cell:3"], "touchcancel":
- {"case": "바텀시트를 여는 버튼(입력 확인의 칸)", "dblclick": 1, "device": "iphone17", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["127,220", "127,220"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "열린 시트 1, 알림 0", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:2번, 넣은 답 5, 
- {"case": "바텀시트를 닫는 버튼", "dblclick": 0, "device": "iphone17", "holdMs": [66, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["374,652", "374,652"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "열린 시트 0, 화면 /review", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움)", "targets": ["button:닫기"], "touchcancel": 0, "tou
- {"case": "단답형 숫자 키", "dblclick": 1, "device": "iphone17", "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["127,740", "127,740"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "넣는 중인 답 77", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2", "targets": ["button:7"], "touchcancel": 0, "touc
- {"case": "끌다가 제자리에서 뗀 뒤 다시 누름", "dblclick": 1, "device": "iphone17", "fillPathExercised": false, "holdMs": [317, 67], "kind": "fasttap", "madeClicks": [], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["53,740", "53,740"], "pressToPressMs": [532], "realClicks": [1, 2], "releaseToPressMs": [215], "result": "답 1:1 2:1", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 2, dblclick 2", "targets":
- {"case": "채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-아주빠르게)", "dblclick": 1, "device": "iphone17", "holdMs": [66, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["275,336", "275,336"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "표시 [\"9\": \"guess\"], 1번 칸 1 20 250 66 68 -> 1 20 250 66 68, 안내 줄 높이 26.0, 알림 0", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, point
- {"case": "채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(채점한기록-따로누름)", "dblclick": 1, "device": "iphone17", "holdMs": [66, 67], "kind": "fasttap", "madeClicks": [], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["201,336", "201,336"], "pressToPressMs": [287], "realClicks": [1, 2], "releaseToPressMs": [221], "result": "표시 [\"8\": \"guess\"], 1번 칸 1 20 250 66 68 -> 1 20 250 66 68, 안내 줄 높이 26.0, 알림 0", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touc
- {"case": "측정 중 답 키 아주 빠르게(doubleTap)", "dblclick": 1, "device": "iphone17", "discardedDelta": 0, "filledDelta": 1, "holdMs": [67, 50], "kind": "fasttap", "madeClicks": [1], "measure": true, "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["201,740", "201,740"], "pressToPressMs": [67], "realClicks": [2], "releaseToPressMs": [0], "result": "채운 누름 1, 버린 누름 0, 답 1:3 2:3", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, to
- {"case": "측정 중 표시 칸 아주 빠르게(doubleTap)", "dblclick": 1, "device": "iphone17", "discardedDelta": 0, "filledDelta": 1, "holdMs": [66, 51], "kind": "fasttap", "madeClicks": [1], "measure": true, "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["53,258", "53,258"], "pressToPressMs": [66], "realClicks": [2], "releaseToPressMs": [0], "result": "1번, 넣은 답 3, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 
- {"case": "측정 중 표시 칸 따로 보낸 누름, 가장 짧게", "dblclick": 1, "device": "iphone17", "discardedDelta": 0, "filledDelta": 0, "holdMs": [67, 67], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["127,258", "127,258"], "pressToPressMs": [283], "realClicks": [1, 2], "releaseToPressMs": [216], "result": "2번, 넣은 답 3, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, to
- {"case": "측정 중 표시 칸 따로 보낸 누름, 0.4초", "dblclick": 1, "device": "iphone17", "discardedDelta": 0, "filledDelta": 0, "holdMs": [66, 67], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["201,258", "201,258"], "pressToPressMs": [411], "realClicks": [1, 2], "releaseToPressMs": [345], "result": "3번, 넣은 답 2, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, tou
- {"case": "측정 중 표시 칸 따로 보낸 누름, 0.5초", "dblclick": 0, "device": "iphone17", "discardedDelta": 0, "filledDelta": 0, "holdMs": [67, 67], "kind": "fasttap", "madeClicks": [], "measure": true, "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["275,258", "275,258"], "pressToPressMs": [505], "realClicks": [1, 1], "releaseToPressMs": [438], "result": "4번, 넣은 답 4, 찍음", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, tou
- {"case": "측정 중 표시 칸 0.1초", "device": "iphone17", "kind": "fasttap", "measure": true, "os": "26.4.1", "reason": "이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음", "result": "만들 수 없음", "target": "0.1초"}
- {"case": "측정 중 표시 칸 0.2초", "device": "iphone17", "kind": "fasttap", "measure": true, "os": "26.4.1", "reason": "이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음", "result": "만들 수 없음", "target": "0.2초"}
- {"device": "iphone17", "filledShown": "2번", "filledStored": 2, "kind": "fasttap-card", "os": "26.4.1"}
- {"case": "길게 누른 뒤 곧 다시 누름", "dblclick": 0, "device": "iphone17", "fillPathExercised": false, "holdMs": [699, 66], "kind": "fasttap", "madeClicks": [], "os": "26.4.1", "pointercancel": 0, "pointerdown": 2, "pointerup": 2, "points": ["53,740", "53,740"], "pressToPressMs": [910], "realClicks": [1], "releaseToPressMs": [211], "result": "답 1:1", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend", "targets": ["button:1"], "touchcancel": 0,
- {"case": "옆 키를 빠르게 이어 누름(3, 4, 5)", "dblclick": 0, "device": "iphone17", "holdMs": [66, 66, 67], "kind": "fasttap", "madeClicks": [], "os": "26.4.1", "pointercancel": 0, "pointerdown": 3, "pointerup": 3, "points": ["201,740", "275,740", "349,740"], "pressToPressMs": [280, 283], "realClicks": [1, 1, 1], "releaseToPressMs": [214, 217], "result": "답 1:3 2:4 3:5", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, t
- {"case": "한 번 누른 뒤 1초 안에 아주 빠르게 두 번(같은 답 키)", "dblclick": 1, "device": "iphone17", "holdMs": [67, 67, 50], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 3, "pointerup": 3, "points": ["201,740", "201,740", "201,740"], "pressToPressMs": [676, 67], "realClicks": [1, 2], "releaseToPressMs": [609, 0], "result": "답 1:3 2:3 3:3", "sequence": "pointerdown, touchstart, pointerup, touchend, click 1, pointerdown, touchstart, pointerup, touchend, pointerdown, touch
- {"case": "세 번 빠르게 누름(표시 칸)", "dblclick": 1, "device": "iphone17", "holdMs": [66, 51, 66], "kind": "fasttap", "madeClicks": [1], "os": "26.4.1", "pointercancel": 0, "pointerdown": 3, "pointerup": 3, "points": ["201,258", "201,258", "201,258"], "pressToPressMs": [66, 51], "realClicks": [2, 1], "releaseToPressMs": [0, 0], "result": "3번, 넣은 답 2, 표시 없음", "sequence": "pointerdown, touchstart, pointerup, touchend, pointerdown, touchstart, pointerup, touchend, click 2, click 1(채움), dblclick 2, pointerdo
- {"device": "iphone17", "haptics": 49, "kind": "flow", "seconds": 150.44589602947235, "steps": 3}
- {"category": "UICTContentSizeCategoryAccessibilityM", "fontScale": 1.6470588235294117, "kind": "font", "rootPx": 26.352942}
- {"category": "UICTContentSizeCategoryL", "fontScale": 1, "kind": "font", "rootPx": 16}
- {"category": "UICTContentSizeCategoryAccessibilityXXXL", "fontScale": 2, "kind": "font", "rootPx": 32}
- {"category": "UICTContentSizeCategoryXXXL", "fontScale": 1.3529411764705883, "kind": "font", "rootPx": 21.647058}
- {"fieldMaxY": 260, "keyboardMinY": 583, "keyboardShown": true, "kind": "keyboard"}
- {"blockedNavigations": 7, "connections": 30, "kind": "network", "mode": "control", "requests": 30}
- {"blockedNavigations": 7, "blockedWindows": 0, "connections": 0, "kind": "network", "mode": "blocked", "outcomes": {"beacon": false, "eventSource": "error", "fetch": "error:Load failed", "fetchHttps": "error:Load failed", "iframe": "timeout", "image": "error", "script": "error", "style": "error", "websocket": "error", "windowOpenReturnedNull": true, "xhr": "error"}, "preconnects": 1, "requests": []}
- {"case": "resume12", "kind": "restart", "secondsUntilSaved": 0.0008460283279418945}
- {"case": "marks-double", "fastDoubleTapEvents": ["touchstart:0", "touchend:0", "touchstart:0", "touchend:0", "click:1", "click:2", "dblclick:2"], "fastDoubleTapLabel": "20번, 넣은 답 3, 찍음", "firstClickAfterTouchEndMs": 2.000000000014552, "gaps": [0.3839460611343384, 0.3937109708786011], "kind": "rhythm", "madeClicks": [], "realClicks": [1, 2, 1, 2]}
- {"case": "lock", "gaps": [0.36794400215148926, 0.3839069604873657, 0.37870800495147705, 0.36899900436401367], "kind": "rhythm", "madeClicks": [], "realClicks": [1, 1, 1, 1, 1]}
- {"case": "last-item", "gaps": [0.37832093238830566, 0.3998219966888428, 0.39757204055786133, 0.4027550220489502, 0.400412917137146, 0.39461302757263184, 0.3887060880661011, 0.39779388904571533], "kind": "rhythm", "madeClicks": [], "notices": 0, "realClicks": [1, 1, 1, 1, 1, 1, 1, 1, 1]}
- {"device": "iphone17", "kind": "start", "runnerIdiom": "phone", "window": "402.0x874.0"}
- {"after": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": 706, "lineTop": 638, "scrollTop": 74}, "before": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": -1, "lineTop": -1, "scrollTop": 0}, "case": "점수 해부 목표 등급", "device": "iphone17", "early": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": 737, "lineTop": 669, "scrollTop": 43}, "kind": "webfix", "os": "26.4.1", "stay": {"bodyBottom": 706, "bodyTop": 110, "dockTop": 706, "lineBottom": 672, "
- {"case": "확대 캡처(light)", "device": "iphone17", "dockEnd": {"h": 168, "more": false, "top": 706}, "dockTop": {"h": 168, "more": true, "top": 706}, "kind": "webfix", "os": "26.4.1", "progressBar": {"h": 6, "label": "입력한 문항 수", "value": "17", "w": 362, "x": 20, "y": 146}}
- {"case": "확대 캡처(dark)", "device": "iphone17", "dockEnd": {"h": 168, "more": false, "top": 706}, "dockTop": {"h": 168, "more": true, "top": 706}, "kind": "webfix", "os": "26.4.1", "progressBar": {"h": 6, "label": "입력한 문항 수", "value": "17", "w": 362, "x": 20, "y": 146}}
- {"case": "예시 시험 C 설명", "chunkTop": 377, "chunks": ["1~21번 5지선다,", "22~30번 단답형"], "device": "iphone17", "firstTop": 357, "innerWidth": 402, "kind": "webfix", "lines": 1, "os": "26.4.1", "text": "22~30번 단답형"}
- {"bottomRow": [[244, 245, 247], [244, 245, 247], [244, 245, 247], [244, 245, 247]], "case": "키패드 판 아래 끝", "device": "iphone17", "kind": "webfix", "os": "26.4.1", "pad": {"bg": "rgb(244, 245, 247)", "dockPaddingBottom": 0, "innerHeight": 874, "innerWidth": 402, "keysBottom": 832, "padBottom": 874, "padPaddingBottom": 42, "padTop": 699, "page": "rgb(255, 255, 255)", "safe": 34}, "padColor": [244, 245, 247], "pageColor": [255, 255, 255], "reviewDock": {"dockBottom": 874, "dockPaddingBottom": 34, "i
- {"bridge": 1, "case": "규격 1 껍데기의 시험 선택", "device": "iphone17", "hasRemote": false, "keys": "appVersion,bridge,fontScale,platform,store", "kind": "webfix", "os": "26.4.1", "remoteHandler": "undefined", "shown": []}
- {"case": "계단 카드 제목", "device": "iphone17", "kind": "webfix", "numberedTexts": ["1. 적분", "2. 수열", "3. 확률", "1. 오늘 시험지의 14번, 20번, 21번을 다시 풀기", "2. 비슷한 문항 좌표", "1. 오늘 시험지의 15번과 29번을 다시 풀기", "2. 비슷한 문항 좌표", "1. 오늘 시험지의 9번과 11번을 다시 풀기", "2. 비슷한 문항 좌표"], "os": "26.4.1", "pieces": {".": 0, ". ": 0, "1": 0, "1.": 0, "2": 0, "2.": 0, "3": 0}, "titles": {"1. 적분": 2, "2. 수열": 2, "3. 확률": 2}, "todo1": "1. 오늘 시험지의 14번, 20번, 21번을 다시 풀기", "todo2": "2. 비슷한 문항 좌표 예시 좌표"}

## 캡처

docs/screens-ios/기기/테마/번호-화면.png 로 남겼어요. 같은 화면의 웹 캡처와의 비교는 docs/ios_화면비교.md 에 있어요.

