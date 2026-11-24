import XCTest

/// 작업 지시서 4의 3-2: 웹 0.3.2 의 새 채우기 규칙(누르는 동안 온 dblclick, 결정기록 7.8)을 시뮬레이터에서 잰다. 기록용이다(판정에 넣지 않음).
///
/// - 0.29초 안팎 두 번 누름(TouchSynth 로 따로 보낸 누름의 가장 짧은 간격)을 표시 칸, 답 키, 점수 해부의 같은 자리에서 되풀이한다.
/// - 경우마다 껍데기의 이벤트 기록(window.__saEventLog)과 웹의 판단 기록(window.__saTapTrace)을 같은 시계(performance.now)로 합쳐,
///   사라진 경우(둘째 누름의 손가락 click 이 오지 않음), 채운 경우(웹이 click 을 만들어 보냄), 두 번을 넘겨 들어간 경우를 센다.
/// - 사라진 경우와 채운 경우, 세 번 누름은 결정기록 7.8 의 형식으로 글자 파일을 남긴다(verify.sh 가 docs/ios_누름기록 에 옮긴다).
/// - 두 번을 넘겨 들어간 경우가 하나라도 있으면 실패다(작업 지시서 4의 3-2). 그 밖에는 실패로 보지 않는다.
@MainActor
final class HeldDoubleTapTests: XCTestCase {
    /// 경우마다 되풀이하는 수(verify.sh 가 TEST_RUNNER_SA_HELD_REPEATS 로 바꿀 수 있다).
    static var repeats: Int {
        Int(ProcessInfo.processInfo.environment["SA_HELD_REPEATS"] ?? "") ?? 32
    }

    /// 한 번 누른 결과.
    struct Trial {
        var index: Int
        var events: [[String: Any]]
        var trace: [[String: Any]]
        /// 둘째 누름의 손가락 click 이 오지 않았다.
        var lost = false
        /// 둘째 누름을 누르고 있는 동안(손을 떼기 전에) dblclick 이 왔다.
        var dblclickWhileHeld = false
        /// 웹이 click 을 만들어 보냈다(trusted 가 false 인 click).
        var made = 0
        var heldFill = 0
        var liftFill = 0
        var discard = 0
        var lateDrop = 0
        /// 받아들인 누름 수(손가락 click 과 만든 click 에서 버린 것과 늦어서 버린 것을 뺌).
        var entered = 0
        /// 누른 수(pointerdown 수).
        var presses = 0
        var endState = ""
        var pressGapMs: Double?
        /// 손을 뗀 뒤 그 누름의 손가락 click 이 오기까지(ms).
        var liftToClick: [Double] = []

        /// 누른 수보다 많이 들어갔다.
        var over: Bool { entered > presses }

        var kind: String {
            var parts: [String] = []
            if lost { parts.append("사라짐") }
            if made > 0 { parts.append("채움") }
            if lateDrop > 0 { parts.append("늦은 click 버림") }
            if over { parts.append("누른 수보다 많이 들어감") }
            return parts.isEmpty ? "보통" : parts.joined(separator: "+")
        }
    }

    private var os: String { UIDevice.current.systemVersion }

    private func takeLogs(_ handle: AppHandle) -> ([[String: Any]], [[String: Any]]) {
        let value = handle.evaluate("""
        const l = window.__saEventLog || []; const t = window.__saTapTrace || [];
        const out = { events: l.slice(), trace: t.slice() }; l.length = 0; t.length = 0; return out;
        """) as? [String: Any] ?? [:]
        return (value["events"] as? [[String: Any]] ?? [], value["trace"] as? [[String: Any]] ?? [])
    }

