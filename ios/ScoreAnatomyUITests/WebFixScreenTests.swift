import XCTest

/// 결정기록 7.6(작업 지시서 3-2의 3-4)의 화면 쪽 항목과 3-1의 규격 1 확인. 숫자는 metrics.jsonl 에 kind "webfix" 로 남긴다.
@MainActor
final class WebFixScreenTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func record(_ name: String, _ values: [String: Any]) {
        var row: [String: Any] = ["kind": "webfix", "case": name, "device": TestEnv.deviceTag, "os": UIDevice.current.systemVersion]
        row.merge(values) { _, b in b }
        recordMetric(row)
    }

    /// 표시 화면에서 검산 예시의 찍음을 붙이고 채점한 뒤 점수 해부까지 간다(원인은 고르지 않는다).
    private func goToAnatomy(_ handle: AppHandle) {
        handle.open("/marks", route: "/marks")
        for no in ExampleA.guesses { handle.setGuess(no) }
        let grade = handle.button("채점하기")
        handle.reveal(grade)
        grade.tap()
        let direct = handle.button("점수 해부 바로 보기")
        XCTAssertTrue(direct.waitForExistence(timeout: 8), "점수 화면")
        direct.tap()
        handle.waitForRoute("/anatomy")
        Thread.sleep(forTimeInterval: 0.7)
    }

    // MARK: 3-1. 규격 1 껍데기에서는 받은 자료 안내와 "새로 확인"이 없다

    func testSpecOneShellShowsNoRemoteNoticeOrRefresh() throws {
        let handle = AppHandle(name: "spec1")
        handle.launch()
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20))
        let app = handle.evaluate("""
        const a = window.__SA_APP__;
        return { bridge: a.bridge, hasRemote: Object.prototype.hasOwnProperty.call(a, 'remote'), keys: Object.keys(a).sort().join(','),
                 remoteHandler: typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.saRemote) };
        """) as? [String: Any] ?? [:]
        XCTAssertEqual(app["bridge"] as? Int, 1, "껍데기는 다리 규격 1")
        XCTAssertEqual(app["hasRemote"] as? Bool, false, "remote 칸을 넣지 않는다")
        XCTAssertEqual(app["remoteHandler"] as? String, "undefined", "saRemote 메시지를 받는 곳이 없다")
        handle.button("시험 고르기").tap()
        XCTAssertTrue(handle.any("어떤 시험을 넣을까요?").waitForExistence(timeout: 8), "시험 선택 화면")
        Thread.sleep(forTimeInterval: 0.8)
        let texts = ["새로 확인", "시험 자료는 정해진 주소 한 곳에서 받아요", "받은 자료 기준"]
        for text in texts {
            XCTAssertFalse(handle.element(labelContains: text).exists, "'\(text)' 가 보이지 않는다")
        }
        let body = handle.evaluate("return document.body.innerText;") as? String ?? ""
        XCTAssertFalse(texts.contains { body.contains($0) }, "화면 글자에도 없다")
        handle.capture("규격1-시험선택", theme: "light")
        record("규격 1 껍데기의 시험 선택", ["bridge": app["bridge"] ?? "", "hasRemote": app["hasRemote"] ?? "", "keys": app["keys"] ?? "", "remoteHandler": app["remoteHandler"] ?? "",
                                     "shown": texts.filter { body.contains($0) }])
    }

    // MARK: 2. 계단 카드의 제목이 접근성 요소 하나

    func testStepCardTitlesAreSingleAccessibilityElements() throws {
        let handle = AppHandle(name: "steps-a11y")
        handle.seedSession(answers: ExampleA.answers)
        handle.launch()
        goToAnatomy(handle)
        handle.tapCentered(handle.any("2등급"), selector: "[data-testid=grade-2]")
        handle.waitForText("3~7점 남았어요")
        let toSteps = handle.web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "고칠 것")).firstMatch
        handle.reveal(toSteps)
        toSteps.tap()
        XCTAssertTrue(handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "먼저 고칠")).firstMatch.waitForExistence(timeout: 8), "계단 화면")
        Thread.sleep(forTimeInterval: 0.8)
        handle.dumpTree("steps")
        var found: [String: Int] = [:]
        for title in ["1. 적분", "2. 수열", "3. 확률"] {
            let count = handle.web.descendants(matching: .any).matching(handle.exact(title)).count
            found[title] = count
            XCTAssertGreaterThanOrEqual(count, 1, "'\(title)' 가 한 요소로 있다")
        }
        // 조각으로 나뉘었다면 "1", ". ", "1." 같은 요소가 따로 있었다(지난 감사에서 걸린 것).
        var pieces: [String: Int] = [:]
        for piece in ["1", "2", "3", ".", ". ", "1.", "2."] {
            pieces[piece] = handle.web.staticTexts.matching(handle.exact(piece)).count
            XCTAssertEqual(pieces[piece], 0, "'\(piece)' 조각이 따로 있지 않다")
        }
        let todo1 = handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "1. 오늘")).firstMatch
        let todo2 = handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "2. 비슷한")).firstMatch
        XCTAssertTrue(todo1.exists, "오늘 할 일의 첫 줄이 '1. 오늘'로 시작하는 한 요소")
        let labels = handle.web.staticTexts.allElementsBoundByIndex.prefix(80).map { $0.label }.filter { $0.first.map { $0.isNumber } ?? false }
        record("계단 카드 제목", ["titles": found, "pieces": pieces, "todo1": todo1.exists ? todo1.label : "", "todo2": todo2.exists ? todo2.label : "", "numberedTexts": Array(labels)])
    }

    // MARK: 3. 키패드 판의 바탕이 화면 아래 끝까지(iPhone 17), SE 는 그대로

    private static let safeProbe = """
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const safe = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    """

    func testKeypadPanelReachesScreenBottom() throws {
        let handle = AppHandle(name: "pad-bottom")
        handle.seedSession(answers: [:])
        handle.launch()
        handle.open("/input?input=keypad", route: "/input")
        Thread.sleep(forTimeInterval: 0.5)
        let info = handle.evaluate(Self.safeProbe + """
        const pad = document.querySelector('[data-testid="pad-panel"]') || document.querySelector('.pad');
        const r = pad.getBoundingClientRect();
        const keys = Array.from(pad.querySelectorAll('button')).map((b) => b.getBoundingClientRect().bottom);
        const dock = pad.closest('.dock');
        const cs = getComputedStyle(pad);
        return { bg: cs.backgroundColor, page: getComputedStyle(document.body).backgroundColor, padTop: r.top, padBottom: r.bottom,
                 innerHeight, innerWidth, safe, keysBottom: Math.max(...keys), padPaddingBottom: parseFloat(cs.paddingBottom),
                 dockPaddingBottom: dock ? parseFloat(getComputedStyle(dock).paddingBottom) : -1 };
        """) as? [String: Any] ?? [:]
        let shot = XCUIScreen.main.screenshot()
        handle.capture("키패드-아래끝", theme: "light")
        guard let grid = PixelGrid(shot), let padColor = PixelGrid.parseCSS(info["bg"] as? String ?? "") else {
            XCTFail("캡처나 판의 색을 읽지 못함: \(info)")
            return
        }
        let height = CGFloat(info["innerHeight"] as? Double ?? 0)
        let width = CGFloat(info["innerWidth"] as? Double ?? 0)
        let safe = CGFloat(info["safe"] as? Double ?? 0)
        // 맨 아래 줄(홈 표시 막대가 있는 가운데는 피한다)과 안전 영역의 가운데 줄에서 화소를 읽는다.
        let xs: [CGFloat] = [0.04, 0.15, 0.85, 0.96].map { $0 * width }
        let bottomRow = xs.map { grid.rgb(x: Int($0 * grid.scale), y: grid.height - 1) }
        let safeRow = safe > 0 ? xs.map { grid.rgb(at: CGPoint(x: $0, y: height - safe / 2)) } : []
        let worst = (bottomRow + safeRow).map { PixelGrid.distance($0, padColor) }.max() ?? 255
        XCTAssertLessThanOrEqual(worst, 3, "화면 맨 아래 줄의 색이 키패드 판의 바탕색(\(padColor))과 같다: \(bottomRow) \(safeRow)")
        XCTAssertEqual(info["padBottom"] as? Double ?? 0, Double(height), accuracy: 0.5, "판이 화면 아래 끝까지 이어진다")
        XCTAssertLessThanOrEqual(info["keysBottom"] as? Double ?? 999, Double(height - safe) + 0.5, "키는 홈 표시 줄(안전 영역) 위에 있다")
        if safe == 0 {
            XCTAssertEqual(info["padPaddingBottom"] as? Double ?? -1, 8, accuracy: 0.5, "안전 영역이 없는 기기(SE)는 판 아래 여백 8px 그대로")
        }
        let pageColor = PixelGrid.parseCSS(info["page"] as? String ?? "") ?? []

        // 키패드가 없는 화면(입력 확인)과 바텀시트의 아래 여백은 그대로 안전 영역을 쓴다.
        let other = AppHandle(name: "pad-bottom-review")
        other.seedSession(answers: ExampleA.answers)
        handle.terminate()
        other.launch()
        other.open("/review", route: "/review")
        let dock = other.evaluate(Self.safeProbe + """
        const d = document.querySelector('.dock');
        const last = d ? Array.from(d.querySelectorAll('button, a')).map((b) => b.getBoundingClientRect().bottom) : [];
        return { safe, dockPaddingBottom: d ? parseFloat(getComputedStyle(d).paddingBottom) : -1, dockBottom: d ? d.getBoundingClientRect().bottom : -1,
                 lastControlBottom: last.length ? Math.max(...last) : -1, innerHeight };
        """) as? [String: Any] ?? [:]
        let cell = other.reviewCell(2)
        XCTAssertTrue(cell.waitForExistence(timeout: 5))
        cell.tap()
        Thread.sleep(forTimeInterval: 0.8)
        let sheet = other.evaluate(Self.safeProbe + """
        const s = document.querySelector('[aria-modal="true"]');
        const box = s ? (s.querySelector('.sheet') || s) : null;
        const ctrls = box ? Array.from(box.querySelectorAll('button')).map((b) => b.getBoundingClientRect().bottom) : [];
        return { safe, sheetPaddingBottom: box ? parseFloat(getComputedStyle(box).paddingBottom) : -1, sheetBottom: box ? box.getBoundingClientRect().bottom : -1,
                 lastControlBottom: ctrls.length ? Math.max(...ctrls) : -1, innerHeight };
        """) as? [String: Any] ?? [:]
        other.capture("입력확인-시트-아래", theme: "light")
        let reviewSafe = dock["safe"] as? Double ?? 0
        record("키패드 판 아래 끝", ["padColor": padColor, "pageColor": pageColor, "bottomRow": bottomRow, "safeRow": safeRow, "worstDistance": worst, "pad": info, "reviewDock": dock, "sheet": sheet])
        // 키패드가 없는 화면의 아래 띠와 바텀시트의 아래 여백은 그대로 안전 영역 값이다(고치기 전과 같음, 웹 결정기록 7.3).
        XCTAssertEqual(dock["dockPaddingBottom"] as? Double ?? -1, reviewSafe, accuracy: 0.5, "키패드가 없는 화면의 아래 띠 여백은 안전 영역 값 그대로: \(dock)")
        XCTAssertEqual(other.modalCount(), 1, "입력 확인의 칸을 눌러 시트가 열렸다")
        XCTAssertGreaterThan(sheet["sheetBottom"] as? Double ?? -1, 0, "시트를 읽었다: \(sheet)")
        XCTAssertEqual(sheet["sheetPaddingBottom"] as? Double ?? -1, reviewSafe, accuracy: 0.5, "시트의 아래 여백은 안전 영역 값 그대로: \(sheet)")
        XCTAssertLessThanOrEqual(sheet["lastControlBottom"] as? Double ?? 999, (sheet["innerHeight"] as? Double ?? 0) - reviewSafe + 0.5, "시트의 버튼이 안전 영역 위에 있다: \(sheet)")
    }

    // MARK: 4. 점수 해부에서 목표 등급을 고른 뒤 첫 줄이 화면 안에

    private func anatomyGeometry(_ handle: AppHandle) -> [String: Double] {
        let raw = handle.evaluate("""
        const body = document.querySelector('main.body') || document.querySelector('.body');
        const line = document.querySelector('[data-testid="cut-actual"]');
        const dock = document.querySelector('.dock');
        const b = body.getBoundingClientRect();
        const l = line ? line.getBoundingClientRect() : { top: -1, bottom: -1 };
        return { scrollTop: body.scrollTop, bodyTop: b.top, bodyBottom: b.bottom, dockTop: dock ? dock.getBoundingClientRect().top : b.bottom, lineTop: l.top, lineBottom: l.bottom };
        """) as? [String: Any] ?? [:]
        return raw.compactMapValues { ($0 as? NSNumber)?.doubleValue }
    }

    private func visible(_ g: [String: Double]) -> Bool {
        let top = g["bodyTop"] ?? 0, bottom = min(g["bodyBottom"] ?? 0, g["dockTop"] ?? 0)
        return (g["lineTop"] ?? -1) >= top - 0.5 && (g["lineBottom"] ?? 9999) <= bottom + 0.5
    }

    func testAnatomyTargetGradeBringsFirstLineIntoView() throws {
        let handle = AppHandle(name: "anatomy-scroll")
        handle.seedSession(answers: ExampleA.answers)
        handle.launch()
        goToAnatomy(handle)
        _ = handle.evaluate("const b = document.querySelector('main.body') || document.querySelector('.body'); b.scrollTop = 0; return true;")
        Thread.sleep(forTimeInterval: 0.5)
        // 2등급 칩이 아래 띠에 가리지 않을 때까지 손가락으로 조금씩 민다(사람과 같게).
        let chip = handle.any("2등급")
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        for _ in 0..<6 {
            let g = anatomyGeometry(handle)
            if chip.isHittable, chip.frame.maxY < (g["dockTop"] ?? 0) - 4, chip.frame.minY > (g["bodyTop"] ?? 0) { break }
            handle.web.swipeUp(velocity: .slow)
            Thread.sleep(forTimeInterval: 0.6)
        }
        let before = anatomyGeometry(handle)
        XCTAssertFalse(visible(before), "고르기 전에는 첫 줄이 다 보이지 않는다(이 테스트가 보려는 상황): \(before)")
        Thread.sleep(forTimeInterval: 0.6)
        chip.tap()
        let early = anatomyGeometry(handle)
        Thread.sleep(forTimeInterval: 1.2)
        let after = anatomyGeometry(handle)
        handle.waitForText("3~7점 남았어요")
        XCTAssertTrue(visible(after), "고른 뒤 첫 줄이 화면 안에 다 보인다: \(after)")
        XCTAssertTrue(handle.element(labelContains: "3~7점 남았어요").exists, "첫 줄이 접근성 트리에 있다")
        handle.capture("점수해부-등급고른뒤", theme: "light")

        // 이미 보이면 움직이지 않는다.
        let third = handle.any("3등급")
        Thread.sleep(forTimeInterval: 0.6)
        third.tap()
        handle.waitForText("컷 범위보다 위예요")
        Thread.sleep(forTimeInterval: 1.0)
        let stay = anatomyGeometry(handle)
        XCTAssertEqual(stay["scrollTop"] ?? -1, after["scrollTop"] ?? -2, accuracy: 1, "첫 줄이 이미 보이면 움직이지 않는다")

        // 고른 자리를 곧바로 다시 누른 것이 막히는지는 FastTapTests.testAnatomyRepeatTapAfterScrollIsDiscarded 가 측정 중에 본다
        // (측정의 받지 않은 누름으로 막힘을 셀 수 있어서).
        record("점수 해부 목표 등급", ["before": before, "early": early, "after": after, "stay": stay])
    }

    // MARK: 5. 시험 선택의 예시 시험 C 설명이 "22~30번"과 "단답형" 사이에서 끊기지 않는다

    func testExamDescriptionKeepsRangeAndTypeTogether() throws {
        let handle = AppHandle(name: "exam-note")
        handle.launch()
        handle.open("/exams", route: "/exams")
        let info = handle.evaluate("""
        const host = Array.from(document.querySelectorAll('[role="radio"], button')).find((b) => (b.textContent || '').includes('예시 시험 C'));
        if (!host) return null;
        const chunks = Array.from(host.querySelectorAll('[data-testid="note-chunk"]'));
        const chunk = chunks.find((c) => c.textContent.includes('22~30번'));
        const range = document.createRange();
        range.selectNodeContents(chunk);
        const tops = Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top));
        return { text: chunk.textContent, lines: new Set(tops).size, chunkTop: Math.round(chunk.getBoundingClientRect().top),
                 firstTop: Math.round(chunks[0].getBoundingClientRect().top), chunks: chunks.map((c) => c.textContent), innerWidth };
        """) as? [String: Any]
        XCTAssertNotNil(info, "예시 시험 C 선택지")
        XCTAssertEqual(info?["text"] as? String, "22~30번 단답형")
        XCTAssertEqual(info?["lines"] as? Int, 1, "'22~30번 단답형' 이 한 줄 안에 있다")
        handle.capture("시험선택-설명", theme: "light")
        record("예시 시험 C 설명", info ?? [:])
    }

    // MARK: 5. 진행 막대 끝과 표시 화면 아래 단서(확대해서 보려고 찍는다)

    func testCapturesForProgressBarAndMarksCue() throws {
        for theme in ["light", "dark"] {
            let progress = AppHandle(name: "zoom-progress-\(theme)")
            progress.seedSession(answers: ExampleA.answers.filter { $0.key <= 17 })
            progress.launch(extra: ["-SAAppearance", theme])
            progress.open("/input?input=keypad", route: "/input")
            Thread.sleep(forTimeInterval: 0.6)
            let bar = progress.evaluate("const e = document.querySelector('.progress'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, label: e.getAttribute('aria-label') || '', value: e.getAttribute('aria-valuenow') || '' };") as? [String: Any]
            XCTAssertNotNil(bar, "진행 막대")
            progress.capture("줌-진행막대", theme: theme)
            progress.terminate()

            let marks = AppHandle(name: "zoom-marks-\(theme)")
            marks.seedSession(answers: ExampleA.answers)
            marks.launch(extra: ["-SAAppearance", theme])
            marks.open("/marks", route: "/marks")
            Thread.sleep(forTimeInterval: 0.6)
            let cueScript = "const d = document.querySelector('.dock'); if (!d) return null; const r = d.getBoundingClientRect(); return { more: d.classList.contains('dock--more') || d.hasAttribute('data-more') && d.getAttribute('data-more') !== 'false', top: r.top, h: r.height };"
            let top = marks.evaluate(cueScript) as? [String: Any]
            marks.capture("줌-표시-맨위", theme: theme)
            _ = marks.evaluate("const b = document.querySelector('main.body') || document.querySelector('.body'); b.scrollTop = b.scrollHeight; return true;")
            Thread.sleep(forTimeInterval: 0.8)
            let end = marks.evaluate(cueScript) as? [String: Any]
            marks.capture("줌-표시-끝", theme: theme)
            XCTAssertEqual(top?["more"] as? Bool, true, "\(theme): 맨 위에서는 아래 단서가 있다")
            XCTAssertEqual(end?["more"] as? Bool, false, "\(theme): 끝까지 내리면 아래 단서가 없다")
            marks.terminate()
            record("확대 캡처(\(theme))", ["progressBar": bar ?? [:], "dockTop": top ?? [:], "dockEnd": end ?? [:]])
        }
    }
}
