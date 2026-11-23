import XCTest

/// 웹뷰 안의 접근성 트리를 파일로 남기는 살펴보기용 테스트. verify.sh 는 돌리지 않는다.
@MainActor
final class ExploreTests: XCTestCase {
    func testDumpTrees() throws {
        let handle = AppHandle(name: "explore")
        handle.launch()
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20))
        handle.dumpTree("start")
        _ = handle.evaluate("return document.title;")
        if let state = handle.evaluate(DebugStateProbe.body) { print("SA_STATE \(state)") }
        handle.button("시험 고르기").tap()
        sleep(1)
        handle.dumpTree("exams")
        let examA = handle.element(labelContains: "예시 시험 A")
        XCTAssertTrue(examA.waitForExistence(timeout: 5))
        examA.tap()
        sleep(1)
        handle.dumpTree("exams-picked")
        handle.element(labelContains: "아직 안 했어요").tap()
        handle.button("답 넣기").tap()
        sleep(1)
        handle.dumpTree("input")
        print("SA_RUN_DIR \(handle.runDirectory.path)")
    }
}

/// 웹 환경을 읽는 탐침 본문.
enum DebugStateProbe {
    static let body = """
    return { title: document.title, hash: location.hash, cls: document.documentElement.className, font: getComputedStyle(document.documentElement).fontSize, ls: (function(){ try { return localStorage.length; } catch (e) { return -1; } })(), w: innerWidth, h: innerHeight };
    """
}