    private func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    /// 이벤트와 판단으로 한 번의 결과를 가른다.
    private func classify(index: Int, events: [[String: Any]], trace: [[String: Any]], endState: String) -> Trial {
        var trial = Trial(index: index, events: events, trace: trace, endState: endState)
        let type = { (e: [String: Any]) in e["type"] as? String ?? "" }
        let now = { (e: [String: Any]) in self.number(e["now"]) ?? 0 }
        let downs = events.filter { type($0) == "pointerdown" }.map(now)
        trial.presses = downs.count
        let ups = events.filter { type($0) == "pointerup" }.map(now)
        let clicks = events.filter { type($0) == "click" }
        let trusted = clicks.filter { ($0["trusted"] as? Bool) == true }
        trial.made = clicks.count - trusted.count
        if downs.count >= 2 {
            trial.pressGapMs = ((downs[1] - downs[0]) * 10).rounded() / 10
            let secondStart = downs[1]
            let secondEnd = downs.count > 2 ? downs[2] : .infinity
            trial.lost = !trusted.contains { now($0) >= secondStart && now($0) < secondEnd }
            let secondUp = ups.first { $0 >= secondStart } ?? .infinity
            trial.dblclickWhileHeld = events.contains { type($0) == "dblclick" && now($0) >= secondStart && now($0) < secondUp }
        }
        for (i, down) in downs.enumerated() {
            let next = i + 1 < downs.count ? downs[i + 1] : .infinity
            guard let up = ups.first(where: { $0 >= down && $0 < next }),
                  let click = trusted.first(where: { now($0) >= up && now($0) < next }) else { continue }
            trial.liftToClick.append(((now(click) - up) * 10).rounded() / 10)
        }
        let what = { (t: [String: Any]) in t["what"] as? String ?? "" }
        trial.heldFill = trace.filter { what($0) == "held-fill" }.count
        trial.liftFill = trace.filter { what($0) == "fill" }.count
        trial.discard = trace.filter { what($0) == "discard" }.count
        trial.lateDrop = trace.filter { what($0) == "held-late-drop" }.count
        trial.entered = clicks.count - trial.discard - trial.lateDrop
        return trial
    }

    // MARK: 기록

    /// 결정기록 7.8 의 형식: 이벤트 한 줄씩 시각 차례로, 웹 판단은 같은 시각 줄에 붙이거나 따로 한 줄.
    private func timeline(_ trial: Trial, title: String) -> String {
        struct Line { let at: Double; let text: String }
        var lines: [Line] = []
        let start = trial.events.compactMap { number($0["now"]) }.min() ?? 0
        func pad(_ text: String, _ width: Int) -> String {
            text.count >= width ? text + " " : text + String(repeating: " ", count: width - text.count)
        }
        for e in trial.events {
            let type = e["type"] as? String ?? ""
            let at = number(e["now"]) ?? 0
            let detail = (e["detail"] as? NSNumber).map { "\($0.intValue)" } ?? "-"
            let trusted = (e["trusted"] as? Bool).map { $0 ? "true" : "false" } ?? "-"
            let finger: String
            if type.hasPrefix("pointer") {
                finger = (e["pointerId"] as? NSNumber).map { "\($0.intValue)" } ?? "-"
            } else if type.hasPrefix("touch") {
                finger = (e["touches"] as? NSNumber).map { "\($0.intValue)" } ?? "-"
            } else {
                finger = "-"
            }
            let point = "\((e["x"] as? NSNumber)?.intValue ?? 0),\((e["y"] as? NSNumber)?.intValue ?? 0)"
            let text = pad(String(format: "%.1f", at), 10) + pad(type, 13) + pad(detail, 8) + pad(trusted, 9) + pad(finger, 8) + pad(point, 9) + (e["target"] as? String ?? "")
            lines.append(Line(at: at, text: text))
        }
        for t in trial.trace {
            let at = number(t["at"]) ?? 0
            let what = t["what"] as? String ?? ""
            let extra = t.filter { $0.key != "at" && $0.key != "what" }.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ")
            lines.append(Line(at: at + 0.01, text: pad(String(format: "%.1f", at), 10) + pad("(웹 판단)", 13) + what + (extra.isEmpty ? "" : "(\(extra))")))
        }
        lines.sort { $0.at < $1.at }
        var out = "# \(title)\n"
        out += "# 기기 \(TestEnv.deviceTag), iOS \(os). 시각은 performance.now()(ms, 이 경우의 첫 이벤트 \(String(format: "%.1f", start))).\n"
        out += "# 손가락: pointer 이벤트는 pointerId, touch 이벤트는 그때 닿아 있는 손가락 수. trusted false 는 웹이 만들어 보낸 click.\n"
        out += "# 분류: \(trial.kind). 누름 시작 사이 \(trial.pressGapMs.map { String(format: "%.1f", $0) } ?? "-")ms, 손뗌에서 click 까지 \(trial.liftToClick.map { String(format: "%.1f", $0) }.joined(separator: ", "))ms\n"
        out += pad("시각(ms)", 10) + pad("종류", 13) + pad("detail", 8) + pad("trusted", 9) + pad("손가락", 8) + pad("x,y", 9) + "대상 또는 웹 판단\n"
        out += lines.map(\.text).joined(separator: "\n") + "\n"
        out += "끝 상태: \(trial.endState). 받아들인 누름 \(trial.entered), 웹이 만든 click \(trial.made)(누르는 동안 온 dblclick 으로 채움 \(trial.heldFill), 손뗌 수로 채움 \(trial.liftFill)), 버림 \(trial.discard), 늦은 click 버림 \(trial.lateDrop)\n"
        return out
    }

