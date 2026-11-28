import XCTest

/// 웹이 받은 이벤트(껍데기의 window.__saEventLog)와 웹의 판단 기록(window.__saTapTrace, 앱 시험용 묶음에만 있음)을 같은 시계
/// (performance.now)로 합쳐 한 번의 누름 결과를 가르고, 결정기록 7.8 의 형식으로 글자 파일을 남긴다(작업 지시서 4의 3-2).
/// HeldDoubleTapTests 와 FastTapTests 가 쓴다.
@MainActor
enum TapTimeline {
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
        var pressedByElement: [String: Int] = [:]
        var enteredByElement: [String: Int] = [:]
        var overAt: [Double] = []
        var firstDownTarget: String? {
            events.first { $0["type"] as? String == "observed-down" }?["control"] as? String
        }
        var scaleBefore: Double?
        var scaleAfter: Double?
        var wrongEnd: Bool?
        var endState = ""

        var elementOver: Bool {
            enteredByElement.contains { key, count in count > pressedByElement[key, default: 0] }
        }

        var peakScale: Double? {
            let scales = events.filter { $0["type"] as? String == "viewport-resize" }
                .compactMap { ($0["scale"] as? NSNumber)?.doubleValue }
            return (scales + [scaleBefore, scaleAfter].compactMap { $0 }).max()
        }

        var zoomed: Bool {
            guard let scaleBefore, let peakScale else { return false }
            return peakScale > scaleBefore
        }

        var settledZoomed: Bool {
            guard let scaleBefore, let scaleAfter else { return false }
            return scaleAfter > scaleBefore
        }
        var pressGapMs: Double?
        /// 손을 뗀 뒤 그 누름의 손가락 click 이 오기까지(ms).
        var liftToClick: [Double] = []

        /// 누른 수보다 많이 들어갔다.
        var over: Bool { entered > presses || elementOver || !overAt.isEmpty }

