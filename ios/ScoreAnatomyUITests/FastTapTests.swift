import XCTest

/// 결정기록 7.6(작업 지시서 3-2의 3-4): 웹에서 고친 빠진 누름 채우기를 아이폰 웹뷰에서 확인한다.
///
/// - 아주 빠른 두 번 누름은 XCUITest 의 doubleTap 이다(손을 떼고 0ms 만에 다시 누른다. 누름 시작 사이 66ms 안팎).
/// - 간격을 둔 두 번 누름은 TouchSynth 로 누름을 따로 보낸다. 이 Xcode 에서는 누름 시작 사이를 0.28초쯤보다 짧게 만들 수
///   없어서(TouchSynth 의 설명), 0.1초와 0.2초는 만들지 못하고 실제로 낸 간격을 웹이 받은 이벤트로 재서 적는다.
/// - 경우마다 웹이 받은 이벤트 열(-SAEventLog)을 metrics.jsonl 에 kind "fasttap" 으로 남긴다(verify.sh 가 문서에 옮긴다).
/// - 기대 결과는 웹 e2e(e2e/fill.spec.ts)의 "진짜 click 이 다 온 경우"의 끝 상태와 같다.
@MainActor
final class FastTapTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// 기록을 넣고 화면을 연 뒤, 그때까지의 이벤트 기록을 비운다.
    private func start(_ name: String, answers: [Int: Int], marks: [Int: String] = [:], gradedAt: String? = nil, path: String, route: String) -> AppHandle {
        let handle = AppHandle(name: name)
        handle.seedSession(answers: answers, marks: marks, gradedAt: gradedAt)
        handle.launch(extra: ["-SAEventLog"])
        handle.open(path, route: route)
        _ = handle.takeEvents()
        return handle
    }

    private func record(_ name: String, _ events: TapEvents, result: String, extra: [String: Any] = [:]) {
        var row: [String: Any] = ["kind": "fasttap", "case": name, "device": TestEnv.deviceTag, "os": UIDevice.current.systemVersion, "result": result]
        row.merge(events.summary) { a, _ in a }
        row.merge(extra) { _, b in b }
        recordMetric(row)
    }

    private func answers(_ upTo: Int) -> [Int: Int] { ExampleA.answers.filter { $0.key <= upTo } }

    private func sortedAnswers(_ handle: AppHandle) -> String {
        handle.answerMap().sorted { $0.key < $1.key }.map { "\($0.key):\($0.value)" }.joined(separator: " ")
    }

    // MARK: 1. 아주 빠른 두 번 누름(doubleTap)

    func testDoubleTapMarkCellBecomesGuess() throws {
        let handle = start("fast-marks", answers: ExampleA.answers, path: "/marks", route: "/marks")
        let cell = handle.markCell(3)
        XCTAssertTrue(cell.waitForExistence(timeout: 5))
        XCTAssertTrue(cell.label.hasSuffix("표시 없음"), cell.label)
        cell.doubleTap()
        XCTAssertTrue(handle.waitLabel(cell, contains: "찍음"), "아주 빠르게 두 번 누르면 찍음이 된다: \(cell.label)")
        Thread.sleep(forTimeInterval: 0.8)
        let events = handle.takeEvents()
        XCTAssertEqual(handle.markedCells(), ["3": "guess"], "3번만 찍음")
        XCTAssertEqual(handle.noticeCount(), 0, "버린 누름 알림이 없다")
        XCTAssertTrue(handle.waitForStore { _ in handle.storedMarks() == ["3": "guess"] }, "기록에도 3번 찍음 하나만: \(handle.storedMarks())")
        record("표시 칸(5지선다)", events, result: cell.label)
    }

    func testDoubleTapAnswerKeyFillsTwoItemsInSameGroup() throws {
        let handle = start("fast-key-group", answers: [:], path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(1).waitForExistence(timeout: 5), "1번부터")
        handle.key("3").doubleTap()
        XCTAssertTrue(handle.nowNumber(3).waitForExistence(timeout: 3), "지금 칸이 3번")
        Thread.sleep(forTimeInterval: 0.8)
        let events = handle.takeEvents()
        XCTAssertTrue(handle.waitForStore { _ in handle.answerMap() == [1: 3, 2: 3] }, "1번과 2번에 3: \(sortedAnswers(handle))")
        XCTAssertEqual(handle.noticeCount(), 0)
        record("답 키(같은 묶음의 이어진 빈 두 문항)", events, result: "지금 칸 3번, 답 \(sortedAnswers(handle))")
    }

    func testDoubleTapAnswerKeyCrossesToNextGroup() throws {
        let handle = start("fast-key-next", answers: answers(4), path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(5).waitForExistence(timeout: 5), "5번부터(5번은 첫 묶음의 끝)")
        handle.key("2").doubleTap()
        XCTAssertTrue(handle.nowNumber(7).waitForExistence(timeout: 3), "지금 칸이 7번")
        Thread.sleep(forTimeInterval: 0.8)
        let events = handle.takeEvents()
        XCTAssertTrue(handle.waitForStore { _ in let a = handle.answerMap(); return a[5] == 2 && a[6] == 2 && a.count == 6 }, "5번과 6번에 2: \(sortedAnswers(handle))")
        record("답 키(다음 문항이 다음 묶음)", events, result: "지금 칸 7번, 5번 \(handle.answerMap()[5] ?? -1), 6번 \(handle.answerMap()[6] ?? -1)")
    }

    func testDoubleTapAnswerKeyOnLastItemGoesToReviewWithoutPressing() throws {
        var seed = ExampleA.answers
        seed[21] = nil
        let handle = start("fast-key-last", answers: seed, path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(21).waitForExistence(timeout: 5), "남은 빈칸은 21번 하나")
        handle.key("4").doubleTap()
        handle.waitForRoute("/review")
        Thread.sleep(forTimeInterval: 0.8)
        let events = handle.takeEvents()
        XCTAssertEqual(handle.route(), "/review", "입력 확인에 머문다(넘어간 화면의 버튼이 눌리지 않았다)")
        XCTAssertEqual(handle.modalCount(), 0, "입력 확인의 칸이 눌려 시트가 열리지 않았다")
        XCTAssertTrue(handle.waitForStore { _ in handle.answerMap()[21] == 4 }, "21번에 4")
        record("답 키(마지막 문항)", events, result: "화면 \(handle.route() ?? "?"), 열린 시트 \(handle.modalCount()), 21번 \(handle.answerMap()[21] ?? -1), 알림 \(handle.noticeCount())")
    }

    func testDoubleTapShortAnswerDigitEntersTwoDigits() throws {
        let handle = start("fast-short", answers: answers(21), path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(22).waitForExistence(timeout: 5), "22번(단답형)")
        handle.key("7").doubleTap()
        Thread.sleep(forTimeInterval: 0.8)
        let events = handle.takeEvents()
        let entry = handle.domText("[data-testid=entry]") ?? ""
        XCTAssertTrue(entry.contains("77"), "두 자리 77 이 들어간다: \(entry)")
        record("단답형 숫자 키", events, result: "넣는 중인 답 \(entry)")
    }

    func testDoubleTapGradeButtonGradesOnce() throws {
        let handle = start("fast-grade", answers: ExampleA.answers, path: "/marks", route: "/marks")
        let grade = handle.button("없어요, 채점하기")
        handle.reveal(grade)
        XCTAssertTrue(grade.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        _ = handle.takeEvents()
        grade.doubleTap()
        handle.waitForRoute("/score")
        Thread.sleep(forTimeInterval: 1.0)
        let events = handle.takeEvents()
        XCTAssertEqual(handle.route(), "/score", "점수 화면에 머문다(넘어간 화면의 요소가 눌리지 않았다)")
        XCTAssertTrue(handle.waitForStore { (($0["sessions"] as? [[String: Any]])?.first?["gradedAt"] as? String) != nil }, "채점했다")
        XCTAssertEqual(handle.modalCount(), 0)
        record("채점 버튼", events, result: "화면 \(handle.route() ?? "?"), 알림 \(handle.noticeCount())")
    }

    func testDoubleTapSheetOpenAndCloseButtons() throws {
        let handle = start("fast-sheet", answers: ExampleA.answers, path: "/review", route: "/review")
        let cell = handle.reviewCell(2)
        XCTAssertTrue(cell.waitForExistence(timeout: 5), "입력 확인의 2번 칸")
        cell.doubleTap()
        Thread.sleep(forTimeInterval: 0.8)
        let openEvents = handle.takeEvents()
        XCTAssertEqual(handle.modalCount(), 1, "시트가 열려 있다(둘째 누름이 시트를 닫지 않았다)")
        record("바텀시트를 여는 버튼(입력 확인의 칸)", openEvents, result: "열린 시트 \(handle.modalCount()), 알림 \(handle.noticeCount())")

        let close = handle.web.buttons.matching(handle.exact("닫기")).firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 5), "시트의 닫기 버튼")
        Thread.sleep(forTimeInterval: 0.6)
        close.doubleTap()
        Thread.sleep(forTimeInterval: 0.8)
        let closeEvents = handle.takeEvents()
        XCTAssertEqual(handle.modalCount(), 0, "시트가 닫히고 다시 열리지 않았다")
        XCTAssertEqual(handle.route(), "/review")
        record("바텀시트를 닫는 버튼", closeEvents, result: "열린 시트 \(handle.modalCount()), 화면 \(handle.route() ?? "?")")
    }

    func testTripleTapMarkCellReturnsToNone() throws {
        let handle = start("fast-triple", answers: ExampleA.answers, path: "/marks", route: "/marks")
        let cell = handle.markCell(3)
        XCTAssertTrue(cell.waitForExistence(timeout: 5))
        cell.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        Thread.sleep(forTimeInterval: 0.9)
        let events = handle.takeEvents()
        XCTAssertEqual(handle.markOf(3), "none", "세 번 누르면 표시 없음으로 돌아온다: \(cell.label)")
        XCTAssertEqual(handle.markedCells(), [:])
        record("세 번 빠르게 누름(표시 칸)", events, result: cell.label)
    }

    func testTapThenFastDoubleTapWithinASecondFillsThreeItems() throws {
        let handle = start("fast-one-then-two", answers: [:], path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(1).waitForExistence(timeout: 5))
        let key = handle.key("3")
        try TouchSynth.tap(at: center(key))
        Thread.sleep(forTimeInterval: 0.3)
        key.doubleTap()
        XCTAssertTrue(handle.nowNumber(4).waitForExistence(timeout: 3), "지금 칸이 4번")
        Thread.sleep(forTimeInterval: 0.8)
        let events = handle.takeEvents()
        XCTAssertTrue(handle.waitForStore { _ in handle.answerMap() == [1: 3, 2: 3, 3: 3] }, "세 문항에 3: \(sortedAnswers(handle))")
        record("한 번 누른 뒤 1초 안에 아주 빠르게 두 번(같은 답 키)", events, result: "답 \(sortedAnswers(handle))")
    }

    func testNeighborKeysInQuickSuccessionEnterOnceEach() throws {
        let handle = start("fast-neighbors", answers: [:], path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(1).waitForExistence(timeout: 5))
        // 키마다 기록을 따로 보낸다(누름 시작 사이 0.28~0.30초). 한 기록에 넣으면 누름 사이 틈이 0ms 라 WebKit 이 첫 click 하나만 만들었다.
        let p3 = center(handle.key("3")), p4 = center(handle.key("4")), p5 = center(handle.key("5"))
        try TouchSynth.tap(at: p3)
        try TouchSynth.tap(at: p4)
        try TouchSynth.tap(at: p5)
        Thread.sleep(forTimeInterval: 1.0)
        let events = handle.takeEvents()
        record("옆 키를 빠르게 이어 누름(3, 4, 5)", events, result: "답 \(sortedAnswers(handle))")
        XCTAssertTrue(handle.nowNumber(4).waitForExistence(timeout: 3), "지금 칸이 4번: \(events.sequence)")
        XCTAssertTrue(handle.waitForStore { _ in handle.answerMap() == [1: 3, 2: 4, 3: 5] }, "3, 4, 5 가 한 번씩: \(sortedAnswers(handle))")
        XCTAssertEqual(events.madeClicks, [], "채우지 않는다")
    }

    /// 채우지 않아야 하는 누름: 앞 누름 뒤에 곧 짧게 누른다. 앞 누름이 빠진 누름으로 세어지면 click 하나가 더 들어간다.
    /// 뒤 누름은 기록을 따로 보내서 손뗌에서 0.2초 남짓 뒤에 온다(한 기록에 넣으면 틈이 0ms 라 WebKit 이 click 을 만들지 않았다).
    private func assertNoFillAfter(_ name: String, first: TouchSynth.Stroke, file: StaticString = #filePath, line: UInt = #line) throws {
        let handle = start("nofill-\(name)", answers: [:], path: "/input?input=keypad", route: "/input")
        XCTAssertTrue(handle.nowNumber(1).waitForExistence(timeout: 5), file: file, line: line)
        let key = center(handle.key("1"))
        var stroke = first
        stroke.point = key
        stroke.moves = first.moves.map { (CGPoint(x: key.x + $0.0.x, y: key.y + $0.0.y), $0.1) }
        try TouchSynth.burst([stroke])
        try TouchSynth.tap(at: key)
        Thread.sleep(forTimeInterval: 0.9)
        let events = handle.takeEvents()
        let entered = handle.answerMap().count
        XCTAssertEqual(events.madeClicks, [], "\(name): 채우지 않는다(\(events.sequence))", file: file, line: line)
        XCTAssertEqual(entered, events.realClicks.filter { $0 > 0 }.count, "\(name): 들어간 답의 수가 손가락에서 온 click 의 수와 같다", file: file, line: line)
        record(name, events, result: "답 \(sortedAnswers(handle))")
    }

    func testLongPressThenTapIsNotFilled() throws {
        try assertNoFillAfter("길게 누른 뒤 곧 다시 누름", first: .init(.zero, hold: 0.7))
    }

    func testDragReleasedInPlaceThenTapIsNotFilled() throws {
        // 누른 채 위로 40pt 밀었다가 제자리로 돌아와 뗀다(16px 넘게 움직인 누름은 세지 않는다).
        try assertNoFillAfter("끌다가 제자리에서 뗀 뒤 다시 누름", first: .init(.zero, hold: 0.3, moves: [(CGPoint(x: 0, y: -40), 0.1), (CGPoint(x: 0, y: 0), 0.2)]))
    }

    // MARK: 6. 채점한 기록의 표시 화면에서 처음 바꾸는 표시(결정기록 7.7)

    /// 표시 없이 채점한 뒤 "입력 고치기"로 돌아와 표시 화면을 다시 연다(웹 e2e/rhythm.spec.ts 와 같은 길).
    private func openGradedMarks(_ name: String) -> AppHandle {
        let handle = start(name, answers: ExampleA.answers, path: "/marks", route: "/marks")
        let grade = handle.button("없어요, 채점하기")
        handle.reveal(grade)
        grade.tap()
        handle.waitForRoute("/score")
        let fix = handle.button("입력 고치기")
        handle.reveal(fix, label: "입력 고치기")
        XCTAssertTrue(fix.waitForExistence(timeout: 5), "점수 화면의 입력 고치기")
        fix.tap()
        handle.waitForRoute("/review")
        let next = handle.button("맞아요, 다음으로")
        handle.reveal(next)
        next.tap()
        handle.waitForRoute("/marks")
        Thread.sleep(forTimeInterval: 0.7)
        return handle
    }

    private func cellFrames(_ handle: AppHandle) -> [String] {
        (1...21).map { no in
            let f = handle.markCell(no).frame
            return "\(no) \(Int(f.minX)) \(Int(f.minY)) \(Int(f.width)) \(Int(f.height))"
        }
    }

    private func gradedFirstMark(_ name: String, cell no: Int, tapTwice: (CGPoint) throws -> Void) throws {
        let handle = openGradedMarks(name)
        XCTAssertFalse(handle.any("채점한 뒤에 표시한 기록이에요").exists, "아직 표시를 바꾸지 않아서 안내 줄은 보이지 않는다")
        let before = cellFrames(handle)
        let frame = handle.markCell(no).frame
        let at = CGPoint(x: frame.midX, y: frame.minY + 10)
        handle.capture("\(name)-전", theme: "light")
        _ = handle.takeEvents()
        try tapTwice(at)
        Thread.sleep(forTimeInterval: 0.9)
        let events = handle.takeEvents()
        XCTAssertEqual(handle.markedCells(), ["\(no)": "guess"], "\(no)번만 찍음")
        XCTAssertTrue(handle.any("채점한 뒤에 표시한 기록이에요").waitForExistence(timeout: 3), "안내 줄이 보인다")
        XCTAssertEqual(handle.noticeCount(), 0, "버린 누름 알림이 없다")
        let after = cellFrames(handle)
        XCTAssertEqual(after, before, "칸 격자의 자리가 누르기 전과 같다")
        // 이 테스트가 보려는 상황인지: 격자가 안내 줄(위 여백 포함)만큼 내려갔다면 둘째 누름은 윗줄 칸에 닿았을 자리다.
        let check = handle.evaluate("""
        const n = document.querySelector('[data-testid="after-grading-note"]');
        const space = n ? n.getBoundingClientRect().height + parseFloat(getComputedStyle(n).marginTop) : 0;
        const up = document.querySelector('[data-mark-cell="\(no - 5)"]').getBoundingClientRect();
        return { space, upTop: up.top, upBottom: up.bottom };
        """) as? [String: Any] ?? [:]
        let space = check["space"] as? Double ?? 0
        let shifted = Double(at.y) - space
        XCTAssertGreaterThan(space, 0)
        XCTAssertTrue(shifted > (check["upTop"] as? Double ?? 0) && shifted < (check["upBottom"] as? Double ?? 0), "누른 자리를 안내 줄 높이만큼 올리면 \(no - 5)번 칸 안이다: \(check), y \(at.y)")
        handle.capture("\(name)-후", theme: "light")
        record("채점한 기록에서 처음 바꾸는 표시 칸의 위쪽(\(name))", events, result: "표시 \(handle.markedCells()), 1번 칸 \(before[0]) -> \(after[0]), 안내 줄 높이 \(space)")
    }

    func testGradedRecordFirstMarkFastDoubleTapOnTopEdge() throws {
        try gradedFirstMark("채점한기록-아주빠르게", cell: 9) { at in
            XCUIApplication().coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: at.x, dy: at.y)).doubleTap()
        }
    }

    func testGradedRecordFirstMarkSpacedDoubleTapOnTopEdge() throws {
        // 0.2초는 만들 수 없어서(TouchSynth) 따로 보낸 누름의 가장 짧은 간격(0.28~0.30초)으로 누른다. 진짜 click 이 다 오는 경우다.
        try gradedFirstMark("채점한기록-따로누름", cell: 8) { at in
            try TouchSynth.spacedTaps(at: at, interval: 0)
        }
    }

    // MARK: 7. 간격을 바꿔 가며 두 번 누름(측정 중)

    func testIntervalsWhileMeasuring() throws {
        let handle = AppHandle(name: "fast-measure")
        handle.launch(extra: ["-SAEventLog"])
        handle.open("/test", route: "/test")
        let field = handle.web.textFields.matching(NSPredicate(format: "label BEGINSWITH %@", "참가자 코드")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8), "참가자 코드 칸")
        field.tap()
        field.typeText("P01")
        _ = handle.evaluate("document.activeElement && document.activeElement.blur(); return true;")
        Thread.sleep(forTimeInterval: 0.8)
        let startRun = handle.button("테스트 시작하기")
        XCTAssertTrue(startRun.waitForExistence(timeout: 5))
        startRun.tap()
        handle.waitForRoute("/")
        handle.startExampleA()
        XCTAssertEqual(handle.runCounts()?.filled, 0, "측정을 시작했다(채운 누름 0)")

        // 측정 중 답 키를 아주 빠르게 두 번: 채운 누름이 1 늘어난다.
        Thread.sleep(forTimeInterval: 0.6)
        _ = handle.takeEvents()
        handle.key("3").doubleTap()
        XCTAssertTrue(handle.nowNumber(3).waitForExistence(timeout: 3))
        let afterKey = handle.waitRunCounts { $0.filled == 1 }
        let keyEvents = handle.takeEvents()
        record("측정 중 답 키 아주 빠르게(doubleTap)", keyEvents, result: "채운 누름 \(afterKey?.filled ?? -1), 버린 누름 \(afterKey?.discarded ?? -1), 답 \(sortedAnswers(handle))",
               extra: ["measure": true, "target": "아주 빠르게", "filledDelta": afterKey?.filled ?? -1, "discardedDelta": afterKey?.discarded ?? -1])
        XCTAssertEqual(afterKey?.filled, 1, "답 키의 아주 빠른 두 번 누름에서 채운 누름 1: \(keyEvents.sequence), 기록 \(handle.storeJSON().map { String(describing: $0["testRuns"] ?? "") } ?? "")")

        // 나머지 답을 넣고 표시 화면으로 간다.
        handle.enterAnswers(from: 3, to: 30)
        XCTAssertTrue(handle.any("넣은 답을 확인해 주세요").waitForExistence(timeout: 8))
        let next = handle.button("맞아요, 다음으로")
        handle.reveal(next)
        next.tap()
        XCTAssertTrue(handle.markCell(1).waitForExistence(timeout: 8), "표시 화면")
        Thread.sleep(forTimeInterval: 0.7)

        // 간격별: 아주 빠르게(doubleTap), 따로 보낸 누름의 가장 짧은 간격(0.3초 쪽), 0.4초, 0.5초. 0.1초와 0.2초는 만들 수 없음.
        let cases: [(name: String, target: String, cell: Int)] = [
            ("아주 빠르게(doubleTap)", "아주 빠르게", 1),
            ("따로 보낸 누름, 가장 짧게", "0.3초", 2),
            ("따로 보낸 누름, 0.4초", "0.4초", 3),
            ("따로 보낸 누름, 0.5초", "0.5초", 4),
        ]
        var total = afterKey?.filled ?? 0
        for c in cases {
            let cell = handle.markCell(c.cell)
            handle.reveal(cell)
            XCTAssertTrue(cell.label.hasSuffix("표시 없음"), cell.label)
            let before = handle.runCounts() ?? (-1, -1)
            _ = handle.takeEvents()
            switch c.target {
            case "아주 빠르게": cell.doubleTap()
            case "0.3초": try TouchSynth.spacedTaps(at: center(cell), interval: 0)
            case "0.4초": try TouchSynth.spacedTaps(at: center(cell), interval: 0.4)
            default: try TouchSynth.spacedTaps(at: center(cell), interval: 0.5)
            }
            Thread.sleep(forTimeInterval: 1.0)
            let events = handle.takeEvents()
            let after = handle.waitRunCounts(timeout: 1.5) { $0.filled >= before.filled } ?? (-1, -1)
            let filled = after.filled - before.filled
            total = after.filled
            record("측정 중 표시 칸 \(c.name)", events, result: cell.label,
                   extra: ["measure": true, "target": c.target, "filledDelta": filled, "discardedDelta": after.discarded - before.discarded])
            XCTAssertTrue(cell.label.hasSuffix("찍음"), "\(c.name): 찍음이 된다: \(cell.label), \(events.sequence)")
            if c.target == "아주 빠르게" { XCTAssertEqual(filled, 1, "아주 빠른 두 번 누름에서 채운 누름 1") }
            if c.target == "0.4초" || c.target == "0.5초" { XCTAssertEqual(filled, 0, "\(c.target) 간격에서는 채운 누름이 늘지 않는다") }
        }
        for target in ["0.1초", "0.2초"] {
            recordMetric(["kind": "fasttap", "case": "측정 중 표시 칸 \(target)", "device": TestEnv.deviceTag, "os": UIDevice.current.systemVersion, "measure": true, "target": target,
                          "result": "만들 수 없음", "reason": "이 Xcode 의 누름 만들기 장치로는 누름 시작 사이를 0.07초 남짓과 0.28초 사이로 만들 수 없음"])
        }

        // 진행자용 화면의 측정 카드에서 "채운 누름"을 읽는다.
        handle.open("/test", route: "/test")
        let shown = handle.domText("[data-testid=\"run-card\"][data-participant=\"P01\"] [data-testid=\"m-filled\"]")
        XCTAssertEqual(shown, "\(total)번", "측정 카드의 채운 누름")
        XCTAssertTrue(handle.element(labelContains: "채운 누름").exists, "측정 카드에 '채운 누름'이 보인다")
        handle.capture("측정카드", theme: "light")
        recordMetric(["kind": "fasttap-card", "device": TestEnv.deviceTag, "os": UIDevice.current.systemVersion, "filledShown": shown ?? "", "filledStored": total])
    }
}