    private func save(_ trials: [Trial], target: String, slug: String, logAll: Bool = false) {
        let folder = TestEnv.outDirectory.appendingPathComponent("held", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let device = "\(TestEnv.deviceTag)-ios\(os)"
        for trial in trials where logAll || trial.lost || trial.made > 0 || trial.over || trial.lateDrop > 0 {
            let name = "\(device)-\(slug)-\(String(format: "%02d", trial.index)).txt"
            try? timeline(trial, title: "\(target) \(trial.index)번째").write(to: folder.appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        let gaps = trials.compactMap(\.pressGapMs)
        let lifts = trials.flatMap(\.liftToClick)
        recordMetric([
            "kind": "held", "device": TestEnv.deviceTag, "os": os, "target": target, "slug": slug, "trials": trials.count,
            "lost": trials.filter(\.lost).count, "dblclickWhileHeld": trials.filter(\.dblclickWhileHeld).count,
            "filled": trials.filter { $0.made > 0 }.count, "heldFilled": trials.filter { $0.heldFill > 0 }.count,
            "liftFilled": trials.filter { $0.liftFill > 0 }.count, "lostNotFilled": trials.filter { $0.lost && $0.made == 0 }.count,
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
            _ = takeLogs(handle)
            try TouchSynth.spacedTaps(at: point, interval: 0)
            Thread.sleep(forTimeInterval: 1.4)
            let (events, trace) = takeLogs(handle)
            let state = "\(no)번 칸 data-mark \(handle.markOf(no) ?? "?"), 버린 누름 알림 \(handle.noticeCount())"
            trials.append(classify(index: index, events: events, trace: trace, endState: state))
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
            _ = takeLogs(handle)
            try TouchSynth.spacedTaps(at: point, interval: 0)
            Thread.sleep(forTimeInterval: 1.4)
            let (events, trace) = takeLogs(handle)
            _ = handle.waitForStore(timeout: 1.5) { _ in handle.answerMap().count >= before + 1 }
            let added = handle.answerMap().count - before
            var trial = classify(index: index, events: events, trace: trace, endState: "답 키 3 으로 들어간 문항 \(added)개(모두 \(handle.answerMap().count)개), 버린 누름 알림 \(handle.noticeCount())")
            // 답 키는 들어간 문항 수가 곧 받아들인 누름 수다(기록 파일로 다시 본다).
            trial.entered = max(trial.entered, added)
            trials.append(trial)
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
            _ = takeLogs(handle)
            try TouchSynth.spacedTaps(at: point, interval: 0)
            Thread.sleep(forTimeInterval: 1.4)
            let (events, trace) = takeLogs(handle)
            let state = "고른 칩 \(handle.evaluate(checked) as? String ?? "?"), 버린 누름 알림 \(handle.noticeCount()), 화면 \(handle.route() ?? "?")"
            trials.append(classify(index: index, events: events, trace: trace, endState: state))
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
            _ = takeLogs(handle)
            cell.tap(withNumberOfTaps: 3, numberOfTouches: 1)
            Thread.sleep(forTimeInterval: 1.4)
            let (events, trace) = takeLogs(handle)
            trials.append(classify(index: index, events: events, trace: trace, endState: "\(no)번 칸 data-mark \(handle.markOf(no) ?? "?"), 버린 누름 알림 \(handle.noticeCount())"))
        }
        handle.terminate()
        save(trials, target: "표시 칸 세 번 빠르게", slug: "triple", logAll: true)
        XCTAssertEqual(trials.filter(\.over).map(\.index), [], "누른 수보다 많이 들어간 경우가 없어야 한다")
    }
}
