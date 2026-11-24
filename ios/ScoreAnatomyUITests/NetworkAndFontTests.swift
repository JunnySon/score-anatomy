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
            // 내용이 온 연결만 요청으로 센다(HTTP 의 첫 줄, TLS 라면 알아볼 수 없는 바이트).
            if let data, !data.isEmpty {
                let text = String(decoding: data, as: UTF8.self)
                self?.lock.lock()
                self?.lines.append(String(text.split(separator: "\r\n").first ?? "(알아볼 수 없는 바이트)"))
                self?.lock.unlock()
            }
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

    struct ProbeResult {
        /// 하위 자원 요청(탐침)이 끝난 뒤 수신기에 닿은 연결 수.
        var subresourceConnections: Int
        /// 문서 이동 시도와 사람이 링크를 누른 뒤까지 닿은 연결 수.
        var finalConnections: Int
        /// 내용(요청)이 온 연결의 첫 줄.
        var requests: [String]
        var outcomes: [String: Any]
        var stillOnDocument: Bool
        var stats: [String: Any]
    }

    private func runProbe(control: Bool) throws -> ProbeResult {
        let listener = try LoopbackListener()
        XCTAssertTrue(listener.start(), "시험용 수신기가 떠야 한다")
        defer { listener.stop() }
        let handle = AppHandle(name: control ? "network-control" : "network-blocked")
        var extra = ["-SAProbe", "network", "-SAProbePort", "\(listener.port)"]
        if control { extra.append("-SAProbeControl") }
        handle.launch(extra: extra)
        // 1) 하위 자원 요청 10가지와 스크립트의 새 창(앱 안 탐침).
        let output = try XCTUnwrap(handle.probeFile("probe-network.json", timeout: 90), "탐침 결과")
        XCTAssertEqual(output["ok"] as? Bool, true, "탐침이 끝까지 돌았다: \(output)")
        Thread.sleep(forTimeInterval: 1.5)
        let subresourceConnections = listener.connections
        // 2) 스크립트로 시도하는 문서 이동: 링크 click, 새 창 링크 click, location 바꾸기, form 제출.
        let base = "http://127.0.0.1:\(listener.port)"
        _ = handle.evaluate("""
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const link = (path, target) => { const a = document.createElement('a'); a.href = '\(base)/' + path; if (target) a.target = target; document.body.appendChild(a); a.click(); a.remove(); };
        link('link', null); await wait(400);
        link('blank', '_blank'); await wait(400);
        location.href = '\(base)/assign'; await wait(600);
        const form = document.createElement('form'); form.method = 'post'; form.action = '\(base)/form'; document.body.appendChild(form); form.submit();
        await wait(600);
        return true;
        """)
        // 3) 사람이 누른 링크(사용자 동작)는 팝업 차단을 지나 껍데기까지 온다. 새 창 링크와 바깥 링크를 붙이고 실제로 누른다.
        _ = handle.evaluate("""
        const make = (id, top, target) => {
          const a = document.createElement('a');
          a.id = id; a.textContent = id; a.href = '\(base)/' + id;
          if (target) a.target = target;
          a.style.cssText = 'position:fixed;left:20px;top:' + top + 'px;z-index:99999;display:block;padding:16px;font-size:20px;background:#fff;color:#000';
          document.body.appendChild(a);
        };
        make('sa-probe-blank', 160, '_blank');
        make('sa-probe-link', 260, null);
        return true;
        """)
        for id in ["sa-probe-blank", "sa-probe-link"] {
            let link = handle.web.links.matching(handle.exact(id)).firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 5), "\(id) 링크")
            Thread.sleep(forTimeInterval: 0.6)
            link.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
        let still = handle.evaluate("return location.href.startsWith('file:');") as? Bool ?? false
        Thread.sleep(forTimeInterval: 1.0)
        return ProbeResult(subresourceConnections: subresourceConnections, finalConnections: listener.connections, requests: listener.firstLines,
                           outcomes: output["value"] as? [String: Any] ?? [:], stillOnDocument: still, stats: handle.shellStats())
    }

    func testRequestsToOutsideAreBlocked() throws {
        let r = try runProbe(control: false)
        XCTAssertEqual(r.subresourceConnections, 0, "하위 자원 요청은 연결조차 닿지 않는다")
        XCTAssertEqual(r.requests, [], "어떤 요청 내용도 바깥으로 나가지 않는다")
        XCTAssertTrue(r.stillOnDocument, "처음 문서에 머문다")
        XCTAssertEqual(r.outcomes["windowOpenReturnedNull"] as? Bool, true, "스크립트가 연 새 창은 열리지 않는다")
        for key in ["fetch", "fetchHttps", "xhr", "image", "script", "style", "websocket", "eventSource"] {
            let outcome = "\(r.outcomes[key] ?? "")"
            XCTAssertFalse(outcome == "loaded" || outcome == "open", "\(key) 가 성공하면 안 된다: \(outcome)")
        }
        let navigations = r.stats["blockedNavigations"] as? [String] ?? []
        let windows = r.stats["blockedWindows"] as? [String] ?? []
        for path in ["/link", "/assign", "/form", "/sa-probe-link"] {
            XCTAssertTrue(navigations.contains { $0.hasSuffix(path) }, "\(path) 이동을 껍데기가 취소했다: \(navigations)")
        }
        // 스크립트의 새 창은 WebKit 의 팝업 차단이 먼저 막는다. 사람이 누른 새 창 링크는 WebKit 이 먼저 이동 결정(대상 틀 없음)을
        // 물어서 껍데기가 취소하고, 그 단계를 지나면 새 창 만들기(createWebViewWith)에서 껍데기가 거절한다. 둘 중 하나여야 한다.
        XCTAssertTrue((navigations + windows).contains { $0.hasSuffix("/sa-probe-blank") }, "사람이 누른 새 창 링크를 껍데기가 막았다: \(navigations) \(windows)")
        // 링크로 가는 이동은 WebKit 이 요청을 정하기 전에 TCP 연결을 미리 맺을 수 있다(내용은 보내지 않음, 콘텐츠 규칙과 이동 취소로
        // 막히지 않음). 웹 묶음에는 바깥 링크가 없어서(정적 검사) 실제로는 생기지 않는다. 숫자만 남긴다.
        recordMetric(["kind": "network", "mode": "blocked", "connections": r.subresourceConnections, "preconnects": r.finalConnections - r.subresourceConnections,
                      "requests": r.requests, "outcomes": r.outcomes, "blockedNavigations": navigations.count, "blockedWindows": windows.count])
    }

    func testControlRunWithoutRulesWouldReachListener() throws {
        // 대조 실행: 차단 규칙을 걸지 않으면 같은 탐침이 수신기에 닿는다(탐침과 수신기가 새는 요청을 잡아낸다는 증거).
        let r = try runProbe(control: true)
        XCTAssertGreaterThanOrEqual(r.subresourceConnections, 1, "규칙이 없으면 요청이 닿아야 한다: \(r.outcomes)")
        XCTAssertFalse(r.requests.isEmpty, "규칙이 없으면 요청 내용도 닿는다")
        XCTAssertTrue(r.stillOnDocument, "규칙이 없어도 이동은 껍데기가 취소한다")
        recordMetric(["kind": "network", "mode": "control", "connections": r.subresourceConnections, "requests": r.requests.count,
                      "blockedNavigations": (r.stats["blockedNavigations"] as? [String] ?? []).count])
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
