import XCTest

/// 6-12 접근성 감사(기록용): 시작, 답 입력, 점수 해부, 계단 화면에서 performAccessibilityAudit 을 돌려 걸린 것을 남긴다.
/// 걸린 것은 실패로 치지 않고 accessibility-audit.json 에 적는다(verify.sh 가 문서에 옮긴다).
@MainActor
final class AccessibilityAuditTests: XCTestCase {
    private final class Collected {
        var items: [[String: Any]] = []
    }

    private static func typeName(_ type: XCUIAccessibilityAuditType) -> String {
        let names: [(XCUIAccessibilityAuditType, String)] = [
            (.contrast, "contrast"), (.elementDetection, "elementDetection"), (.hitRegion, "hitRegion"),
            (.sufficientElementDescription, "sufficientElementDescription"), (.dynamicType, "dynamicType"),
            (.textClipped, "textClipped"), (.trait, "trait"),
        ]
        let found = names.filter { type.contains($0.0) }.map { $0.1 }
        return found.isEmpty ? "other(\(type.rawValue))" : found.joined(separator: ",")
    }

    private func audit(_ handle: AppHandle, screen: String, into report: inout [[String: Any]]) {
        let collected = Collected()
        Thread.sleep(forTimeInterval: 0.8)
        do {
            try handle.app.performAccessibilityAudit(for: .all) { issue in
                collected.items.append([
                    "type": Self.typeName(issue.auditType),
                    "summary": issue.compactDescription,
                    "detail": issue.detailedDescription,
                    "element": issue.element?.label ?? "",
                    "elementType": issue.element.map { "\($0.elementType.rawValue)" } ?? "",
                ])
                // 기록용이라 실패로 치지 않는다.
                return true
            }
            // 감사가 작다고 본 링크의 실제 누름 영역(웹 요소의 크기)을 함께 남긴다.
            let targets = handle.evaluate("return Array.from(document.querySelectorAll('.tab')).map((e) => { const r = e.getBoundingClientRect(); return { label: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; });") as? [[String: Any]] ?? []
            report.append(["screen": screen, "ran": true, "issues": collected.items, "domTargets": targets])
        } catch {
            report.append(["screen": screen, "ran": false, "error": "\(error)", "issues": collected.items])
            XCTFail("\(screen) 감사를 돌리지 못했다: \(error)")
        }
    }

    func testAuditKeyScreens() throws {
        continueAfterFailure = false
        var report: [[String: Any]] = []
        let handle = AppHandle(name: "audit")
        handle.launch()
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20))
        audit(handle, screen: "시작", into: &report)

        handle.startExampleA()
        handle.enterAnswers(from: 1, to: 3)
        audit(handle, screen: "답 입력", into: &report)

        handle.enterAnswers(from: 4, to: 30)
        XCTAssertTrue(handle.any("넣은 답을 확인해 주세요").waitForExistence(timeout: 8))
        let next = handle.button("맞아요, 다음으로")
        handle.reveal(next)
        next.tap()
        XCTAssertTrue(handle.markCell(9).waitForExistence(timeout: 8))
        for no in ExampleA.guesses { handle.setGuess(no) }
        handle.button("채점하기").tap()
        XCTAssertTrue(handle.button("점수 해부 바로 보기").waitForExistence(timeout: 8))
        handle.button("점수 해부 바로 보기").tap()
        handle.waitForRoute("/anatomy")
        let grade2 = handle.any("2등급")
        handle.reveal(grade2, label: "2등급")
        grade2.tap()
        handle.waitForText("3~7점 남았어요")
        _ = handle.evaluate("const b = document.querySelector('main.body'); if (b) b.scrollTop = 0; return true;")
        audit(handle, screen: "점수 해부", into: &report)

        let toSteps = handle.web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "고칠 것")).firstMatch
        handle.reveal(toSteps)
        toSteps.tap()
        XCTAssertTrue(handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "먼저 고칠")).firstMatch.waitForExistence(timeout: 8))
        audit(handle, screen: "계단", into: &report)

        let url = TestEnv.outDirectory.appendingPathComponent("accessibility-audit-\(TestEnv.deviceTag).json")
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url)
        XCTAssertEqual(report.filter { ($0["ran"] as? Bool) == true }.count, 4, "네 화면 모두 감사를 돌렸다")
    }
}

