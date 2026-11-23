import XCTest

/// 화면 테스트의 결과 폴더와 실행 환경.
enum TestEnv {
    /// verify.sh 가 TEST_RUNNER_SA_OUT 으로 넘기는 결과 폴더. 없으면(Xcode 에서 바로 돌리면) 임시 폴더.
    static var outDirectory: URL {
        if let path = ProcessInfo.processInfo.environment["SA_OUT"], !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("sa-uitest-out", isDirectory: true)
    }

    /// 캡처 파일 이름에 쓰는 기기 이름. verify.sh 가 TEST_RUNNER_SA_DEVICE 로 넘긴다.
    static var deviceTag: String {
        ProcessInfo.processInfo.environment["SA_DEVICE"] ?? "device"
    }
}

/// 앱 하나를 켜고 다루는 도구. 기록 폴더와 탐침 폴더를 테스트마다 따로 만든다(DEBUG 전용 실행 인자).
@MainActor
final class AppHandle {
    let app = XCUIApplication()
    let runDirectory: URL
    var storeDirectory: URL { runDirectory.appendingPathComponent("store", isDirectory: true) }
    var probeDirectory: URL { runDirectory.appendingPathComponent("probe", isDirectory: true) }
    private var commandNumber = 0

    init(name: String) {
        let safe = name.replacingOccurrences(of: "[^A-Za-z0-9가-힣_-]", with: "-", options: .regularExpression)
        runDirectory = TestEnv.outDirectory.appendingPathComponent("runs", isDirectory: true)
            .appendingPathComponent("\(safe)-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? FileManager.default.createDirectory(at: storeDirectory, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: probeDirectory, withIntermediateDirectories: true)
    }

    /// 한국어, 대한민국으로 켠다(시뮬레이터 설정은 바꾸지 않는다).
    func launch(seed: String? = nil, extra: [String] = [], waitForStart: Bool = true) {
        var arguments = ["-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
                         "-SAStoreDir", storeDirectory.path, "-SAProbeDir", probeDirectory.path]
        if let seed { arguments += ["-SASeed", seed] }
        app.launchArguments = arguments + extra
        app.launch()
        if waitForStart {
            XCTAssertTrue(web.waitForExistence(timeout: 20), "웹뷰가 떠야 한다")
        }
    }

    func terminate() {
        app.terminate()
    }

    var web: XCUIElement { app.webViews.firstMatch }

    // MARK: 찾기

    func button(_ label: String) -> XCUIElement {
        web.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func element(labelContains text: String) -> XCUIElement {
        web.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    func staticText(_ text: String) -> XCUIElement {
        web.staticTexts.matching(NSPredicate(format: "label == %@", text)).firstMatch
    }

    /// 접근성 이름이 text 를 포함하는 글자가 화면에 나올 때까지 기다린다.
    @discardableResult
    func waitForText(_ text: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let element = web.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", text, text)).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "'\(text)' 가 보여야 한다", file: file, line: line)
        return element
    }

    // MARK: 기록 파일

    var storeFile: URL { storeDirectory.appendingPathComponent("store.json") }

    func storeJSON() -> [String: Any]? {
        guard let data = try? Data(contentsOf: storeFile) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// 기록 파일이 조건을 만족할 때까지 기다린다.
    func waitForStore(timeout: TimeInterval = 5, _ condition: ([String: Any]) -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let json = storeJSON(), condition(json) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
    }

    // MARK: 탐침(DEBUG 빌드의 명령 파일)

    /// 웹뷰 안에서 자바스크립트 함수 본문을 돌리고 돌려준 값을 받는다.
    func evaluate(_ body: String, timeout: TimeInterval = 10) -> Any? {
        commandNumber += 1
        let id = String(format: "%04d", commandNumber)
        let out = probeDirectory.appendingPathComponent("out-\(id).json")
        try? FileManager.default.removeItem(at: out)
        do {
            try Data(body.utf8).write(to: probeDirectory.appendingPathComponent("cmd-\(id).js"), options: .atomic)
        } catch {
            XCTFail("명령 파일을 쓰지 못함: \(error)")
            return nil
        }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let data = try? Data(contentsOf: out),
               let json = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? [String: Any] {
                if json["ok"] as? Bool == true { return json["value"] }
                XCTFail("탐침 오류: \(json["error"] ?? "")")
                return nil
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        XCTFail("탐침 응답 없음: \(body.prefix(80))")
        return nil
    }

    func probeFile(_ name: String, timeout: TimeInterval = 30) -> [String: Any]? {
        let url = probeDirectory.appendingPathComponent(name)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let data = try? Data(contentsOf: url),
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                return json
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return nil
    }

    func shellStats() -> [String: Any] {
        let url = probeDirectory.appendingPathComponent("shell-stats.json")
        guard let data = try? Data(contentsOf: url) else { return [:] }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
    }

    // MARK: 캡처

    /// 화면 전체를 찍어 결과 폴더(screens/기기/테마/번호-이름.png)와 테스트 결과에 남긴다.
    func capture(_ name: String, theme: String, activity: XCTActivity? = nil) {
        let shot = XCUIScreen.main.screenshot()
        let folder = TestEnv.outDirectory.appendingPathComponent("screens", isDirectory: true)
            .appendingPathComponent(TestEnv.deviceTag, isDirectory: true)
            .appendingPathComponent(theme, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: folder.appendingPathComponent("\(name).png"))
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "\(TestEnv.deviceTag)-\(theme)-\(name)"
        attachment.lifetime = .keepAlways
        activity?.add(attachment)
    }

    /// 접근성 트리를 파일로 남긴다(실패를 살필 때 쓴다).
    func dumpTree(_ name: String) {
        let url = runDirectory.appendingPathComponent("tree-\(name).txt")
        try? app.debugDescription.write(to: url, atomically: true, encoding: .utf8)
    }
}
