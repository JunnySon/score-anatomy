import XCTest

/// 작업 지시서 7장의 검산 예시(예시 시험 A). 단위 테스트와 웹의 "예시 결과 보기"가 쓰는 값과 같다.
enum ExampleA {
    /// 넣는 답. 11, 15, 20, 21, 27, 29번이 틀린 답이고 나머지 24문항은 정답이다.
    static let answers: [Int: Int] = [
        1: 3, 2: 5, 3: 2, 4: 4, 5: 1, 6: 3, 7: 5, 8: 2, 9: 4, 10: 1,
        11: 4, 12: 5, 13: 3, 14: 1, 15: 1, 16: 2, 17: 4, 18: 5, 19: 1, 20: 3,
        21: 5, 22: 12, 23: 7, 24: 36, 25: 150, 26: 24, 27: 146, 28: 9, 29: 275, 30: 48,
    ]
    /// 찍음 표시: 9, 14번은 정답, 11, 20, 21번은 틀림.
    static let guesses = [9, 11, 14, 20, 21]
    /// 원인 "풀 줄 아는데 틀렸어요": 15, 29번. 나머지 틀린 문항은 "풀이가 안 떠올랐어요".
    static let slips = [15, 29]
    static let wrong = [11, 15, 20, 21, 27, 29]
    static let lastChoiceItem = 21

    static func isShort(_ no: Int) -> Bool { no > lastChoiceItem }
}

/// 화면을 누르는 도구. 모두 XCUITest 의 실제 누름이다. 탐침은 화면 밖으로 스크롤된 요소를 보이게 할 때와 확인할 때만 쓴다.
@MainActor
extension AppHandle {
    func exact(_ label: String) -> NSPredicate { NSPredicate(format: "label == %@", label) }

    var keypad: XCUIElement { web.otherElements.matching(exact("답 키패드")).firstMatch }

    /// 문항 번호(큰 숫자) "12번".
    func nowNumber(_ no: Int) -> XCUIElement { web.staticTexts.matching(exact("\(no)번")).firstMatch }

    /// 답 입력 화면의 칸 "9번 칸, ...".
    func inputCell(_ no: Int) -> XCUIElement {
        web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(no)번 칸,")).firstMatch
    }

    /// 표시 화면의 5지선다 칸 "9번, 넣은 답 4, 표시 없음".
    func markCell(_ no: Int) -> XCUIElement {
        web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(no)번, 넣은 답")).firstMatch
    }

    /// 접근성 이름이 정확히 label 인 요소(종류는 가리지 않는다).
    func any(_ label: String) -> XCUIElement {
        web.descendants(matching: .any).matching(exact(label)).firstMatch
    }

    /// 키패드의 키를 누른다. 바로 앞에 같은 키를 눌렀으면 연달아 누르기 보호(0.5초)가 풀린 뒤에 누른다.
    func tapKey(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
        let key = keypad.buttons.matching(exact(label)).firstMatch
        XCTAssertTrue(key.waitForExistence(timeout: 5), "키 '\(label)' 가 있어야 한다", file: file, line: line)
        if lastKeyLabel == label {
            let gap = Date().timeIntervalSince(lastKeyTime)
            if gap < 0.65 { Thread.sleep(forTimeInterval: 0.65 - gap) }
        }
        key.tap()
        lastKeyLabel = label
        lastKeyTime = Date()
    }