/// 6-13 캡처: 화면 9개를 밝은 화면과 어두운 화면으로 남긴다(기기는 verify.sh 가 고른다).
@MainActor
final class CaptureTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// 화면, 테마, 기기별로 남길 캡처 목록. verify.sh 가 빠진 것과 겹친 것을 이 목록으로 검사한다.
    static let screens = ["01-시작", "02-시험선택", "03-답입력-키패드", "04-잠금", "05-입력확인", "06-표시", "07-점수해부", "08-계단", "09-기록"]

    func testCaptureLight() throws {
        try captureAll(theme: "light")
    }

    func testCaptureDark() throws {
        try captureAll(theme: "dark")
    }

    private func shot(_ handle: AppHandle, _ name: String, _ theme: String) {
        // 화면 전환(150~200ms)과 연달아 누르기 보호 표시가 끝난 뒤에 찍는다.
        Thread.sleep(forTimeInterval: 0.9)
        XCTAssertTrue(Self.screens.contains(name), "목록에 없는 캡처 이름: \(name)")
        handle.capture(name, theme: theme)
    }

    private func toTop(_ handle: AppHandle) {
        _ = handle.evaluate("const b = document.querySelector('main.body'); if (b) b.scrollTop = 0; window.scrollTo(0, 0); return true;")
    }

    private func captureAll(theme: String) throws {
        XCUIDevice.shared.appearance = theme == "dark" ? .dark : .light
        defer { XCUIDevice.shared.appearance = .light }
        // 기기 설정이 바뀌는 데 잠깐 걸린다.
        Thread.sleep(forTimeInterval: 2.0)
        let handle = AppHandle(name: "capture-\(theme)")
        handle.launch()
        var prefersDark: Bool?
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            prefersDark = handle.evaluate("return matchMedia('(prefers-color-scheme: dark)').matches;") as? Bool
            if prefersDark == (theme == "dark") { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertEqual(prefersDark, theme == "dark", "웹이 기기의 밝기 설정을 따른다")
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20))
        shot(handle, "01-시작", theme)

        handle.button("시험 고르기").tap()
        XCTAssertTrue(handle.any("어떤 시험을 넣을까요?").waitForExistence(timeout: 8))
        shot(handle, "02-시험선택", theme)

        let exam = handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "예시 시험 A")).firstMatch
        exam.tap()
        handle.any("아직 안 했어요").tap()
        handle.button("답 넣기").tap()
        handle.enterAnswers(from: 1, to: 11)
        XCTAssertTrue(handle.nowNumber(12).waitForExistence(timeout: 5))
        shot(handle, "03-답입력-키패드", theme)

        handle.inputCell(9).tap()
        XCTAssertTrue(handle.nowNumber(9).waitForExistence(timeout: 3))
        handle.tapKey("4")
        handle.waitForText("9번에 답을 넣었어요. 다음에 할 일을 골라 주세요.")
        shot(handle, "04-잠금", theme)

        handle.button("12번부터 이어서 넣기").tap()
        handle.enterAnswers(from: 12, to: 30)
        XCTAssertTrue(handle.any("넣은 답을 확인해 주세요").waitForExistence(timeout: 8))
        toTop(handle)
        shot(handle, "05-입력확인", theme)

        let next = handle.button("맞아요, 다음으로")
        handle.reveal(next)
        next.tap()
        XCTAssertTrue(handle.markCell(9).waitForExistence(timeout: 8))
        // 웹 캡처(22-표시-붙임)처럼 검산 예시의 찍음에 고민(5번)과 자신 없음(25번)을 더하고 시간 질문에 답한다.
        for no in ExampleA.guesses { handle.setGuess(no) }
        let cell5 = handle.markCell(5)
        cell5.tap()
        XCTAssertTrue(handle.waitLabel(cell5, contains: "고민"))
        // 단답형 표시는 눌림 상태가 있는 버튼(aria-pressed)이라 종류를 가리지 않고 찾는다.
        let short25 = handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "25번,")).firstMatch
        handle.reveal(short25)
        short25.tap()
        XCTAssertTrue(handle.waitLabel(short25, contains: "자신 없음"))
        let tight = handle.any("빠듯했어요")
        handle.reveal(tight)
        tight.tap()
        toTop(handle)
        shot(handle, "06-표시", theme)

        let grade = handle.button("채점하기")
        handle.reveal(grade)
        grade.tap()
        XCTAssertTrue(handle.button("틀린 문항 살펴보기").waitForExistence(timeout: 8))
        handle.button("틀린 문항 살펴보기").tap()
        for no in ExampleA.wrong {
            handle.chooseCause(no, ExampleA.slips.contains(no) ? "풀 줄 아는데 틀렸어요" : "풀이가 안 떠올랐어요")
        }
        let toAnatomy = handle.button("점수 해부 보기")
        handle.reveal(toAnatomy)
        toAnatomy.tap()
        handle.waitForRoute("/anatomy")
        let grade2 = handle.any("2등급")
        handle.reveal(grade2, label: "2등급")
        grade2.tap()
        handle.waitForText("3~7점 남았어요")
        toTop(handle)
        shot(handle, "07-점수해부", theme)

        let toSteps = handle.button("고칠 것 3가지 보기")
        handle.reveal(toSteps)
        toSteps.tap()
        XCTAssertTrue(handle.any("먼저 고칠 3가지").waitForExistence(timeout: 8))
        toTop(handle)
        shot(handle, "08-계단", theme)

        handle.web.links.matching(handle.exact("기록")).firstMatch.tap()
        handle.waitForRoute("/history")
        toTop(handle)
        shot(handle, "09-기록", theme)
    }
}
