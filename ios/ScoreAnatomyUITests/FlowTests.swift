import XCTest

/// 6-3 화면 흐름: 예시 시험 A 를 검산 예시대로 실제로 눌러 넣고 점수 해부와 계단을 확인한다.
@MainActor
final class FlowTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testExampleAFlow() throws {
        let handle = AppHandle(name: "flow")
        handle.launch()
        let started = Date()

        // 답 30개(5지선다 21개, 단답형 9개)를 키패드로 넣는다.
        handle.goToMarksWithExampleAnswers()
        let stored = handle.storedAnswers()
        for (no, value) in ExampleA.answers {
            XCTAssertEqual(stored[no] as? Int, value, "store.json 의 \(no)번 답")
        }
        // 받아들인 키 누름마다 saHaptic 한 번: 5지선다 21번, 단답형 숫자 19번과 "다음" 9번.
        let digits = (22...30).reduce(0) { $0 + String(ExampleA.answers[$1]!).count }
        let expectedHaptics = 21 + digits + 9
        let haptics = (handle.shellStats()["received"] as? [String: Int])?["saHaptic"] ?? -1
        XCTAssertEqual(haptics, expectedHaptics, "키패드에서 받아들인 누름 수만큼 햅틱 메시지")

        // 표시: 찍음 9, 11, 14, 20, 21번.
        for no in ExampleA.guesses { handle.setGuess(no) }
        let grade = handle.button("채점하기")
        handle.reveal(grade)
        grade.tap()

        // 점수
        XCTAssertTrue(handle.staticText("78점").waitForExistence(timeout: 8), "점수 78점")
        XCTAssertTrue(handle.any("30문항 가운데 24문항을 맞혔어요.").exists)
        handle.button("틀린 문항 살펴보기").tap()

        // 오답 원인: 15, 29번은 "풀 줄 아는데 틀렸어요", 나머지는 "풀이가 안 떠올랐어요".
        XCTAssertTrue(handle.any("틀린 문항을 살펴봐요").waitForExistence(timeout: 8), "오답 원인 화면")
        for no in ExampleA.wrong {
            handle.chooseCause(no, ExampleA.slips.contains(no) ? "풀 줄 아는데 틀렸어요" : "풀이가 안 떠올랐어요")
        }
        let toAnatomy = handle.button("점수 해부 보기")
        handle.reveal(toAnatomy)
        toAnatomy.tap()

        // 점수 해부: 78점, 7점, 8점.
        handle.waitForRoute("/anatomy")
        XCTAssertTrue(handle.staticText("78점").waitForExistence(timeout: 5), "주 숫자 78점")
        XCTAssertTrue(handle.staticText("7점").exists, "추측했다고 표시한 정답 7점")
        XCTAssertTrue(handle.staticText("8점").exists, "실수라고 표시한 오답 8점")
        XCTAssertEqual(handle.domText("[data-testid=row-guess] .num"), "7점")
        XCTAssertEqual(handle.domText("[data-testid=row-slip] .num"), "8점")
        XCTAssertTrue(handle.any("78점 가운데 7점은 찍었다고 표시한 문항에서 나왔어요.").exists || handle.element(labelContains: "7점은 찍었다고 표시한 문항에서").exists)

        // 2등급: "3~7점", "약 75점", "6~10점".
        handle.tapCentered(handle.any("2등급"), selector: "[data-testid=grade-2]")
        handle.waitForText("3~7점 남았어요")
        XCTAssertEqual(handle.domText("[data-testid=cut-actual]"), "실제 78점 기준 3~7점 남았어요")
        handle.waitForText("약 75점")
        XCTAssertTrue(handle.element(labelContains: "6~10점").exists, "둘째 줄 6~10점")
        let luck2 = handle.domText("[data-testid=cut-luck]") ?? ""
        XCTAssertTrue(luck2.contains("약 75점") && luck2.contains("6~10점"), "둘째 줄: \(luck2)")

        // 3등급: 첫 줄 "컷 범위보다 위예요", 둘째 줄 "컷 범위 안".
        handle.tapCentered(handle.any("3등급"), selector: "[data-testid=grade-3]")
        handle.waitForText("컷 범위보다 위예요")
        XCTAssertEqual(handle.domText("[data-testid=cut-actual]"), "컷 범위보다 위예요.")
        let luck3 = handle.domText("[data-testid=cut-luck]") ?? ""
        XCTAssertTrue(luck3.contains("컷 범위 안"), "3등급 둘째 줄: \(luck3)")
        XCTAssertTrue(handle.element(labelContains: "컷 범위 안").exists)

        // 계단 3개와 카드 표기.
        handle.tapCentered(handle.any("2등급"), selector: "[data-testid=grade-2]")
        let toSteps = handle.button("고칠 것 3가지 보기")
        handle.reveal(toSteps)
        XCTAssertTrue(toSteps.waitForExistence(timeout: 5), "주 버튼 '고칠 것 3가지 보기'")
        toSteps.tap()
        XCTAssertTrue(handle.any("먼저 고칠 3가지").waitForExistence(timeout: 8), "계단 제목")
        let cards = handle.evaluate("return Array.from(document.querySelectorAll('[data-testid^=\"step-\"][data-type]')).map((c) => ({ name: c.querySelector('h3').textContent.trim(), points: c.querySelector('[data-testid=step-points]').textContent.trim() }));") as? [[String: Any]] ?? []
        XCTAssertEqual(cards.count, 3, "계단 3개")
        XCTAssertEqual(cards.map { $0["name"] as? String ?? "" }, ["1. 적분", "2. 수열", "3. 확률"], "적분 12점, 수열 8점, 확률 6점 순")
        XCTAssertEqual(cards.map { $0["points"] as? String ?? "" }, ["놓친 배점 8점, 찍었다고 표시한 정답 4점", "놓친 배점 8점", "놓친 배점 3점, 찍었다고 표시한 정답 3점"])
        XCTAssertTrue(handle.any("놓친 배점 8점, 찍었다고 표시한 정답 4점").exists, "카드 표기가 화면에 보인다")

        // 좌표 복사: saCopy 하나에 copied 하나, 웹은 "좌표를 복사했어요."
        let copy = handle.button("좌표 복사")
        if copy.waitForExistence(timeout: 3) {
            handle.reveal(copy)
            copy.tap()
            handle.waitForText("좌표를 복사했어요.")
            let sent = handle.shellStats()["sent"] as? [String] ?? []
            XCTAssertTrue(sent.contains("{\"ok\":true,\"type\":\"copied\"}"), "copied(ok: true) 를 보냈다: \(sent.suffix(3))")
        } else {
            XCTFail("계단 화면에 좌표 복사 버튼이 있어야 한다")
        }

        // 웹 저장소를 쓰지 않는다(기록은 store.json 에만).
        let state = handle.evaluate("let n = -1; try { n = localStorage.length; } catch (e) {} return { ls: n, cookie: document.cookie, cls: document.documentElement.className };") as? [String: Any]
        XCTAssertEqual(state?["ls"] as? Int, 0, "localStorage 를 쓰지 않는다")
        XCTAssertEqual(state?["cookie"] as? String, "")
        XCTAssertTrue((handle.storeJSON()?["sessions"] as? [[String: Any]])?.first?["gradedAt"] is String, "채점한 기록이 store.json 에 있다")

        recordMetric(["kind": "flow", "device": TestEnv.deviceTag, "seconds": Date().timeIntervalSince(started), "haptics": haptics, "steps": cards.count])
    }
}
