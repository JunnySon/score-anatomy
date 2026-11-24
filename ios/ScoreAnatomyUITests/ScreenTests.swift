import XCTest

/// 6-8 작은 화면(iPhone SE 3세대에서 돈다): 기본 글자 크기에서 답 입력 화면의 문항 번호, 안내문 자리, 키패드가
/// 스크롤 없이 보이고 눌린다.
@MainActor
final class SmallScreenTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func assertVisible(_ element: XCUIElement, _ name: String, in window: CGRect, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 5), "\(name) 가 있어야 한다", file: file, line: line)
        let frame = element.frame
        XCTAssertTrue(window.contains(frame), "\(name) 가 화면 안에 다 보여야 한다: \(frame) / \(window)", file: file, line: line)
        XCTAssertTrue(element.isHittable, "\(name) 를 누를 수 있어야 한다", file: file, line: line)
    }

    /// 웹 화면 어디에도 스크롤할 것이 없는지(본문 영역과 문서 모두).
    private func scrollOverflow(_ handle: AppHandle) -> [String: Any] {
        handle.evaluate("""
        const doc = document.scrollingElement;
        const body = document.querySelector('main.body') || document.querySelector('.body');
        return { doc: doc.scrollHeight - doc.clientHeight, body: body ? body.scrollHeight - body.clientHeight : -1, h: innerHeight, w: innerWidth };
        """) as? [String: Any] ?? [:]
    }

    func testInputScreenFitsWithoutScrolling() throws {
        let handle = AppHandle(name: "small-input")
        handle.launch()
        handle.startExampleA()
        let window = handle.app.windows.firstMatch.frame
        let hint = handle.any("다섯 문항마다 시험지와 맞춰 보세요. 칸을 누르면 그 문항으로 가요.")
        var checked: [[String: Any]] = []

        // 5지선다 첫 화면
        assertVisible(handle.nowNumber(1), "문항 번호 1번", in: window)
        assertVisible(hint, "안내문", in: window)
        for label in ["1", "2", "3", "4", "5", "안 풂", "지우기"] {
            assertVisible(handle.keypad.buttons.matching(handle.exact(label)).firstMatch, "키 \(label)", in: window)
        }
        XCTAssertLessThanOrEqual(hint.frame.maxY, handle.keypad.frame.minY + 0.5, "안내문이 키패드에 가리지 않는다")
        var overflow = scrollOverflow(handle)
        XCTAssertLessThanOrEqual(overflow["doc"] as? Int ?? 99, 0, "문서가 스크롤되지 않는다: \(overflow)")
        XCTAssertLessThanOrEqual(overflow["body"] as? Int ?? 99, 0, "본문이 스크롤되지 않는다: \(overflow)")
        checked.append(["screen": "객관식", "overflow": overflow])
        handle.tapKey("3")
        XCTAssertTrue(handle.nowNumber(2).waitForExistence(timeout: 3), "키를 누르면 다음 문항")
        XCTAssertEqual(handle.inputCell(1).label, "1번 칸, 넣은 답 3")

        // 잠금 상태의 안내문 자리(9번을 고친 뒤)
        handle.enterAnswers(from: 2, to: 11)
        handle.inputCell(9).tap()
        XCTAssertTrue(handle.nowNumber(9).waitForExistence(timeout: 3))
        handle.tapKey("4")
        let locked = handle.element(labelContains: "9번에 답을 넣었어요. 다음에 할 일을 골라 주세요.")
        assertVisible(locked, "잠금 안내", in: window)
        let continueButton = handle.button("12번부터 이어서 넣기")
        assertVisible(continueButton, "이어서 넣기 버튼", in: window)
        overflow = scrollOverflow(handle)
        XCTAssertLessThanOrEqual(overflow["body"] as? Int ?? 99, 0, "잠금 상태도 스크롤되지 않는다: \(overflow)")
        checked.append(["screen": "잠금", "overflow": overflow])
        continueButton.tap()

        // 단답형 화면(키패드가 가장 높다)
        handle.enterAnswers(from: 12, to: 21)
        XCTAssertTrue(handle.nowNumber(22).waitForExistence(timeout: 5))
        assertVisible(handle.nowNumber(22), "문항 번호 22번", in: window)
        for label in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "안 풂", "지우기", "다음"] {
            assertVisible(handle.keypad.buttons.matching(handle.exact(label)).firstMatch, "단답형 키 \(label)", in: window)
        }
        overflow = scrollOverflow(handle)
        XCTAssertLessThanOrEqual(overflow["body"] as? Int ?? 99, 0, "단답형 화면도 스크롤되지 않는다: \(overflow)")
        checked.append(["screen": "단답형", "overflow": overflow])
        handle.tapKey("1")
        handle.tapKey("2")
        handle.tapKey("다음")
        XCTAssertTrue(handle.nowNumber(23).waitForExistence(timeout: 3))
        XCTAssertEqual(handle.storedAnswers()[22] as? Int, 12)
        recordMetric(["kind": "small", "device": TestEnv.deviceTag, "window": "\(window.size.width)x\(window.size.height)", "checked": checked])
    }
}

