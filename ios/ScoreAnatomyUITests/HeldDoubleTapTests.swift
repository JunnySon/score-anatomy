import XCTest

/// 작업 지시서 4의 3-2와 부록 A 3-4: 손가락 click, 채움, 실제 요소에 들어간 입력을 시뮬레이터에서 잰다.
///
/// - 0.29초 안팎 두 번 누름(TouchSynth 로 따로 보낸 누름의 가장 짧은 간격)을 표시 칸, 답 키, 점수 해부의 같은 자리에서 되풀이한다.
/// - 경우마다 껍데기의 이벤트 기록(window.__saEventLog)과 웹의 판단 기록(window.__saTapTrace)을 같은 시계(performance.now)로 합쳐,
///   사라진 경우(둘째 누름의 손가락 click 이 오지 않음), 채운 경우(웹이 click 을 만들어 보냄), 두 번을 넘겨 들어간 경우를 센다.
/// - 사라진 경우와 채운 경우, 세 번 누름은 결정기록 7.8 의 형식으로 글자 파일을 남긴다(verify.sh 가 docs/ios_누름기록 에 옮긴다).
/// - 한 요소에서 누른 수를 넘긴 입력은 실패다. 입력 증거가 빠진 실행은 통과하지 않는다. 확대와 끝 상태 차이도 기록한다.
@MainActor
final class HeldDoubleTapTests: XCTestCase {
    /// 경우마다 되풀이하는 수(verify.sh 가 TEST_RUNNER_SA_HELD_REPEATS 로 바꿀 수 있다).
    static var repeats: Int {
        Int(ProcessInfo.processInfo.environment["SA_HELD_REPEATS"] ?? "") ?? 32
    }

    typealias Trial = TapTimeline.Trial

    private var os: String { TapTimeline.os }

    private func save(_ trials: [Trial], target: String, slug: String) {
        let gaps = trials.compactMap(\.pressGapMs)
        let lifts = trials.flatMap(\.liftToClick)
        recordMetric([
            "kind": "held", "device": TestEnv.deviceTag, "os": os, "target": target, "slug": slug, "trials": trials.count,
            "lost": trials.filter(\.lost).count, "dblclickWhileHeld": trials.filter(\.dblclickWhileHeld).count,
            "filled": trials.filter { $0.made > 0 }.count, "heldFilled": trials.filter { $0.heldFill > 0 }.count,
            "liftFilled": trials.filter { $0.liftFill > 0 }.count, "lostNotFilled": trials.filter { $0.lost && $0.made == 0 }.count,
            "zoom": trials.filter(\.zoomed).count, "wrongEnd": trials.filter { $0.wrongEnd == true }.count,
            "over": trials.filter(\.over).count, "discarded": trials.filter { $0.discard > 0 }.count,
            "lateDropped": trials.filter { $0.lateDrop > 0 }.count,
            "gapMin": gaps.min() ?? -1, "gapMax": gaps.max() ?? -1,
            "liftToClickMax": lifts.max() ?? -1, "liftToClickCount": lifts.count,
            "liftToClickOver20": lifts.filter { $0 > 20 }.count,
            "endStates": Dictionary(grouping: trials, by: \.endState).mapValues(\.count),
            "rows": trials.map { t -> [String: Any] in
                ["i": t.index, "kind": t.kind, "gap": t.pressGapMs ?? -1, "liftToClick": t.liftToClick, "presses": t.presses, "entered": t.entered,
                 "made": t.made, "held": t.heldFill, "lift": t.liftFill, "discard": t.discard, "late": t.lateDrop, "dblHeld": t.dblclickWhileHeld, "end": t.endState]
            },
        ])
    }

    /// 다음 시도에 들어가기 전에 별도 파일에 결과를 남겨 중단된 테스트의 초과 입력도 확인할 수 있게 한다.
    private func append(_ trial: Trial, slug: String, intended: String, to trials: inout [Trial]) throws {
        let folder = TestEnv.outDirectory.appendingPathComponent("held", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let basename = "\(TestEnv.deviceTag)-ios\(os)-\(slug)-\(String(format: "%02d", trial.index))"
        let file = folder.appendingPathComponent(basename + ".txt")
        try TapTimeline.timeline(trial, title: "\(slug) \(trial.index)번째").write(to: file, atomically: true, encoding: .utf8)
        recordMetric(["kind": "heldTrial", "slug": slug, "device": TestEnv.deviceTag, "os": os, "index": trial.index,
                      "presses": trial.presses, "observed": trial.events.filter { $0["type"] as? String == "observed-down" }.count,
                      "firstDownTarget": trial.firstDownTarget ?? "", "intended": intended,
                      "entered": trial.entered, "over": trial.over, "before": trial.scaleBefore ?? -1, "after": trial.scaleAfter ?? -1,
                      "pressedByElement": trial.pressedByElement, "enteredByElement": trial.enteredByElement, "file": file.lastPathComponent])
        trials.append(trial)
        XCTAssertEqual(trial.firstDownTarget, intended, "첫 pointerdown이 지정한 요소에 닿아야 한다: " + basename)
        if trial.over {
            throw NSError(domain: "HeldDoubleTapTests", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "누른 수보다 많이 들어감: " + basename])
        }
    }

