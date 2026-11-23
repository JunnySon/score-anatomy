import Network
import XCTest

/// 시험용 수신기: 이 맥의 주소(127.0.0.1)에서 기다리며 들어온 연결을 센다. 앱이 바깥으로 요청을 보내면 여기에 닿는다.
/// 시험 코드에만 있다(앱 껍데기에는 네트워크 API 가 없다).
final class LoopbackListener: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "sa.loopback")
    private let lock = NSLock()
    private var count = 0
    private var lines: [String] = []

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
    }

    var port: UInt16 { listener.port?.rawValue ?? 0 }

    var connections: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    var firstLines: [String] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }

    func start() -> Bool {
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.signal() }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        return ready.wait(timeout: .now() + 5) == .success && port != 0
    }

    func stop() {
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        lock.lock()
        count += 1
        lock.unlock()
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 512) { [weak self] data, _, _, _ in
            let text = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
            self?.lock.lock()
            self?.lines.append(String(text.split(separator: "\r\n").first ?? "(TLS 또는 빈 요청)"))
            self?.lock.unlock()
            connection.cancel()
        }
    }
}

/// 6-6 통신: 웹뷰 안에서 바깥 주소를 부르는 탐침이 막힌다.
@MainActor
final class NetworkProbeTests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func runProbe(control: Bool) throws -> (Int, [String: Any], [String: Any], [String]) {
        let listener = try LoopbackListener()
        XCTAssertTrue(listener.start(), "시험용 수신기가 떠야 한다")
        defer { listener.stop() }
        let handle = AppHandle(name: control ? "network-control" : "network-blocked")
        var extra = ["-SAProbe", "network", "-SAProbePort", "\(listener.port)"]
        if control { extra.append("-SAProbeControl") }
        handle.launch(extra: extra)
        let output = try XCTUnwrap(handle.probeFile("probe-network.json", timeout: 90), "탐침 결과")
        XCTAssertEqual(output["ok"] as? Bool, true, "탐침이 끝까지 돌았다: \(output)")
        Thread.sleep(forTimeInterval: 1.5)
        let value = output["value"] as? [String: Any] ?? [:]
        return (listener.connections, value, handle.shellStats(), listener.firstLines)
    }

    func testRequestsToOutsideAreBlocked() throws {
        let (connections, value, stats, lines) = try runProbe(control: false)
        XCTAssertEqual(connections, 0, "바깥으로 나간 요청이 없어야 한다: \(lines)")
        XCTAssertEqual(value["stillOnDocument"] as? Bool, true, "처음 문서에 머문다: \(value["href"] ?? "")")
        XCTAssertEqual(value["windowOpenReturnedNull"] as? Bool, true, "새 창을 열지 않는다")
        for key in ["fetch", "fetchHttps", "xhr", "image", "script", "style", "websocket", "eventSource"] {
            let outcome = "\(value[key] ?? "")"
            XCTAssertFalse(outcome == "loaded" || outcome == "open", "\(key) 가 성공하면 안 된다: \(outcome)")
        }
        let navigations = stats["blockedNavigations"] as? [String] ?? []
        let windows = stats["blockedWindows"] as? [String] ?? []
        XCTAssertGreaterThanOrEqual(navigations.count, 3, "링크, location, form 이동을 껍데기가 취소했다: \(navigations)")
        XCTAssertGreaterThanOrEqual(windows.count, 1, "새 창 요청을 껍데기가 막았다: \(windows)")
        recordMetric(["kind": "network", "mode": "blocked", "connections": connections, "outcomes": value, "blockedNavigations": navigations.count, "blockedWindows": windows.count])
    }

    func testControlRunWithoutRulesWouldReachListener() throws {
        // 대조 실행: 차단 규칙을 걸지 않으면 같은 탐침이 수신기에 닿는다(탐침과 수신기가 새는 요청을 잡아낸다는 증거).
        let (connections, value, stats, lines) = try runProbe(control: true)
        XCTAssertGreaterThanOrEqual(connections, 1, "규칙이 없으면 요청이 닿아야 한다: \(value)")
        XCTAssertEqual(value["stillOnDocument"] as? Bool, true, "규칙이 없어도 이동은 껍데기가 취소한다")
        recordMetric(["kind": "network", "mode": "control", "connections": connections, "requests": lines, "blockedNavigations": (stats["blockedNavigations"] as? [String] ?? []).count])
    }
}