/// 6-9 iPad(아이폰 앱 호환 방식)와 어느 기기에서든 시작 화면이 뜨는지.
@MainActor
final class StartScreenTests: XCTestCase {
    func testStartScreenAppears() throws {
        let handle = AppHandle(name: "start")
        handle.launch()
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20), "시작 화면의 '시험 고르기'")
        XCTAssertTrue(handle.button("예시 결과 보기").exists)
        XCTAssertTrue(handle.any("가입 없이 써요. 기록은 이 기기에 저장하고 서버로 보내지 않아요.").exists, "앱 안에서만 쓰는 문구")
        Thread.sleep(forTimeInterval: 0.8)
        handle.capture("시작", theme: "light")
        let window = handle.app.windows.firstMatch.frame
        recordMetric(["kind": "start", "device": TestEnv.deviceTag, "runnerIdiom": UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone", "window": "\(window.size.width)x\(window.size.height)"])
    }
}

/// 껍데기와 다리가 웹과 함께 맞게 도는지(보관, 저장 실패, 불러오기 실패).
@MainActor
final class BridgeIntegrationTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func archives(_ handle: AppHandle) -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: handle.storeDirectory, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("store-보관-") }
    }

    func testUnreadableStoreIsArchivedNotOverwritten() throws {
        let handle = AppHandle(name: "bridge-unreadable")
        handle.launch(seed: "unreadable")
        let original = Data([0xFF, 0xFE, 0xFD, 0x80, 0x81, 0x7B])
        XCTAssertTrue(handle.waitForStore { _ in true }, "보관한 뒤 새 기록을 저장한다")
        let kept = archives(handle)
        XCTAssertEqual(kept.count, 1, "읽지 못한 기록은 보관 파일 하나로 남는다")
        XCTAssertEqual(try kept.first.map { try Data(contentsOf: $0) }, original, "보관 파일의 바이트는 원래 그대로")
        XCTAssertEqual(handle.storeJSON()?["archiveNotice"] as? Bool, true, "새 기록에 보관 안내 표시")
        handle.web.links.matching(handle.exact("기록")).firstMatch.tap()
        handle.waitForText("앞서 저장된 기록을 읽지 못해 따로 보관해 뒀어요.")
        XCTAssertEqual((handle.shellStats()["archives"] as? [Bool]) ?? [], [true])
    }

    func testFutureVersionIsArchived() throws {
        let handle = AppHandle(name: "bridge-future")
        handle.launch(seed: "future")
        XCTAssertTrue(handle.waitForStore { ($0["version"] as? Int) == 1 }, "새 기록(version 1)으로 시작한다")
        let kept = archives(handle)
        XCTAssertEqual(kept.count, 1)
        XCTAssertEqual(try kept.first.map { try String(contentsOf: $0, encoding: .utf8) }, #"{"version":99,"sessions":[]}"#)
    }

    func testSaveFailureShowsNotice() throws {
        let handle = AppHandle(name: "bridge-readonly")
        // 기록 폴더에 쓸 수 없게 한다(임시 파일을 만들지 못해 저장이 실패한다).
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: handle.storeDirectory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: handle.storeDirectory.path) }
        handle.launch()
        // '답 넣기'에서 새 기록을 처음 저장한다. 폴더에 쓸 수 없어 실패하고 껍데기가 storeFailed 로 알린다.
        handle.startExampleA()
        XCTAssertTrue(handle.waitForStats { (($0["sent"] as? [String]) ?? []).contains("{\"type\":\"storeFailed\"}") }, "storeFailed 를 알렸다")
        // 답 입력 화면은 탭이 없어서 뒤로 나가 탭이 있는 화면에서 기록으로 간다.
        handle.button("뒤로").tap()
        let historyTab = handle.web.links.matching(handle.exact("기록")).firstMatch
        XCTAssertTrue(historyTab.waitForExistence(timeout: 8), "탭이 있는 화면")
        historyTab.tap()
        // 웹은 처음 실패했을 때 위쪽에 잠깐 알리고, 기록 화면에는 저장하지 못하는 동안 계속 보여 준다.
        handle.waitForText("이 기기에 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.")
        XCTAssertFalse(FileManager.default.fileExists(atPath: handle.storeFile.path), "store.json 을 만들지 않았다")
        let leftovers = (try? FileManager.default.contentsOfDirectory(atPath: handle.storeDirectory.path)) ?? []
        XCTAssertEqual(leftovers, [], "임시 파일도 남지 않았다")
        // 화면은 그대로 쓸 수 있다.
        handle.web.links.matching(handle.exact("이번 시험")).firstMatch.tap()
        XCTAssertTrue(handle.web.links.matching(handle.exact("기록")).firstMatch.waitForExistence(timeout: 5))
    }

    func testLoadFailureShowsMessage() throws {
        let handle = AppHandle(name: "bridge-loadfail")
        handle.launch(extra: ["-SAForceLoadFailure"], waitForStart: false)
        let message = handle.app.staticTexts["화면을 불러오지 못했어요. 앱을 다시 켜 주세요."]
        XCTAssertTrue(message.waitForExistence(timeout: 20), "흰 화면 대신 안내")
        XCTAssertFalse(handle.app.webViews.firstMatch.exists, "웹뷰는 보이지 않는다")
        handle.capture("불러오기실패", theme: "light")
    }
}