    // MARK: 1. 표시 칸

    func testMarkCellSpacedDoubleTaps() throws {
        var trials: [Trial] = []
        let cells = Array(1...16)
        var handle: AppHandle?
        for index in 1...Self.repeats {
            let slot = (index - 1) % cells.count
            if slot == 0 {
                handle?.terminate()
                let fresh = AppHandle(name: "held-marks-\(index)")
                fresh.seedSession(answers: ExampleA.answers)
                fresh.launch(extra: ["-SAEventLog"])
                fresh.open("/marks", route: "/marks")
                handle = fresh
            }
            guard let handle else { break }
            let no = cells[slot]
            let cell = handle.markCell(no)
            handle.reveal(cell)
            XCTAssertTrue(cell.waitForExistence(timeout: 5))
            let point = center(cell)
            Thread.sleep(forTimeInterval: 0.6)
            TapTimeline.beginHeld(handle)
            try TouchSynth.spacedTaps(at: point, interval: 0)
            Thread.sleep(forTimeInterval: 1.4)
            let state = "\(no)번 칸 data-mark \(handle.markOf(no) ?? "?"), 버린 누름 알림 \(handle.noticeCount())"
            try append(TapTimeline.endHeld(handle, index: index, expected: 2, endState: state), slug: "marks", intended: "mark:\(no)", to: &trials)
        }
        handle?.terminate()
        save(trials, target: "표시 칸 0.29초 두 번", slug: "marks")
        XCTAssertEqual(trials.filter(\.over).map(\.index), [], "두 번을 넘겨 들어간 경우가 없어야 한다")
    }

    // MARK: 2. 답 키

    func testAnswerKeySpacedDoubleTaps() throws {
        var trials: [Trial] = []
        let perRound = 8
        var handle: AppHandle?
        for index in 1...Self.repeats {
            if (index - 1) % perRound == 0 {
                handle?.terminate()
                let fresh = AppHandle(name: "held-key-\(index)")
                fresh.seedSession(answers: [:])
                fresh.launch(extra: ["-SAEventLog"])
                fresh.open("/input?input=keypad", route: "/input")
                handle = fresh
            }
            guard let handle else { break }
            let before = handle.answerMap().count
            let key = handle.key("3")
            XCTAssertTrue(key.waitForExistence(timeout: 5))
            let point = center(key)
            Thread.sleep(forTimeInterval: 0.6)
            TapTimeline.beginHeld(handle)
            try TouchSynth.spacedTaps(at: point, interval: 0)
            Thread.sleep(forTimeInterval: 1.4)
            _ = handle.waitForStore(timeout: 1.5) { _ in handle.answerMap().count >= before + 1 }
            let added = handle.answerMap().count - before
            var trial = TapTimeline.endHeld(handle, index: index, expected: 2, endState: "답 키 3 으로 들어간 문항 \(added)개(모두 \(handle.answerMap().count)개), 버린 누름 알림 \(handle.noticeCount())")
            // 답 키는 들어간 문항 수가 곧 받아들인 누름 수다(기록 파일로 다시 본다).
            trial.entered = max(trial.entered, added)
            try append(trial, slug: "key", intended: "key:3", to: &trials)
        }
        handle?.terminate()
        save(trials, target: "답 키 0.29초 두 번", slug: "key")
        XCTAssertEqual(trials.filter(\.over).map(\.index), [], "두 번을 넘겨 들어간 경우가 없어야 한다")
    }

    // MARK: 3. 점수 해부의 같은 자리

