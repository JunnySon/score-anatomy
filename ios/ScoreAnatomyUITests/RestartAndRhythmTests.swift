import XCTest

/// 6-4 다시 켜기: 넣던 답과 채점한 기록이 앱을 끝냈다 켠 뒤에도 남는다.
@MainActor
final class RestartTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func answerCount(_ json: [String: Any]) -> Int {
        ((json["sessions"] as? [[String: Any]])?.first?["answers"] as? [String: Any])?.count ?? 0
    }

    func testResumeAfterRestartKeepsTwelveAnswers() throws {
        let handle = AppHandle(name: "restart-12")
        handle.launch()
        handle.startExampleA()
        handle.enterAnswers(from: 1, to: 11)
        XCTAssertTrue(handle.nowNumber(12).waitForExistence(timeout: 5))
        // 12번째 답 키 누름이 끝난 때부터(XCUITest 의 누름은 앱이 쉴 때까지 기다린 뒤 돌아온다) 파일에 보이기까지 잰다.
        handle.tapKey("\(ExampleA.answers[12]!)")
        let tapped = Date()
        XCTAssertTrue(handle.waitForStore { self.answerCount($0) == 12 }, "12번까지 store.json 에 저장된다")
        let landed = Date().timeIntervalSince(tapped)
        XCTAssertTrue(handle.nowNumber(13).waitForExistence(timeout: 5))

        handle.terminate()
        handle.launch()
        let resume = handle.button("이어서 보기")
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "시작 화면에 '이어서 보기'")
        resume.tap()
        XCTAssertTrue(handle.nowNumber(13).waitForExistence(timeout: 8), "13번부터 이어서 넣는다")
        XCTAssertTrue(handle.any("12문항 입력").exists, "12문항 입력")
        for no in 11...12 {
            XCTAssertEqual(handle.inputCell(no).label, "\(no)번 칸, 넣은 답 \(ExampleA.answers[no]!)")
        }
        let stored = handle.storedAnswers()
        for no in 1...12 { XCTAssertEqual(stored[no] as? Int, ExampleA.answers[no]) }
        XCTAssertNil(stored[13])
        recordMetric(["kind": "restart", "case": "resume12", "secondsUntilSaved": landed])
    }

    func testGradedRecordSurvivesRestart() throws {
        let handle = AppHandle(name: "restart-graded")
        handle.launch()
        handle.goToMarksWithExampleAnswers()
        let grade = handle.button("없어요, 채점하기")
        handle.reveal(grade)
        grade.tap()
        XCTAssertTrue(handle.staticText("78점").waitForExistence(timeout: 8))
        XCTAssertTrue(handle.waitForStore { (($0["sessions"] as? [[String: Any]])?.first?["gradedAt"] as? String) != nil }, "채점 기록이 저장된다")

        handle.terminate()
        handle.launch()
        handle.web.links.matching(handle.exact("기록")).firstMatch.tap()
        let item = handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "예시 시험 A 기록 열기")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 8), "기록 화면에 예시 시험 A")
        XCTAssertTrue(item.label.contains("78점"), "기록에 78점: \(item.label)")
    }
}