        var kind: String {
            var parts: [String] = []
            if lost { parts.append("사라짐") }
            if made > 0 { parts.append("채움") }
            if lateDrop > 0 { parts.append("늦은 click 버림") }
            if over { parts.append("누른 수보다 많이 들어감") }
            return parts.isEmpty ? "보통" : parts.joined(separator: "+")
        }
    }

    static var os: String { UIDevice.current.systemVersion }

    static func takeLogs(_ handle: AppHandle) -> ([[String: Any]], [[String: Any]]) {
        let value = handle.evaluate("""
        const l = window.__saEventLog || []; const t = window.__saTapTrace || [];
        const out = { events: l.slice(), trace: t.slice() }; l.length = 0; t.length = 0; return out;
        """) as? [String: Any] ?? [:]
        return (value["events"] as? [[String: Any]] ?? [], value["trace"] as? [[String: Any]] ?? [])
    }

    /// 창의 capture에서 tapGuard를 통과한 click만 센다. 글이나 빈 곳은 입력으로 세지 않는다.
    /// 같은 이름의 다른 버튼과 그 자리에 새로 생긴 요소를 구별하려고 실제 DOM 요소마다 번호를 붙인다.
    static func beginHeld(_ handle: AppHandle, web034Diagnostics: Bool = false) {
        let ready = handle.evaluate("""
        if (!Array.isArray(window.__saEventLog)) return false;
        // 첫 판단 때 만드는 배열이라 아직 누른 적이 없는 화면에는 없을 수 있다.
        if (window.__saTapTrace === undefined) window.__saTapTrace = [];
        if (!Array.isArray(window.__saTapTrace)) return false;
        window.__saEventLog.length = 0;
        window.__saTapTrace.length = 0;
        const rows = window.__saEventLog;
        const ids = new WeakMap();
        let next = 0;
        const controller = new AbortController();
        const track = (type, event) => {
          const hit = event.target?.closest?.('button, a[href], input, select, textarea, summary, label, [role="radio"], [role="button"], [role="switch"]');
          let target = '';
          if (hit && !hit.matches(':disabled,[aria-disabled="true"]')) {
            if (!ids.has(hit)) {
              const name = hit.dataset.markCell || hit.dataset.testid || hit.getAttribute('aria-label') || hit.textContent.trim();
              ids.set(hit, hit.tagName + ':' + name.slice(0, 48) + '#' + (++next));
            }
            target = ids.get(hit);
          }
          let control = '';
          if (hit?.hasAttribute('data-mark-cell')) control = 'mark:' + hit.dataset.markCell;
          else if (hit?.matches('[aria-label="답 키패드"] button[data-key]')) control = 'key:' + hit.dataset.key;
          else if (hit?.dataset.testid?.startsWith('grade-')) control = 'grade:' + hit.dataset.testid.slice(6);
          const row = {type, now: performance.now(), target, control, trusted: event.isTrusted, detail: event.detail,
                       x: event.clientX, y: event.clientY};
          if (type === 'observed-mousedown') row.defaultPrevented = event.defaultPrevented;
          rows.push(row);
        };
        const options = {capture: true, passive: true, signal: controller.signal};
        window.addEventListener('pointerdown', e => track('observed-down', e), options);
        document.addEventListener('click', e => track('accepted-click', e), options);
        if (\(web034Diagnostics ? "true" : "false")) {
          document.addEventListener('mousedown', e => track('observed-mousedown', e), options);
        }
        window.visualViewport.addEventListener('resize', () => {
          rows.push({type:'viewport-resize', now:performance.now(), scale:window.visualViewport.scale});
        }, options);
        window.__saHeldCapture = { controller, scale: window.visualViewport.scale };
        return true;
        """) as? Bool
        XCTAssertEqual(ready, true, "손가락 이벤트와 웹 판단 기록이 모두 있어야 한다")
    }

    static func endHeld(_ handle: AppHandle, index: Int, expected: Int, endState: String) -> Trial {
        let trial = collectHeld(handle, index: index, endState: endState)
        let observed = trial.events.filter { $0["type"] as? String == "observed-down" }
        XCTAssertEqual(observed.count, expected, "실제 누름 수가 빠졌어요")
        XCTAssertEqual(trial.presses, expected, "원본 pointerdown 수가 빠졌어요")
        XCTAssertNotNil(trial.scaleAfter, "앞뒤 배율이 있어야 한다")
        return trial
    }

    /// 판정 전에 회차 원본을 보존해야 하는 진단도 같은 이벤트와 요소별 셈을 쓴다.
    static func collectHeld(_ handle: AppHandle, index: Int, endState: String) -> Trial {
        let bounds = handle.evaluate("""
        const capture = window.__saHeldCapture;
        if (!capture) return null;
        capture.controller.abort();
        delete window.__saHeldCapture;
        return [capture.scale, window.visualViewport.scale];
        """) as? [NSNumber]
        let (events, trace) = takeLogs(handle)
        var trial = classify(index: index, events: events, trace: trace, endState: endState)
        if let bounds, bounds.count == 2 {
            trial.scaleBefore = bounds[0].doubleValue
            trial.scaleAfter = bounds[1].doubleValue
        }
        for event in events {
            guard let key = event["target"] as? String, !key.isEmpty else { continue }
            switch event["type"] as? String {
            case "observed-down":
                trial.pressedByElement[key, default: 0] += 1
            case "accepted-click":
                trial.enteredByElement[key, default: 0] += 1
                if trial.enteredByElement[key, default: 0] > trial.pressedByElement[key, default: 0] {
                    trial.overAt.append(number(event["now"]) ?? 0)
                }
            default: break
            }
        }
        trial.entered = trial.enteredByElement.values.reduce(0, +)
        return trial
    }

    private static func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    /// 이벤트와 판단으로 한 번의 결과를 가른다.
    static func classify(index: Int, events: [[String: Any]], trace: [[String: Any]], endState: String) -> Trial {
        var trial = Trial(index: index, events: events, trace: trace, endState: endState)
        let type = { (e: [String: Any]) in e["type"] as? String ?? "" }
        let now = { (e: [String: Any]) in number(e["now"]) ?? 0 }
        let downs = events.filter { type($0) == "pointerdown" }.map(now)
        trial.presses = downs.count
        let ups = events.filter { type($0) == "pointerup" }.map(now)
        let clicks = events.filter { type($0) == "click" }
        let trusted = clicks.filter { ($0["trusted"] as? Bool) == true }
        trial.made = clicks.count - trusted.count
        if downs.count >= 2 {
            trial.pressGapMs = ((downs[1] - downs[0]) * 10).rounded() / 10
            // 둘째 누름의 범위는 이벤트 차례로 정한다(같은 시각에 온 이벤트도 앞뒤를 가릴 수 있게).
            let downIndexes = events.indices.filter { type(events[$0]) == "pointerdown" }
            let secondStart = downIndexes[1]
            let secondEnd = downIndexes.count > 2 ? downIndexes[2] : events.count
            let second = events[secondStart..<secondEnd]
            trial.lost = !second.contains { type($0) == "click" && ($0["trusted"] as? Bool) == true }
            let secondUp = second.firstIndex { type($0) == "pointerup" } ?? secondEnd
            trial.dblclickWhileHeld = events[secondStart..<secondUp].contains { type($0) == "dblclick" }
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
        trial.lateDrop = trace.filter { what($0).hasSuffix("late-drop") }.count
        trial.entered = clicks.count - trial.discard - trial.lateDrop
        return trial
    }


    /// 결정기록 7.8 의 형식: 이벤트 한 줄씩 시각 차례로, 웹 판단은 같은 시각 줄에 붙이거나 따로 한 줄.
    static func timeline(_ trial: Trial, title: String) -> String {
        struct Line { let at: Double; let text: String }
        var lines: [Line] = []
        let start = trial.events.compactMap { number($0["now"]) }.min() ?? 0
        func pad(_ text: String, _ width: Int) -> String {
            text.count >= width ? text + " " : text + String(repeating: " ", count: width - text.count)
        }
        for e in trial.events {
            let type = e["type"] as? String ?? ""
            let at = number(e["now"]) ?? 0
            if type == "viewport-resize", let scale = number(e["scale"]) {
                lines.append(Line(at: at, text: pad(String(format: "%.1f", at), 10) + "viewport-resize scale " + String(scale)))
                continue
            }
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
            let marker = (type == "observed-down") ? " [대상 " + (e["control"] as? String ?? "") + "]" : ""
            lines.append(Line(at: at, text: text + marker))
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
        if let before = trial.scaleBefore, let after = trial.scaleAfter {
            out += "배율 " + String(before) + " -> " + String(after) + ", 요소별 누름 " + String(describing: trial.pressedByElement) + ", 요소별 입력 " + String(describing: trial.enteredByElement) + ", 초과 시각 " + String(describing: trial.overAt) + "\n"
        }
        return out
    }

    /// 이벤트 기록과 판단 기록을 비운다(그다음 누름만 남게).
    static func clearLogs(_ handle: AppHandle) {
        _ = takeLogs(handle)
    }

    /// 결과 폴더의 held 아래에 글자 파일로 남긴다(verify.sh 가 docs/ios_누름기록 에 옮긴다).
    static func write(_ trial: Trial, title: String, name: String) {
        let folder = TestEnv.outDirectory.appendingPathComponent("held", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? timeline(trial, title: title).write(to: folder.appendingPathComponent("\(TestEnv.deviceTag)-ios\(os)-\(name).txt"), atomically: true, encoding: .utf8)
    }
}