    func testAnatomySameSpotSpacedDoubleTaps() throws {
        let handle = AppHandle(name: "held-anatomy")
        handle.seedSession(answers: ExampleA.answers)
        handle.launch(extra: ["-SAEventLog"])
        handle.open("/marks", route: "/marks")
        for no in ExampleA.guesses { handle.setGuess(no) }
        let grade = handle.button("채점하기")
        handle.reveal(grade)
        grade.tap()
        let direct = handle.button("점수 해부 바로 보기")
        XCTAssertTrue(direct.waitForExistence(timeout: 8), "점수 화면")
        direct.tap()
        handle.waitForRoute("/anatomy")
        Thread.sleep(forTimeInterval: 0.8)
        let checked = "return Array.from(document.querySelectorAll('[role=\"radio\"][aria-checked=\"true\"]')).map((e) => e.getAttribute('data-testid')).join(',') + ' 시트 ' + document.querySelectorAll('[aria-modal=\"true\"]').length;"
        var trials: [Trial] = []
        for index in 1...Self.repeats {
            // 2등급을 고르고 맨 위로 되돌린 뒤(1등급 첫 줄이 다 보이지 않는 자리) 1등급을 두 번 누른다.
            let chip2 = handle.any("2등급")
            XCTAssertTrue(chip2.waitForExistence(timeout: 5))
            chip2.tap()
            Thread.sleep(forTimeInterval: 1.2)
            _ = handle.evaluate("const b = document.querySelector('main.body') || document.querySelector('.body'); b.scrollTop = 0; return true;")
            Thread.sleep(forTimeInterval: 0.8)
            let chip1 = handle.any("1등급")
            XCTAssertTrue(chip1.waitForExistence(timeout: 5))
            let point = center(chip1)
            TapTimeline.beginHeld(handle)
            try TouchSynth.spacedTaps(at: point, interval: 0)
            Thread.sleep(forTimeInterval: 1.4)
            let state = "고른 칩 \(handle.evaluate(checked) as? String ?? "?"), 버린 누름 알림 \(handle.noticeCount()), 화면 \(handle.route() ?? "?")"
            try append(TapTimeline.endHeld(handle, index: index, expected: 2, endState: state), slug: "anatomy", intended: "grade:1", to: &trials)
        }
        handle.terminate()
        save(trials, target: "점수 해부 같은 자리 0.29초 두 번", slug: "anatomy")
        XCTAssertEqual(trials.filter(\.over).map(\.index), [], "두 번을 넘겨 들어간 경우가 없어야 한다")
    }

    // MARK: 4. 세 번 빠르게(결정기록 7.8 의 세 번 누름 건, 기록용)

    func testTripleTapsOnMarkCell() throws {
        let handle = AppHandle(name: "held-triple")
        handle.seedSession(answers: ExampleA.answers)
        handle.launch(extra: ["-SAEventLog"])
        handle.open("/marks", route: "/marks")
        var trials: [Trial] = []
        for index in 1...10 {
            let no = 3
            let cell = handle.markCell(no)
            XCTAssertTrue(cell.waitForExistence(timeout: 5))
            Thread.sleep(forTimeInterval: 0.8)
            if handle.markOf(no) != "none" {
                // 앞 경우가 다른 상태로 끝났으면 표시 없음이 될 때까지 천천히 누른다(그 누름은 기록하지 않는다).
                for _ in 0..<3 where handle.markOf(no) != "none" {
                    cell.tap()
                    Thread.sleep(forTimeInterval: 0.8)
                }
            }
            TapTimeline.beginHeld(handle)
            cell.tap(withNumberOfTaps: 3, numberOfTouches: 1)
            Thread.sleep(forTimeInterval: 1.4)
            let mark = handle.markOf(no)
            XCTAssertNotNil(mark)
            var trial = TapTimeline.endHeld(handle, index: index, expected: 3, endState: "\(no)번 칸 data-mark \(mark ?? "?"), 버린 누름 알림 \(handle.noticeCount())")
            trial.wrongEnd = mark != "none"
            try append(trial, slug: "triple", intended: "mark:\(no)", to: &trials)
        }
        handle.terminate()
        save(trials, target: "표시 칸 세 번 빠르게", slug: "triple")
        XCTAssertEqual(trials.filter(\.over).map(\.index), [], "누른 수보다 많이 들어간 경우가 없어야 한다")
    }

    // MARK: 5. 앱을 켠 뒤 첫 누름(FastTapTests 의 세 번 누름과 같은 차례, 기록용)

    /// iOS 18.4 의 FastTapTests 에서 세 번 빠르게 누른 끝 상태가 "표시 없음" 대신 "찍음"이 된 적이 있다(이벤트 열은 같음).
    /// 그 테스트는 앱을 켜고 표시 화면을 연 뒤 첫 누름이라, 같은 차례를 되풀이해 시각과 웹 판단, 화면 확대(visualViewport)를 남긴다.
    private func firstTouchTrials(slug: String, target: String, taps: Int, answerKey: Bool = false) throws {
        var trials: [Trial] = []
        for index in 1...10 {
            let handle = AppHandle(name: "held-\(slug)-\(index)")
            defer { handle.terminate() }
            handle.seedSession(answers: answerKey ? [:] : ExampleA.answers)
            handle.launch(extra: ["-SAEventLog"])
            if answerKey { handle.open("/input?input=keypad", route: "/input") }
            else { handle.open("/marks", route: "/marks") }
            let element = answerKey ? handle.key("3") : handle.markCell(3)
            XCTAssertTrue(element.waitForExistence(timeout: 5))
            TapTimeline.beginHeld(handle)
            if taps == 2 { element.doubleTap() }
            else { element.tap(withNumberOfTaps: taps, numberOfTouches: 1) }
            Thread.sleep(forTimeInterval: 1.4)
            let actual: String
            let expected: String
            if answerKey {
                XCTAssertNotNil(handle.storeJSON(), "답을 넣기 전의 기록도 있어야 한다")
                actual = String(handle.answerMap().count)
                expected = String(taps)
            } else {
                let mark = handle.markOf(3)
                XCTAssertNotNil(mark)
                actual = mark ?? "?"
                expected = taps == 3 ? "none" : "guess"
            }
            var trial = TapTimeline.endHeld(handle, index: index, expected: taps,
                                            endState: "\(target) 끝 상태 \(actual), 기대 \(expected), 버린 누름 알림 \(handle.noticeCount())")
            if answerKey { trial.entered = max(trial.entered, Int(actual) ?? 0) }
            trial.wrongEnd = actual != expected
            try append(trial, slug: slug, intended: answerKey ? "key:3" : "mark:3", to: &trials)
            handle.capture("\(slug)-\(index)", theme: "light")
        }
        save(trials, target: target, slug: slug)
        XCTAssertEqual(trials.filter(\.over).map(\.index), [], "누른 수보다 많이 들어간 경우가 없어야 한다")
    }

