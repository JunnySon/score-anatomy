import XCTest

/// 같은 Debug UI 테스트를 0.3.3과 0.3.4에서 실행한다. 각 AppHandle의 기록은 서로 독립이다.
@MainActor
final class MarkGestureRegressionTests: XCTestCase {
    private let markNumber = 9

    private func openMarks(_ name: String) throws -> AppHandle {
        continueAfterFailure = false
        let handle = AppHandle(name: "gesture-" + name)
        handle.seedSession(answers: ExampleA.answers)
        handle.launch(extra: ["-SAEventLog"])
        handle.open("/marks", route: "/marks")
        let ready = handle.evaluate("""
        const b = document.querySelector('button[data-mark-cell="\(markNumber)"]');
        if (!b) return false;
        b.scrollIntoView({block: 'center', behavior: 'instant'});
        const r = b.getBoundingClientRect();
        return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        """) as? Bool
        XCTAssertEqual(ready, true, "표시 칸 가운데에 실제 버튼이 있어야 한다")
        XCTAssertTrue(handle.markCell(markNumber).isHittable)
        XCTAssertEqual(handle.markOf(markNumber), "none")
        return handle
    }

    private func scale(_ handle: AppHandle) throws -> Double {
        try XCTUnwrap(handle.evaluate("return window.visualViewport.scale;") as? NSNumber).doubleValue
    }

    private func screenState(_ handle: AppHandle) throws -> [String: Any] {
        try XCTUnwrap(handle.evaluate("""
        const marks = {};
        const buttons = document.querySelectorAll('button[data-mark-cell]');
        if (buttons.length === 0) return null;
        for (const b of buttons) marks[b.dataset.markCell] = b.dataset.mark;
        const short = {};
        for (const b of document.querySelectorAll('button[data-short-mark]'))
          short[b.dataset.shortMark] = b.getAttribute('aria-pressed');
        const focus = document.activeElement;
        return {route: document.documentElement.dataset.route, marks, short,
          time: document.querySelector('[role="radio"][aria-checked="true"]')?.dataset.testid || '',
          selectedText: String(window.getSelection() || ''),
          focused: focus?.getAttribute('data-mark-cell') || focus?.id || focus?.tagName || '',
          openDialogs: document.querySelectorAll('[aria-modal="true"]').length};
        """) as? [String: Any])
    }

    private func savedState(_ handle: AppHandle) throws -> [String: Any] {
        let root = try XCTUnwrap(handle.storeJSON())
        let sessions = try XCTUnwrap(root["sessions"] as? [[String: Any]])
        let session = try XCTUnwrap(sessions.first { $0["id"] as? String == "s1" })
        let answers = try XCTUnwrap(session["answers"] as? [String: Any])
        XCTAssertEqual(answers.count, ExampleA.answers.count)
        return ["currentId": try XCTUnwrap(root["currentId"] as? String), "answers": answers,
                "marks": session["marks"] ?? [String: String](), "timeFeel": session["timeFeel"] ?? NSNull(),
                "gradedAt": session["gradedAt"] ?? NSNull()]
    }