    /// 시작 화면에서 예시 시험 A 를 골라 답 입력 화면까지 간다.
    func startExampleA(file: StaticString = #filePath, line: UInt = #line) {
        let pick = button("시험 고르기")
        XCTAssertTrue(pick.waitForExistence(timeout: 20), "시작 화면", file: file, line: line)
        pick.tap()
        let exam = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "예시 시험 A")).firstMatch
        XCTAssertTrue(exam.waitForExistence(timeout: 10), "시험 선택 화면", file: file, line: line)
        exam.tap()
        let notYet = any("아직 안 했어요")
        XCTAssertTrue(notYet.waitForExistence(timeout: 5), file: file, line: line)
        notYet.tap()
        button("답 넣기").tap()
        XCTAssertTrue(nowNumber(1).waitForExistence(timeout: 10), "답 입력 화면의 1번", file: file, line: line)
    }

    /// 키패드 방식으로 from 부터 to 까지 답을 넣는다.
    func enterAnswers(_ answers: [Int: Int] = ExampleA.answers, from: Int, to: Int, file: StaticString = #filePath, line: UInt = #line) {
        for no in from...to {
            XCTAssertTrue(nowNumber(no).waitForExistence(timeout: 5), "\(no)번 차례여야 한다", file: file, line: line)
            guard let value = answers[no] else { continue }
            if ExampleA.isShort(no) {
                for digit in String(value) { tapKey(String(digit), file: file, line: line) }
                tapKey("다음", file: file, line: line)
            } else {
                tapKey("\(value)", file: file, line: line)
            }
        }
    }

    /// 화면 밖에 있으면 보이게 한다(사람이 스크롤하는 것과 같은 결과). 먼저 손가락으로 밀어 보고, 안 되면 탐침으로 스크롤한다.
    func reveal(_ element: XCUIElement, label: String? = nil) {
        if element.exists && element.isHittable { return }
        for _ in 0..<4 {
            web.swipeUp(velocity: .slow)
            if element.exists && element.isHittable { return }
        }
        if let label {
            _ = evaluate("""
            const want = \(jsString(label));
            const all = Array.from(document.querySelectorAll('button, a, [role], p, span, h1, h2, h3, li'));
            const el = all.find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === want);
            if (el) el.scrollIntoView({ block: 'center' });
            return !!el;
            """)
        }
    }

    func jsString(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }

    /// 웹 요소를 화면 가운데로 옮긴 뒤 누른다. 아래에 고정된 버튼이 요소를 가릴 수 있는 작은 화면에서 쓴다
    /// (XCUITest 는 웹 안의 겹침을 몰라서, 가려진 요소도 누를 수 있다고 본다).
    func tapCentered(_ element: XCUIElement, selector: String, file: StaticString = #filePath, line: UInt = #line) {
        let found = evaluate("const e = document.querySelector(\(jsString(selector))); if (e) e.scrollIntoView({ block: 'center' }); return !!e;") as? Bool
        XCTAssertEqual(found, true, "\(selector) 가 있어야 한다", file: file, line: line)
        Thread.sleep(forTimeInterval: 0.4)
        XCTAssertTrue(element.waitForExistence(timeout: 5), "\(selector) 를 누를 수 있어야 한다", file: file, line: line)
        element.tap()
    }

    /// 표시 화면에서 찍음(두 번 누름)을 붙인다.
    func setGuess(_ no: Int, file: StaticString = #filePath, line: UInt = #line) {
        let cell = markCell(no)
        reveal(cell)
        cell.tap()
        XCTAssertTrue(waitLabel(cell, contains: "고민"), "\(no)번 고민", file: file, line: line)
        cell.tap()
        XCTAssertTrue(waitLabel(cell, contains: "찍음"), "\(no)번 찍음", file: file, line: line)
    }

    func waitLabel(_ element: XCUIElement, contains text: String, timeout: TimeInterval = 5) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists, element.label.contains(text) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
    }

    /// 오답 원인 화면에서 문항의 원인을 고른다.
    func chooseCause(_ no: Int, _ option: String, file: StaticString = #filePath, line: UInt = #line) {
        let group = web.otherElements.matching(exact("\(no)번을 틀린 원인")).firstMatch
        var target = group.descendants(matching: .any).matching(exact(option)).firstMatch
        if !target.waitForExistence(timeout: 3) {
            // 묶음이 접근성 트리에 따로 없으면 DOM 의 data-testid 로 보이게 한 뒤 같은 이름의 요소를 찾는다.
            _ = evaluate("const e = document.querySelector('[data-testid=\"cause-\(no)-\(causeKey(option))\"]'); if (e) e.scrollIntoView({ block: 'center' }); return !!e;")
            target = group.descendants(matching: .any).matching(exact(option)).firstMatch
        }
        _ = evaluate("const e = document.querySelector('[data-testid=\"cause-\(no)-\(causeKey(option))\"]'); if (e) e.scrollIntoView({ block: 'center' }); return !!e;")
        XCTAssertTrue(target.waitForExistence(timeout: 5), "\(no)번 원인 '\(option)'", file: file, line: line)
        target.tap()
        let checked = evaluate("const e = document.querySelector('[data-testid=\"cause-\(no)-\(causeKey(option))\"]'); return e ? e.getAttribute('aria-checked') : null;") as? String
        XCTAssertEqual(checked, "true", "\(no)번 원인을 골랐다", file: file, line: line)
    }

    private func causeKey(_ option: String) -> String {
        switch option {
        case "풀 줄 아는데 틀렸어요": return "slip"
        case "풀이가 안 떠올랐어요": return "blank"
        default: return "unknown"
        }
    }

    /// DOM 의 글자(textContent). 접근성 확인과 함께 쓴다.
    func domText(_ selector: String) -> String? {
        evaluate("const e = document.querySelector(\(jsString(selector))); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null;") as? String
    }

    func hash() -> String? {
        evaluate("return location.hash;") as? String
    }

    /// 지금 웹 화면의 주소(# 뒤)가 path 가 될 때까지 기다린다.
    func waitForRoute(_ path: String, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(timeout)
        var last: String?
        while Date() < deadline {
            last = evaluate("return document.documentElement.getAttribute('data-route');", timeout: 5) as? String
            if last == path { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
        XCTFail("화면이 \(path) 가 되어야 한다(지금 \(last ?? "알 수 없음"))", file: file, line: line)
    }

    /// 표시 화면까지(예시 답 30개를 넣고 입력 확인을 넘긴다).
    func goToMarksWithExampleAnswers(file: StaticString = #filePath, line: UInt = #line) {
        startExampleA(file: file, line: line)
        enterAnswers(from: 1, to: 30, file: file, line: line)
        XCTAssertTrue(any("넣은 답을 확인해 주세요").waitForExistence(timeout: 8), "입력 확인 화면", file: file, line: line)
        let next = button("맞아요, 다음으로")
        reveal(next)
        next.tap()
        XCTAssertTrue(markCell(9).waitForExistence(timeout: 8), "표시 화면", file: file, line: line)
    }

    /// 기록 파일의 첫 기록의 답.
    func storedAnswers() -> [Int: Any] {
        guard let sessions = storeJSON()?["sessions"] as? [[String: Any]], let first = sessions.first,
              let answers = first["answers"] as? [String: Any] else { return [:] }
        var result: [Int: Any] = [:]
        for (key, value) in answers { if let no = Int(key) { result[no] = value } }
        return result
    }
}

/// 좌표를 정해진 간격으로 직접 누른다(사람 손 박자). 보호가 풀리기를 기다리지 않는다.
/// XCUITest 의 누름은 한 번에 시간이 걸려서, 누름 시작 사이의 실제 간격을 재서 돌려준다.
@MainActor
func tapRhythm(_ app: XCUIApplication, points: [CGPoint], gap: TimeInterval) -> [TimeInterval] {
    let origin = app.coordinate(withNormalizedOffset: .zero)
    var starts: [Date] = []
    for (index, point) in points.enumerated() {
        if index > 0, let previous = starts.last {
            let wait = gap - Date().timeIntervalSince(previous)
            if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        }
        starts.append(Date())
        origin.withOffset(CGVector(dx: point.x, dy: point.y)).tap()
    }
    return zip(starts.dropFirst(), starts).map { $0.timeIntervalSince($1) }
}

@MainActor
func center(_ element: XCUIElement) -> CGPoint {
    CGPoint(x: element.frame.midX, y: element.frame.midY)
}

/// 결과 폴더에 숫자 기록을 한 줄씩 남긴다(verify.sh 가 docs/ios_검증결과.md 에 옮긴다).
func recordMetric(_ record: [String: Any]) {
    let url = TestEnv.outDirectory.appendingPathComponent("metrics.jsonl")
    try? FileManager.default.createDirectory(at: TestEnv.outDirectory, withIntermediateDirectories: true)
    var line = (try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])) ?? Data()
    line.append(0x0A)
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(line)
        try? handle.close()
    } else {
        try? line.write(to: url)
    }
}