    func testDoubleTapAnswerKeyAsFirstTouch() throws {
        try firstTouchTrials(slug: "key-double-first", target: "답 키 첫 두 번", taps: 2, answerKey: true)
    }

    func testTripleTapAnswerKeyAsFirstTouch() throws {
        try firstTouchTrials(slug: "key-triple-first", target: "답 키 첫 세 번", taps: 3, answerKey: true)
    }

    func testTripleTapAsFirstTouchAfterLaunch() throws {
        try firstTouchTrials(slug: "triple-first", target: "표시 칸 세 번 빠르게(켠 뒤 첫 누름)", taps: 3)
    }

    func testDoubleTapAsFirstTouchAfterLaunch() throws {
        try firstTouchTrials(slug: "double-first", target: "표시 칸 아주 빠르게 두 번(켠 뒤 첫 누름)", taps: 2)
    }
}

/// 부록 A 3-1. 각 경우를 새 프로세스에서 열고 실제 손가락 이벤트와 화면 상태를 기록한다.
@MainActor
final class ZoomDiagnosticsTests: XCTestCase {
    private enum Scenario: String, CaseIterable {
        case A, B, C, D, E, F, Gkey, Ggrade, H, I

        var selector: String {
            switch self {
            case .Gkey: "[data-key='3']"
            case .Ggrade: "[data-testid='grade-1']"
            default: "[data-mark-cell='3']"
            }
        }

        @MainActor
        func open(_ handle: AppHandle, recoverStartup: Bool = false) throws -> XCUIElement {
            let key = self == .Gkey
            let grade = self == .Ggrade
            handle.seedSession(answers: key ? [:] : ExampleA.answers,
                               gradedAt: grade ? "2026-11-22T11:00:00.000Z" : nil)
            handle.launch(extra: ["-SAEventLog"], waitForStart: !recoverStartup)
            if recoverStartup && !handle.web.waitForExistence(timeout: 20) {
                throw NSError(domain: "ZoomDiagnostics", code: 1, userInfo: [NSLocalizedDescriptionKey: "시작 화면 웹뷰가 없음"])
            }
            // WKWebView가 먼저 보이고 시험용 문서와 라우터는 잠시 뒤에 준비될 수 있다.
            guard handle.waitForStats(timeout: 35, { ($0["rendered"] as? Int ?? 0) > 0 && $0["failure"] == nil }) else {
                throw NSError(domain: "ZoomDiagnostics", code: 1, userInfo: [NSLocalizedDescriptionKey: "시작 화면 준비 실패: \(handle.shellStats())"])
            }
            handle.waitForRoute("/", timeout: 10)
            if grade {
                handle.open("/anatomy", route: "/anatomy")
                let found = handle.evaluate("const e = document.querySelector('[data-testid=grade-1]'); if (e) e.scrollIntoView({block:'center', behavior:'instant'}); return Boolean(e);")
                XCTAssertEqual(found as? Bool, true)
                return handle.any("1등급")
            }
            if key {
                handle.open("/input?input=keypad", route: "/input")
                return handle.key("3")
            }
            handle.open("/marks", route: "/marks")
            return handle.markCell(3)
        }
    }

    private func viewport(_ handle: AppHandle) throws -> [String: Any] {
        var result = try XCTUnwrap(handle.evaluate("""
        const root = document.documentElement, body = document.body, v = window.visualViewport;
        const outside = [];
        let outsideCount = 0;
        for (const e of document.querySelectorAll('*')) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.left < 0 || r.right > window.innerWidth + 0.5) {
            outsideCount++;
            if (outside.length < 10) outside.push({tag:e.localName, cls:e.getAttribute('class') || '', left:r.left, right:r.right});
          }
        }
        return {innerWidth:window.innerWidth, clientWidth:root.clientWidth, scrollWidth:root.scrollWidth,
                bodyScrollWidth:body.scrollWidth, visualWidth:v.width, scale:v.scale, offsetLeft:v.offsetLeft,
                offsetTop:v.offsetTop, outside, outsideCount};
        """) as? [String: Any])
        result["native"] = try XCTUnwrap(handle.evaluate("// native-scroll-metrics") as? [String: Any])
        return result
    }