/// 진행자용 화면(시험용 묶음)에서 기기 자판으로 글을 넣을 수 있다(지시서 5-9).
@MainActor
final class KeyboardInputTests: XCTestCase {
    func testFacilitatorScreenAcceptsTyping() throws {
        continueAfterFailure = false
        let handle = AppHandle(name: "keyboard")
        handle.launch()
        handle.web.links.matching(handle.exact("기록")).firstMatch.tap()
        let tester = handle.web.links.matching(handle.exact("테스트 진행자용")).firstMatch
        XCTAssertTrue(tester.waitForExistence(timeout: 8), "기록 화면 아래 '테스트 진행자용' 링크(시험용 묶음)")
        handle.reveal(tester, label: "테스트 진행자용")
        tester.tap()
        let field = handle.web.textFields.matching(NSPredicate(format: "label BEGINSWITH %@", "참가자 코드")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8), "참가자 코드 칸")
        field.tap()
        let keyboard = handle.app.keyboards.firstMatch
        let keyboardShown = keyboard.waitForExistence(timeout: 8)
        field.typeText("P01")
        XCTAssertEqual(handle.evaluate("return document.getElementById('participant').value;") as? String, "P01", "넣은 글이 칸에 들어갔다")
        XCTAssertEqual(handle.evaluate("return document.activeElement && document.activeElement.id;") as? String, "participant", "칸에 초점이 있다")
        if keyboardShown {
            XCTAssertLessThanOrEqual(field.frame.maxY, keyboard.frame.minY + 1, "칸이 자판에 가리지 않는다")
        }
        handle.capture("진행자-자판", theme: "light")
        recordMetric(["kind": "keyboard", "keyboardShown": keyboardShown, "fieldMaxY": field.frame.maxY, "keyboardMinY": keyboardShown ? keyboard.frame.minY : -1])
    }
}

/// Release 구성으로 켜기(verify.sh 가 Release 로 빌드해 돌린다). 진행자용 화면이 없고, DEBUG 실행 인자가 아무 일도 하지 않는다.
@MainActor
final class ReleaseSmokeTests: XCTestCase {
    func testReleaseBuildRunsWithoutTesterScreensOrDebugHooks() throws {
        guard ProcessInfo.processInfo.environment["SA_CONFIG"] == "Release" else {
            throw XCTSkip("Release 구성으로 빌드했을 때만 돈다(verify.sh)")
        }
        continueAfterFailure = false
        let handle = AppHandle(name: "release")
        // Release 에는 DEBUG 장치가 없으므로 아래 인자는 모두 무시돼야 한다.
        handle.launch(seed: "unreadable", extra: ["-SAProbe", "state", "-SAForceLoadFailure"])
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20), "불러오기 실패 인자를 무시하고 시작 화면이 뜬다")
        XCTAssertTrue(handle.any("가입 없이 써요. 기록은 이 기기에 저장하고 서버로 보내지 않아요.").exists, "앱 안에서만 쓰는 문구")
        handle.web.links.matching(handle.exact("기록")).firstMatch.tap()
        XCTAssertTrue(handle.any("앱을 지우면 기록도 함께 지워져요.").waitForExistence(timeout: 8), "기록 화면")
        XCTAssertFalse(handle.web.links.matching(handle.exact("테스트 진행자용")).firstMatch.exists, "진행자용 화면으로 가는 링크가 없다")
        XCTAssertFalse(handle.any("준비 중인 기능").exists, "준비 중인 기능 목록이 없다")
        Thread.sleep(forTimeInterval: 1.0)
        let probeFiles = (try? FileManager.default.contentsOfDirectory(atPath: handle.probeDirectory.path)) ?? []
        let storeFiles = (try? FileManager.default.contentsOfDirectory(atPath: handle.storeDirectory.path)) ?? []
        XCTAssertEqual(probeFiles, [], "탐침이 없다")
        XCTAssertEqual(storeFiles, [], "기록 위치 바꾸기와 기록 심기가 없다")
        handle.capture("release-기록", theme: "light")
    }
}