/// 6-7 글자 크기: 기기 글자 크기 설정만큼 웹의 루트 글자 크기가 커지고, 그 크기에서 답을 넣을 수 있다.
@MainActor
final class FontScaleUITests: XCTestCase {
    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func check(category: String, scale: Double, name: String) throws {
        let handle = AppHandle(name: "font-\(name)")
        handle.launch(extra: ["-UIPreferredContentSizeCategoryName", category])
        let root = handle.evaluate("return parseFloat(getComputedStyle(document.documentElement).fontSize);") as? Double ?? 0
        let given = handle.evaluate("return window.__SA_APP__.fontScale;") as? Double ?? 0
        XCTAssertEqual(given, scale, accuracy: 0.001, "껍데기가 넣은 fontScale")
        XCTAssertEqual(root, 16 * scale, accuracy: 0.05, "루트 글자 크기 16px x \(scale)")
        handle.startExampleA()
        handle.enterAnswers(from: 1, to: 3)
        let stored = handle.storedAnswers()
        for no in 1...3 { XCTAssertEqual(stored[no] as? Int, ExampleA.answers[no], "\(name) 에서 \(no)번 답이 들어간다") }
        handle.capture("글자-\(name)-답입력", theme: "light")
        recordMetric(["kind": "font", "category": category, "fontScale": given, "rootPx": root])
    }

    func testDefaultSize() throws {
        try check(category: "UICTContentSizeCategoryL", scale: 1.0, name: "기본")
    }

    func testLargestStandardSize() throws {
        try check(category: "UICTContentSizeCategoryXXXL", scale: 23.0 / 17.0, name: "가장큰일반")
    }

    func testAccessibilitySize() throws {
        try check(category: "UICTContentSizeCategoryAccessibilityM", scale: 28.0 / 17.0, name: "접근성1")
    }

    func testLargestAccessibilitySizeIsCappedAtTwo() throws {
        try check(category: "UICTContentSizeCategoryAccessibilityXXXL", scale: 2.0, name: "접근성가장큼")
    }

    /// 켜 둔 채 설정을 바꾸면 fontScale 로 알린다. verify.sh 가 시뮬레이터의 글자 크기를 바꿀 때만 돈다(SA_LIVE_FONT=1).
    func testLiveChangeIsSentToWeb() throws {
        guard ProcessInfo.processInfo.environment["SA_LIVE_FONT"] == "1" else {
            throw XCTSkip("verify.sh 가 글자 크기를 바꿀 때만 돈다")
        }
        let handle = AppHandle(name: "font-live")
        handle.launch()
        let before = handle.evaluate("return parseFloat(getComputedStyle(document.documentElement).fontSize);") as? Double ?? 0
        XCTAssertEqual(before, 16, accuracy: 0.05)
        let ready = TestEnv.outDirectory.appendingPathComponent("live-font-ready")
        let changed = TestEnv.outDirectory.appendingPathComponent("live-font-changed")
        try? FileManager.default.removeItem(at: changed)
        try Data("ready".utf8).write(to: ready)
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline, !FileManager.default.fileExists(atPath: changed.path) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: changed.path), "verify.sh 가 글자 크기를 바꿨다")
        var after = before
        let wait = Date().addingTimeInterval(10)
        while Date() < wait {
            after = handle.evaluate("return parseFloat(getComputedStyle(document.documentElement).fontSize);") as? Double ?? 0
            if abs(after - 16 * 28.0 / 17.0) < 0.05 { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertEqual(after, 16 * 28.0 / 17.0, accuracy: 0.05, "접근성 첫 크기로 바꾸면 루트 글자가 바로 커진다")
        let sent = handle.shellStats()["sent"] as? [String] ?? []
        XCTAssertTrue(sent.contains { $0.contains("fontScale") }, "fontScale 을 보냈다: \(sent)")
        recordMetric(["kind": "font", "category": "live-accessibility-medium", "rootPx": after])
    }
}