    /// 대상의 React 처리까지 도달한 click을 센다. capture 단계에서 보호가 잘라 낸 click은 여기에 오지 않는다.
    private func observe(_ handle: AppHandle, scenario: Scenario) throws {
        let result = handle.evaluate("""
        const sel = \(handle.jsString(scenario.selector));
        if (document.querySelector(sel) === null) return false;
        window.__saZoomInputs = [];
        window.addEventListener('click', e => {
          const el = e.composedPath().find(n => n instanceof Element && n.matches(sel));
          if (el) window.__saZoomInputs.push({at:performance.now(), detail:e.detail, trusted:e.isTrusted});
        }, {passive:true});
        return true;
        """)
        XCTAssertEqual(try XCTUnwrap(result as? Bool), true)
    }

    private func configure(_ handle: AppHandle, scenario: Scenario) {
        switch scenario {
        case .C:
            _ = handle.evaluate("document.documentElement.style.overflowX = 'hidden'; document.body.style.overflowX = 'hidden'; return true;")
            Thread.sleep(forTimeInterval: 0.5)
        case .D:
            _ = handle.evaluate("document.documentElement.style.touchAction = 'manipulation'; return true;")
        case .H, .I:
            let type = scenario == .H ? "mousedown" : "click"
            _ = handle.evaluate("""
            window.__saZoomPrevented = 0;
            window.addEventListener('\(type)', e => {
              const b = e.target instanceof Element && e.target.closest('button');
              if (b && b.closest('a') === null) { e.preventDefault(); window.__saZoomPrevented++; }
            }, {capture:true, passive:false});
            return true;
            """)
        default:
            break
        }
    }

    /// 표시 칸의 CSS 중심과 XCUITest 중심을 기준 삼아 글자와 버튼이 없는 본문 지점을 한 번 누른다.
    private func tapBlank(_ handle: AppHandle, cell: XCUIElement) throws {
        let value = try XCTUnwrap(handle.evaluate("""
        const m = document.querySelector('[data-mark-cell="3"]').getBoundingClientRect();
        const main = document.querySelector('main');
        const words = [];
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent.trim()) {
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            words.push(...range.getClientRects());
          }
        }
        for (let y = Math.ceil(main.getBoundingClientRect().top + 8); y < m.top; y += 6) {
          for (let x = window.innerWidth - 16; x >= 16; x -= 12) {
            const el = document.elementFromPoint(x,y);
            if (el && main.contains(el) && el.closest('button,a,[role=button],[role=radio],input,label') === null
                && words.every(r => x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2)) {
              return {dx:x-m.x-m.width/2, dy:y-m.y-m.height/2};
            }
          }
        }
        return null;
        """) as? [String: Double])
        let dx = try XCTUnwrap(value["dx"])
        let dy = try XCTUnwrap(value["dy"])
        let p = center(cell)
        try TouchSynth.tap(at: CGPoint(x: p.x + dx, y: p.y + dy))
    }