    private func writeObservation(_ handle: AppHandle, action: String, details: [String: Any]) throws {
        let version = try XCTUnwrap(handle.evaluate("return window.__SA_APP__.appVersion;") as? String)
        let env = ProcessInfo.processInfo.environment
        let record: [String: Any] = ["action": action, "version": version, "ios": TapTimeline.os,
            "device": TestEnv.deviceTag, "model": env["SIMULATOR_MODEL_IDENTIFIER"] ?? "",
            "target": markNumber, "details": details]
        let data = try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: handle.runDirectory.appendingPathComponent("observation.json"), options: .atomic)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "gesture-\(version)-\(action)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTwoFingerPinchIncreasesVisualViewportScale() throws {
        let handle = try openMarks("pinch")
        defer { handle.terminate() }
        let before = try scale(handle)
        TapTimeline.beginHeld(handle)
        handle.web.pinch(withScale: 2, velocity: 1)
        let deadline = Date().addingTimeInterval(3)
        var after = try scale(handle)
        while after <= before + 0.01 && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            after = try scale(handle)
        }
        let trial = TapTimeline.collectHeld(handle, index: 1, endState: "")
        try writeObservation(handle, action: "pinch", details: ["scaleBefore": before,
            "scaleAfter": after, "events": trial.events])
        XCTAssertEqual(before, 1, accuracy: 0.01)
        XCTAssertGreaterThan(after, 1)
        XCTAssertGreaterThan(after, before + 0.01)
    }

    func testDragFromMarkButtonScrollsWithoutAppInput() throws {
        let handle = try openMarks("scroll")
        defer { handle.terminate() }
        let beforeScreen = try screenState(handle)
        let beforeStore = try savedState(handle)
        let bounds = try XCTUnwrap(handle.evaluate("""
        const b = document.querySelector('main.body');
        return b && [b.scrollTop, b.scrollHeight - b.clientHeight];
        """) as? [NSNumber])
        XCTAssertEqual(bounds.count, 2)
        let before = bounds[0].doubleValue
        let forward = bounds[1].doubleValue - before >= before
        let availableScroll = forward ? bounds[1].doubleValue - before : before
        XCTAssertGreaterThan(availableScroll, 30, "본문이 실제로 움직일 공간이 있어야 한다")
        let button = handle.markCell(markNumber)
        let start = button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let room = forward ? button.frame.midY - handle.web.frame.minY : handle.web.frame.maxY - button.frame.midY
        let distance = min(150, room - 35)
        XCTAssertGreaterThan(distance, 45)
        let end = start.withOffset(CGVector(dx: 0, dy: forward ? -distance : distance))
        TapTimeline.beginHeld(handle)
        start.press(forDuration: 0.05, thenDragTo: end)
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let after = try XCTUnwrap(handle.evaluate("return document.querySelector('main.body').scrollTop;") as? NSNumber).doubleValue
        let trial = TapTimeline.collectHeld(handle, index: 1, endState: "")
        let afterScreen = try screenState(handle)
        let afterStore = try savedState(handle)
        try writeObservation(handle, action: "scroll", details: ["scrollBefore": before, "scrollAfter": after,
            "forward": forward, "accepted": trial.entered, "events": trial.events, "trace": trial.trace,
            "beforeScreen": beforeScreen, "afterScreen": afterScreen, "beforeStore": beforeStore, "afterStore": afterStore])
        XCTAssertEqual(trial.presses, 1)
        XCTAssertEqual(trial.firstDownTarget, "mark:\(markNumber)")
        XCTAssertGreaterThan(forward ? after - before : before - after, 15)
        XCTAssertEqual(trial.entered, 0)
        let inputKeys = ["route", "marks", "short", "time", "openDialogs"]
        let beforeInputs = beforeScreen.filter { inputKeys.contains($0.key) }
        let afterInputs = afterScreen.filter { inputKeys.contains($0.key) }
        XCTAssertEqual(NSDictionary(dictionary: beforeInputs), NSDictionary(dictionary: afterInputs))
        XCTAssertEqual(NSDictionary(dictionary: beforeStore), NSDictionary(dictionary: afterStore))
    }

    func testSingleLongPressOnMarkButton() throws {
        let handle = try openMarks("longpress")
        defer { handle.terminate() }
        let before = try screenState(handle)
        let beforeStore = try savedState(handle)
        TapTimeline.beginHeld(handle)
        handle.markCell(markNumber).press(forDuration: 0.7)
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let appearance = XCTAttachment(screenshot: handle.app.screenshot())
        appearance.name = "표시 칸을 한 번 길게 누른 뒤의 화면"
        appearance.lifetime = .keepAlways
        add(appearance)
        let trial = TapTimeline.collectHeld(handle, index: 1, endState: "")
        let screen = try screenState(handle)
        let saved = try savedState(handle)
        let menus = handle.app.menus.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        let behavior: [String: Any] = ["beforeScreen": before, "afterScreen": screen,
            "beforeStore": beforeStore, "afterStore": saved, "visibleNativeMenus": menus.count,
            "acceptedByElement": trial.enteredByElement, "createdClicks": trial.made,
            "contextMenus": trial.events.filter { $0["type"] as? String == "contextmenu" }.count]
        let box = try XCTUnwrap(trial.scaleAfter)
        try writeObservation(handle, action: "longpress", details: ["behavior": behavior,
            "durationRequestedSeconds": 0.7, "holdMs": TapEvents(trial.events).holds,
            "scaleAfter": box, "events": trial.events, "trace": trial.trace])
        XCTAssertEqual(trial.presses, 1)
        XCTAssertEqual(trial.firstDownTarget, "mark:\(markNumber)")
        // 0.3.3의 관측값은 실행 후 같은 기기/OS의 0.3.4 관측값과 항목별로 비교한다.
    }
}