/// 6-5 사람 손 박자: 기다리지 않고 좌표를 정해진 간격으로 직접 누른다. 작업 지시서 3-2: 웹이 빠진 누름 채우기를 더한 뒤에도
/// 그대로 통과하고, 이 박자(0.4초 안팎)에서는 채운 누름이 하나도 없어야 한다(누름이 세 번 들어가지 않는다). -SAEventLog 로 본다.
@MainActor
final class RhythmTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func noticeCount(_ handle: AppHandle) -> Int {
        (handle.evaluate("return document.querySelectorAll('.tap-notice').length;") as? Int) ?? -1
    }

    func testDoubleTapOnMarkCellMakesGuess() throws {
        let handle = AppHandle(name: "rhythm-marks")
        handle.launch(extra: ["-SAEventLog"])
        handle.goToMarksWithExampleAnswers()
        XCTAssertTrue(handle.button("없어요, 채점하기").exists, "표시가 0개일 때의 채점 버튼")
        // 칸마다 손가락 이벤트와 click 이 웹에 언제 오는지 기록해 둔다(근거로 남긴다).
        _ = handle.evaluate("""
        window.__saEvents = [];
        for (const no of [9, 14, 20]) {
          const cell = document.querySelector('[data-mark-cell="' + no + '"]');
          for (const t of ['touchstart', 'touchend', 'click', 'dblclick']) {
            cell.addEventListener(t, (e) => window.__saEvents.push({ no, t, at: performance.now(), detail: e.detail || 0 }), true);
          }
        }
        return true;
        """)
        // 화면이 막 바뀐 직후의 보호가 끝난 뒤에 시작한다.
        Thread.sleep(forTimeInterval: 0.7)
        var allGaps: [TimeInterval] = []
        for no in [9, 14] {
            let cell = handle.markCell(no)
            handle.reveal(cell)
            let point = center(cell)
            let gaps = tapRhythm(handle.app, points: [point, point], gap: 0.2)
            allGaps += gaps
            XCTAssertTrue(handle.waitLabel(cell, contains: "찍음"), "\(no)번을 이어서 두 번 누르면 찍음: \(cell.label)")
        }
        XCTAssertTrue(handle.button("채점하기").exists, "표시를 붙이면 '채점하기'")
        XCTAssertEqual(noticeCount(handle), 0, "버린 누름 알림이 없다")
        XCTAssertLessThan(allGaps.max() ?? 9, 0.5, "실제 간격이 보호 시간(0.5초)보다 짧아야 의미가 있다: \(allGaps)")
        let rhythmEvents = handle.takeEvents()
        XCTAssertEqual(rhythmEvents.madeClicks, [], "사람 손 박자에서는 채운 누름이 없다(누름이 세 번 들어가지 않는다): \(rhythmEvents.sequence)")

        // 근거: 첫 click 은 손을 뗀 뒤 곧바로 온다. 그보다 늦게 다시 누르면 두 번 모두 click 으로 들어간다.
        let events = handle.evaluate("return window.__saEvents;") as? [[String: Any]] ?? []
        let nine = events.filter { ($0["no"] as? Int) == 9 }
        let firstEnd = nine.first { ($0["t"] as? String) == "touchend" }?["at"] as? Double ?? 0
        let clicks = nine.filter { ($0["t"] as? String) == "click" }
        let firstClick = clicks.first?["at"] as? Double ?? 0
        XCTAssertEqual(clicks.count, 2, "두 번 누름이 click 두 번으로 들어왔다: \(nine)")
        XCTAssertLessThan(firstClick - firstEnd, 50, "첫 click 이 손을 뗀 뒤 곧바로 왔다(ms)")

        // 참고: XCUITest 의 doubleTap 은 손을 떼고 2ms 쯤 만에 다시 누른다(사람보다 훨씬 빠름).
        // 이때 WebKit 은 첫 click 을 내지 않고 click 한 번(detail 2)과 dblclick 만 낸다. 판정에 넣지 않고 기록만 한다.
        let cell20 = handle.markCell(20)
        handle.reveal(cell20)
        Thread.sleep(forTimeInterval: 0.7)
        cell20.doubleTap()
        Thread.sleep(forTimeInterval: 1.0)
        let after = handle.evaluate("return window.__saEvents.filter((e) => e.no === 20).map((e) => e.t + ':' + e.detail);") as? [String] ?? []
        XCTAssertTrue(cell20.label.hasSuffix("찍음"), "아주 빠른 두 번 누름(doubleTap)도 찍음이 된다(웹의 빠진 누름 채우기): \(cell20.label)")
        recordMetric(["kind": "rhythm", "case": "marks-double", "gaps": allGaps, "firstClickAfterTouchEndMs": firstClick - firstEnd,
                      "fastDoubleTapLabel": cell20.label, "fastDoubleTapEvents": after, "madeClicks": rhythmEvents.madeClicks, "realClicks": rhythmEvents.realClicks])
    }

    func testKeysAfterFixingNineAreNotEntered() throws {
        let handle = AppHandle(name: "rhythm-lock")
        handle.launch(extra: ["-SAEventLog"])
        handle.startExampleA()
        handle.enterAnswers(from: 1, to: 11)
        XCTAssertTrue(handle.nowNumber(12).waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.7)
        let key = { (label: String) in center(handle.keypad.buttons.matching(handle.exact(label)).firstMatch) }
        let keys = [key("2"), key("4"), key("1"), key("5"), key("안 풂")]
        // 9번 칸을 눌러 고치고, 화면을 보지 않고 12, 13, 14번에 넣으려던 답 키를 0.3초 간격으로 이어 누른다.
        _ = tapRhythm(handle.app, points: [center(handle.inputCell(9))], gap: 0)
        XCTAssertTrue(handle.nowNumber(9).waitForExistence(timeout: 3), "9번을 고치는 중")
        _ = handle.takeEvents()
        let gaps = tapRhythm(handle.app, points: keys, gap: 0.3)
        handle.waitForText("9번에 답을 넣었어요. 다음에 할 일을 골라 주세요.")
        let lockEvents = handle.takeEvents()
        XCTAssertEqual(lockEvents.madeClicks, [], "채운 누름이 없다: \(lockEvents.sequence)")
        XCTAssertTrue(handle.nowNumber(9).exists, "잠긴 채 9번에 머문다")
        XCTAssertTrue(handle.any("11문항 입력").exists)
        Thread.sleep(forTimeInterval: 0.5)
        let stored = handle.storedAnswers()
        XCTAssertEqual(stored[9] as? Int, 2, "9번은 고친 답 2")
        XCTAssertEqual(stored[10] as? Int, ExampleA.answers[10])
        XCTAssertEqual(stored[11] as? Int, ExampleA.answers[11])
        for no in 12...14 { XCTAssertNil(stored[no], "\(no)번에는 아무것도 들어가지 않는다") }
        XCTAssertEqual(noticeCount(handle), 0, "잠긴 키는 버린 누름이 아니라 알림이 없다")
        handle.button("12번부터 이어서 넣기").tap()
        XCTAssertTrue(handle.nowNumber(12).waitForExistence(timeout: 3))
        XCTAssertLessThan(gaps.max() ?? 9, 0.6, "실제 간격: \(gaps)")
        recordMetric(["kind": "rhythm", "case": "lock", "gaps": gaps, "madeClicks": lockEvents.madeClicks, "realClicks": lockEvents.realClicks])
    }

    func testTapsAfterLastItemDoNotPressReviewButtons() throws {
        let handle = AppHandle(name: "rhythm-last")
        handle.launch(extra: ["-SAEventLog"])
        handle.startExampleA()
        handle.enterAnswers(from: 1, to: 29)
        XCTAssertTrue(handle.nowNumber(30).waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.7)
        let key = { (label: String) in center(handle.keypad.buttons.matching(handle.exact(label)).firstMatch) }
        let k2 = key("2"), k7 = key("7"), k5 = key("5"), go = key("다음"), erase = key("지우기"), skip = key("안 풂")
        // 30번(답 275)을 넣고 "다음", 그 박자로 키패드 자리를 몇 번 더 누른다.
        _ = handle.takeEvents()
        let gaps = tapRhythm(handle.app, points: [k2, k7, k5, go, go, erase, skip, go, k2], gap: 0.15)
        XCTAssertTrue(handle.any("넣은 답을 확인해 주세요").waitForExistence(timeout: 5), "입력 확인으로 넘어간다")
        Thread.sleep(forTimeInterval: 0.6)
        handle.waitForRoute("/review")
        let dialogs = handle.evaluate("return document.querySelectorAll('[role=\"dialog\"], [role=\"alertdialog\"]').length;") as? Int
        XCTAssertEqual(dialogs, 0, "입력 확인의 칸이 눌려 시트가 열리지 않았다")
        XCTAssertEqual(handle.storedAnswers()[30] as? Int, 275)
        let notices = noticeCount(handle)
        let lastEvents = handle.takeEvents()
        XCTAssertEqual(lastEvents.madeClicks, [], "채운 누름이 없다: \(lastEvents.sequence)")
        XCTAssertLessThan(gaps.max() ?? 9, 0.5, "실제 간격이 보호 시간보다 짧아야 의미가 있다: \(gaps)")
        recordMetric(["kind": "rhythm", "case": "last-item", "gaps": gaps, "notices": notices, "madeClicks": lastEvents.madeClicks, "realClicks": lastEvents.realClicks])
    }
}