    private func record(_ scenario: Scenario, index: Int, folder: URL) throws {
        let handle = AppHandle(name: "zoom-\(scenario.rawValue)-\(index)")
        defer { handle.terminate() }
        let target = try scenario.open(handle)
        guard target.waitForExistence(timeout: 5) else {
            throw NSError(domain: "ZoomDiagnostics", code: 2, userInfo: [NSLocalizedDescriptionKey: "대상 요소가 없음"])
        }
        try observe(handle, scenario: scenario)
        let fresh = try viewport(handle)
        configure(handle, scenario: scenario)
        let before = (scenario == .C || scenario == .D) ? try viewport(handle) : fresh
        var preparation: [[String: Any]] = []
        TapTimeline.clearLogs(handle)
        if scenario == .E {
            try tapBlank(handle, cell: target)
            Thread.sleep(forTimeInterval: 1)
            preparation = TapTimeline.takeLogs(handle).0
            XCTAssertEqual(preparation.filter { $0["type"] as? String == "pointerdown" }.count, 1)
        }
        let start = Date().timeIntervalSince1970
        if scenario == .F {
            try TouchSynth.spacedTaps(at: center(target), interval: 0)
        } else {
            target.doubleTap()
        }
        let end = Date().timeIntervalSince1970
        Thread.sleep(forTimeInterval: 1.4)
        let settled = Date().timeIntervalSince1970
        let (events, trace) = TapTimeline.takeLogs(handle)
        let after = try viewport(handle)
        let inputs = try XCTUnwrap(handle.evaluate("return window.__saZoomInputs;") as? [[String: Any]])
        let state: String
        let targetName: String
        switch scenario {
        case .Gkey:
            targetName = "button:3"
            state = "답 \(handle.answerMap().count)개"
        case .Ggrade:
            targetName = "button:1등급"
            state = try XCTUnwrap(handle.evaluate("return Array.from(document.querySelectorAll('[data-testid^=grade-][aria-checked=true]'), e=>e.dataset.testid).join(',');") as? String)
        default:
            targetName = "mark-cell:3"
            state = try XCTUnwrap(handle.markOf(3))
        }
        let sample = TapTimeline.classify(index: index, events: events, trace: trace, endState: state)
        let presses = events.filter { $0["type"] as? String == "pointerdown" && $0["target"] as? String == targetName }.count
        let prevented = try XCTUnwrap(handle.evaluate("return window.__saZoomPrevented || 0;") as? Int)
        let result: [String: Any] = [
            "case": scenario.rawValue, "trial": index, "os": TapTimeline.os, "device": TestEnv.deviceTag,
            "gestureStart": start, "gestureEnd": end, "settledAt": settled,
            "fresh": fresh, "before": before, "after": after, "preparationEvents": preparation,
            "entered": inputs.count, "presses": presses, "allPresses": sample.presses, "inputs": inputs,
            "endState": state, "gapMs": sample.pressGapMs as Any? ?? NSNull(), "prevented": prevented,
            "events": events, "trace": trace,
        ]
        let url = folder.appendingPathComponent(String(format: "%@-%02d.json", scenario.rawValue, index))
        try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]).write(to: url, options: .atomic)
        XCTAssertGreaterThan(sample.presses, 0, "손가락 이벤트 기록이 있어야 한다")
    }

    func testZoomDiagnostics() throws {
        guard let raw = ProcessInfo.processInfo.environment["SA_ZOOM_CASES"] else {
            throw XCTSkip("선택한 확대 진단에서 기록해요")
        }
        let scenarios = try raw.split(separator: ",").map { try XCTUnwrap(Scenario(rawValue: String($0))) }
        XCTAssertFalse(scenarios.isEmpty)
        let folder = TestEnv.outDirectory.appendingPathComponent("zoom", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let first = Int(ProcessInfo.processInfo.environment["SA_ZOOM_FIRST"] ?? "1") ?? 0
        guard (1...10).contains(first) else { throw NSError(domain: "ZoomDiagnostics", code: 3) }
        for scenario in scenarios {
            for index in (scenario == scenarios.first ? first : 1)...10 {
                do { try record(scenario, index: index, folder: folder) }
                catch { XCTFail("\(scenario.rawValue) \(index)회 측정 실패: \(error)") }
            }
        }
    }

    /// 웹 0.3.4는 묶음 자체의 손가락 mousedown 처리를 잰다. 실험용 기본 동작 차단은 넣지 않는다.
    func testWeb034FirstGestures() throws {
        guard ProcessInfo.processInfo.environment["SA_ZOOM_034"] == "1" else {
            throw XCTSkip("지시서 5의 첫 누름 재측정에서 실행해요")
        }
        let plan: [(name: String, screen: Scenario, taps: Int)] = [
            ("A", .A, 2), ("Gkey", .Gkey, 2), ("Ggrade", .Ggrade, 2), ("F", .F, 2),
            ("mark-triple", .A, 3), ("key-triple", .Gkey, 3),
        ]
        let folder = TestEnv.outDirectory.appendingPathComponent("zoom034", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let firstText = ProcessInfo.processInfo.environment["SA_ZOOM_034_FIRST"] ?? "1"
        guard let first = Int(firstText), (1...(plan.count * 10)).contains(first) else {
            throw NSError(domain: "ZoomDiagnostics", code: 6, userInfo: [NSLocalizedDescriptionKey: "시작 순서가 1~60 밖이에요: " + firstText])
        }
        var incomplete: [String] = []
        for (offset, group) in plan.enumerated() {
            for index in 1...10 {
                let ordinal = offset * 10 + index
                guard ordinal >= first else { continue }
                let complete = try recordWeb034(group.name, screen: group.screen, taps: group.taps, index: index, ordinal: ordinal, folder: folder)
                if !complete { incomplete.append("\(group.name) \(index)회") }
            }
        }
        XCTAssertEqual(incomplete, [], "측정 증거가 빠진 회차")
    }

    /// 제스처를 보내는 코드는 이 함수 밖에 있다. 시작 화면 또는 대상이 나타나지 않은 때만 새 앱으로 다시 준비한다.
    private func prepareWeb034(_ screen: Scenario, name: String, index: Int, ordinal: Int) throws -> (AppHandle, XCUIElement) {
        let basename = String(format: "%@-%02d", name, index)
        var attempt = 0
        while true {
            attempt += 1
            let handle = AppHandle(name: "zoom034-\(basename)-prep\(attempt)")
            let start = Date().timeIntervalSince1970
            do {
                let target = try screen.open(handle, recoverStartup: true)
                guard target.waitForExistence(timeout: 5) else {
                    throw NSError(domain: "ZoomDiagnostics", code: 2, userInfo: [NSLocalizedDescriptionKey: "대상 요소가 없음: " + basename])
                }
                return (handle, target)
            } catch {
                let reason = error as NSError
                let stats = handle.shellStats()
                if handle.app.state != .notRunning { handle.terminate() }
                guard reason.domain == "ZoomDiagnostics", [1, 2].contains(reason.code) else { throw error }
                let folder = TestEnv.outDirectory.appendingPathComponent("zoom034-preparation", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let record: [String: Any] = [
                    "case": name, "trial": index, "ordinal": ordinal, "attempt": attempt,
                    "device": TestEnv.deviceTag, "os": TapTimeline.os, "measurementGestureStarted": false,
                    "started": start, "ended": Date().timeIntervalSince1970,
                    "domain": reason.domain, "code": reason.code, "reason": reason.localizedDescription,
                    "appRun": handle.runDirectory.lastPathComponent, "shellStats": stats,
                ]
                let file = folder.appendingPathComponent(handle.runDirectory.lastPathComponent + ".json")
                try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: file, options: .atomic)
                if attempt >= 3 { throw error }
            }
        }
    }

    private func recordWeb034(_ name: String, screen: Scenario, taps: Int, index: Int, ordinal: Int, folder: URL) throws -> Bool {
        let basename = String(format: "%@-%02d", name, index)
        let url = folder.appendingPathComponent(basename + ".json")
        let startedFile = folder.appendingPathComponent(basename + ".started")
        let partial = folder.appendingPathComponent(basename + ".pending")
        guard [url, startedFile, partial].allSatisfy({ !FileManager.default.fileExists(atPath: $0.path) }) else {
            throw NSError(domain: "ZoomDiagnostics", code: 4, userInfo: [NSLocalizedDescriptionKey: "이전에 측정을 시작한 회차라 중단: " + basename])
        }
        let (handle, target) = try prepareWeb034(screen, name: name, index: index, ordinal: ordinal)
        defer { handle.terminate() }
        let intended: String
        let rawTarget: String
        switch screen {
        case .Gkey: (intended, rawTarget) = ("key:3", "button:3")
        case .Ggrade: (intended, rawTarget) = ("grade:1", "button:1등급")
        default: (intended, rawTarget) = ("mark:3", "mark-cell:3")
        }
        let before = try viewport(handle)
        let prep = TapTimeline.takeLogs(handle).0
        TapTimeline.beginHeld(handle, web034Diagnostics: true)
        // 호출 직전 중단되어 누름이 실제 전달됐는지 알 수 없는 경우도 다시 재지 않는다.
        let marker: [String: Any] = ["ordinal": ordinal, "case": name, "trial": index, "device": TestEnv.deviceTag,
                                     "os": TapTimeline.os, "appRun": handle.runDirectory.lastPathComponent,
                                     "beforeGesture": Date().timeIntervalSince1970]
        try JSONSerialization.data(withJSONObject: marker).write(to: startedFile, options: .withoutOverwriting)
        let start = Date().timeIntervalSince1970
        var gestureError: String?
        if screen == .F {
            do { try TouchSynth.spacedTaps(at: center(target), interval: 0) }
            catch { gestureError = String(describing: error) }
        } else if taps == 3 {
            target.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        } else {
            target.doubleTap()
        }
        let end = Date().timeIntervalSince1970
        Thread.sleep(forTimeInterval: 1.4)
        let settled = Date().timeIntervalSince1970
        let sample = TapTimeline.collectHeld(handle, index: index, endState: "")
        let physical = sample.events.filter { $0["type"] as? String == "pointerdown" }
        let downs = sample.events.filter { $0["type"] as? String == "observed-down" }
        let clicks = sample.events.filter { $0["type"] as? String == "accepted-click" }
        let targetPresses = downs.filter { $0["control"] as? String == intended }.count
        let targetEntered = clicks.filter { $0["control"] as? String == intended }.count
        let scaleReadings = sample.events.filter { $0["type"] as? String == "viewport-resize" }
            .compactMap { ($0["scale"] as? NSNumber)?.doubleValue }
        let peak = (scaleReadings + [sample.scaleBefore, sample.scaleAfter].compactMap { $0 }).max()
        let zoomed = peak.flatMap { maximum in sample.scaleBefore.map { maximum - $0 > 0.01 } }
        let domElementOver = sample.elementOver || !sample.overAt.isEmpty
        // 답 키 실험은 답이 빈 세션으로 시작한다. 저장된 각 답의 값과 그 값의 키에 닿은 실제 누름을 비교한다.
        var savedAnswers: [String: Int]?
        var keyPresses: [String: Int] = [:]
        var storedCounts: [String: Int] = [:]
        var storedExcess: [String: Int] = [:]
        if screen == .Gkey {
            for event in downs where event["trusted"] as? Bool == true {
                if let control = event["control"] as? String, control.hasPrefix("key:"),
                   let number = Int(control.dropFirst(4)) {
                    keyPresses[String(number), default: 0] += 1
                }
            }
            if let store = handle.storeJSON(), let current = store["currentId"] as? String,
               let sessions = store["sessions"] as? [[String: Any]],
               let session = sessions.first(where: { $0["id"] as? String == current }),
               let answers = session["answers"] as? [String: Int] {
                savedAnswers = answers
                for number in answers.values { storedCounts[String(number), default: 0] += 1 }
                for (value, count) in storedCounts {
                    let extra = count - keyPresses[value, default: 0]
                    if extra > 0 { storedExcess[value] = extra }
                }
            }
        }
        let storedOver = savedAnswers.map { _ in !storedExcess.isEmpty }
        let elementOver = domElementOver || storedOver == true
        let precedingDowns = prep.filter { $0["type"] as? String == "pointerdown" }
        var complete = gestureError == nil && precedingDowns.isEmpty && physical.count == taps && downs.count == taps
            && sample.firstDownTarget == intended && physical.first?["target"] as? String == rawTarget
            && sample.scaleBefore != nil && sample.scaleAfter != nil
        var row: [String: Any] = [
            "case": name, "trial": index, "ordinal": ordinal, "device": TestEnv.deviceTag, "os": TapTimeline.os,
            "appRun": handle.runDirectory.lastPathComponent, "gestureStart": start, "gestureEnd": end, "settledAt": settled, "before": before,
            "after": ["scale": sample.scaleAfter as Any? ?? NSNull()], "peakScale": peak as Any? ?? NSNull(),
            "zoomed": zoomed as Any? ?? NSNull(), "settledZoomed": sample.zoomed,
            "gapMs": sample.pressGapMs as Any? ?? NSNull(), "expectedPresses": taps,
            "physicalDowns": physical.count, "nativePointerDownTargets": physical.compactMap { $0["target"] as? String },
            "firstDownTarget": sample.firstDownTarget as Any? ?? NSNull(), "intended": intended,
            "targetPresses": targetPresses, "targetEntered": targetEntered,
            "pressedByElement": sample.pressedByElement, "enteredByElement": sample.enteredByElement,
            "elementOver": elementOver, "domElementOver": domElementOver, "storedAnswerOver": storedOver as Any? ?? NSNull(),
            "overAt": sample.overAt, "preparationDowns": precedingDowns,
            "touchMousedown": sample.trace.filter { $0["what"] as? String == "touch-mousedown" }.count,
            "events": sample.events, "trace": sample.trace,
        ]
        if screen == .Gkey {
            row["answerPressesByValue"] = keyPresses
            if let savedAnswers {
                row["answers"] = savedAnswers
                row["storedAnswersByValue"] = storedCounts
                row["storedExcessByValue"] = storedExcess
            } else {
                complete = false
            }
        }
        if let gestureError { row["gestureError"] = gestureError }
        // 초과가 관찰되면 끝 상태 탐침이 실패하거나 실행이 끊겨도 원본이 남게 한다.
        if elementOver {
            try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]).write(to: partial, options: .atomic)
        }
        do {
            row["after"] = try viewport(handle)
            let actual: String
            let expected: String
            var answersMatch = true
            switch screen {
            case .Gkey:
                actual = savedAnswers.map { String($0.count) } ?? "확인하지 못함"
                expected = String(taps)
                answersMatch = (1...taps).allSatisfy { savedAnswers?[String($0)] == 3 }
            case .Ggrade:
                actual = try XCTUnwrap(handle.evaluate("return Array.from(document.querySelectorAll('[data-testid^=grade-][aria-checked=true]'), e=>e.dataset.testid).join(',');") as? String)
                expected = "grade-1"
            default:
                actual = try XCTUnwrap(handle.markOf(3))
                expected = taps == 3 ? "none" : "guess"
            }
            row["endState"] = actual
            row["expectedEndState"] = expected
            row["wrongEnd"] = actual != expected || !answersMatch
        } catch {
            complete = false
            row["observationError"] = String(describing: error)
        }
        row["completeEvidence"] = complete
        try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]).write(to: url, options: .atomic)
        if elementOver {
            try? FileManager.default.removeItem(at: partial)
            throw NSError(domain: "ZoomDiagnostics", code: 5, userInfo: [NSLocalizedDescriptionKey: "요소별 누름보다 많은 입력: " + basename])
        }
        return complete
    }
}
