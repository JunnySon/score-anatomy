import XCTest

// 시험 자료 받기의 화면 테스트(작업 지시서 4의 3-3). 이 맥의 시험 서버(ios/scripts/exam_server.py, verify.sh 가 켬)를 쓴다.
// 앱은 Debug 전용 실행 인자로 시험 서버 주소(-SAExamURL)와 테스트 전용 공개 키 파일(-SAExamKeyFile)을 받는다.

/// 시험 서버를 다루는 도구. 테스트마다 다른 세션 이름을 써서 기록이 섞이지 않게 한다.
struct ExamServer {
    let base: String
    let session: String

    /// verify.sh 가 TEST_RUNNER_SA_EXAM_SERVER 로 넘긴 주소. 없으면 건너뛴다.
    static func make(_ name: String) throws -> ExamServer {
        let value = ProcessInfo.processInfo.environment["SA_EXAM_SERVER"] ?? ""
        guard !value.isEmpty else { throw XCTSkip("시험 서버 주소(SA_EXAM_SERVER)가 없다. ios/scripts/verify.sh 가 켜서 넘긴다.") }
        let base = value.hasSuffix("/") ? String(value.dropLast()) : value
        return ExamServer(base: base, session: "\(name)-\(UUID().uuidString.prefix(6))")
    }

    /// 테스트 전용 공개 키 파일(verify.sh 가 데스크톱 밖에 복사한 exam-data/testdata).
    static var keyFile: String {
        let dir = ProcessInfo.processInfo.environment["SA_TESTDATA"] ?? ""
        return (dir.isEmpty ? "/없는-폴더" : dir) + "/test-only-public-key.txt"
    }

    /// 앱이 받는 주소(끝이 /).
    var appURL: String { "\(base)/s/\(session)/" }

    /// 앱에 주는 실행 인자.
    var launchArguments: [String] { ["-SAExamURL", appURL, "-SAExamKeyFile", Self.keyFile] }

    @discardableResult
    func request(_ path: String) -> Data? {
        guard let url = URL(string: base + path) else { return nil }
        let done = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var result: Data?
        URLSession(configuration: .ephemeral).dataTask(with: url) { data, _, _ in
            result = data
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 10)
        return result
    }

    func set(_ query: String, session name: String? = nil) {
        XCTAssertNotNil(request("/control/\(name ?? session)/set?\(query)"), "시험 서버 설정")
    }

    func clear() {
        request("/control/\(session)/clear")
    }

    /// 받은 요청(시각, 방법, 경로, 머리글).
    func log(session name: String? = nil) -> [[String: Any]] {
        guard let data = request("/control/\(name ?? session)/log") else { return [] }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]) ?? []
    }

    func paths(session name: String? = nil) -> [String] {
        log(session: name).compactMap { $0["path"] as? String }
    }
}

@MainActor
final class RemoteFetchTests: XCTestCase {
    static let notice = "받은 자료 기준"
    static let refresh = "새로 확인"
    static let same = "이미 가장 새 자료예요."
    static let failed = "새 시험 자료를 받지 못했어요. 지금 있는 자료로 쓸 수 있어요."
    static let testExam = "테스트 전용 시험"
    /// test-only-valid 의 issuedAt 2030-01-02T17:10 을 웹이 적는 모양(src/strings.ts 의 remoteIssued).
    static let issued = "받은 자료 기준: 2030년 1월 2일 오후 5시 10분"

    /// 껍데기 기록(shell-stats.json)의 시험 자료 받기 기록이 count 개가 될 때까지 기다린다.
    private func remoteNotes(_ handle: AppHandle, count: Int, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) -> [[String: Any]] {
        var notes: [[String: Any]] = []
        let ok = handle.waitForStats(timeout: timeout) { stats in
            notes = stats["remote"] as? [[String: Any]] ?? []
            return notes.count >= count
        }
        XCTAssertTrue(ok, "시험 자료 받기 기록이 \(count)개가 돼야 한다(지금 \(notes.count)개)", file: file, line: line)
        return notes
    }

    private func openExamSelect(_ handle: AppHandle, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(handle.button("시험 고르기").waitForExistence(timeout: 20), file: file, line: line)
        handle.button("시험 고르기").tap()
        XCTAssertTrue(handle.any("어떤 시험을 넣을까요?").waitForExistence(timeout: 8), "시험 선택 화면", file: file, line: line)
    }

    private func tapRefresh(_ handle: AppHandle) {
        let button = handle.button(Self.refresh)
        XCTAssertTrue(button.waitForExistence(timeout: 8), "새로 확인 버튼")
        handle.tapCentered(button, selector: "[data-testid=remote-refresh]")
    }

    private func waitResult(_ handle: AppHandle, _ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(12)
        var last: String?
        while Date() < deadline {
            last = handle.domText("[data-testid=remote-result]")
            if last == text { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("결과 문구가 '\(text)' 여야 한다(지금 '\(last ?? "없음")')", file: file, line: line)
    }

    private func storedSeq(_ handle: AppHandle) -> Int? {
        let url = handle.storeDirectory.appendingPathComponent("remote/remote.json")
        guard let data = try? Data(contentsOf: url), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        return (json["seq"] as? NSNumber)?.intValue
    }

    // MARK: 1. 처음 받기

    func testFirstFetchShowsNoticeRefreshAndTestExam() throws {
        let server = try ExamServer.make("first")
        server.set("pub=test-only-valid")
        let handle = AppHandle(name: "remote-first")
        handle.launch(extra: server.launchArguments)
        let notes = remoteNotes(handle, count: 1)
        XCTAssertEqual(notes.first?["trigger"] as? String, "launch", "화면이 뜬 뒤 한 번 받는다")
        XCTAssertEqual(notes.first?["outcome"] as? String, "accepted")
        XCTAssertEqual(notes.first?["seq"] as? Int, 2)
        // 요청은 정해진 주소의 index.json, index.json.sig, 시험 파일뿐이다.
        let log = server.log()
        let prefix = "/s/\(server.session)/"
        XCTAssertEqual(log.compactMap { $0["path"] as? String }, [prefix + "index.json", prefix + "index.json.sig", prefix + "files/test-only-exam.2.json"])
        XCTAssertTrue(log.allSatisfy { ($0["query"] as? String) == "" && ($0["method"] as? String) == "GET" }, "쿼리 없이 GET 만")
        // 머리글은 정해 둔 일곱 개뿐이고 값이 고정이다.
        let headers = (log.first?["headers"] as? [[String]]) ?? []
        var byName: [String: String] = [:]
        for pair in headers { byName[pair[0].lowercased()] = pair[1] }
        XCTAssertEqual(Set(byName.keys), ["host", "user-agent", "accept-language", "cache-control", "accept", "accept-encoding", "connection"], "\(headers)")
        XCTAssertEqual(byName["user-agent"], "score-anatomy")
        XCTAssertEqual(byName["accept-language"], "ko")
        XCTAssertEqual(byName["cache-control"], "no-cache")
        for entry in log {
            let names = ((entry["headers"] as? [[String]]) ?? []).map { $0[0].lowercased() }.sorted()
            XCTAssertEqual(names, byName.keys.sorted(), "세 요청의 머리글이 같다")
        }
        let ms = notes.first?["ms"] as? Int ?? -1
        recordMetric(["kind": "remoteFetch", "device": TestEnv.deviceTag, "ms": ms, "requests": log.count, "headers": headers,
                      "paths": log.compactMap { $0["path"] as? String }.map { $0.replacingOccurrences(of: prefix, with: "") }])
        XCTAssertLessThan(ms, 9000, "받기와 확인이 9초 안에 끝난다")
        // 시험 선택 화면: 받은 자료 안내, 새로 확인, 테스트 전용 시험.
        openExamSelect(handle)
        XCTAssertTrue(handle.element(labelContains: Self.notice).waitForExistence(timeout: 8), "받은 자료 안내가 생긴다")
        XCTAssertTrue(handle.element(labelContains: Self.issued).exists, "issuedAt 2030-01-02T17:10 이 '\(Self.issued)'")
        XCTAssertTrue(handle.button(Self.refresh).exists, "새로 확인 버튼이 생긴다")
        XCTAssertTrue(handle.element(labelContains: Self.testExam).exists, "테스트 전용 시험이 목록에 나온다")
        handle.capture("받은자료-시험선택", theme: "light")
        if let tree = handle.evaluate("return document.body.innerText;") as? String {
            XCTAssertFalse(tree.contains("테스트 전용 정정 안내예요."), "rev 2 에는 정정 안내가 없다")
        }
    }

    // MARK: 2. 새로 확인의 두 응답과 틀린 발행물

    func testRefreshAnswersAndBadPublicationsKeepTheData() throws {
        let server = try ExamServer.make("refresh")
        server.set("pub=test-only-valid")
        let handle = AppHandle(name: "remote-refresh")
        handle.launch(extra: server.launchArguments)
        _ = remoteNotes(handle, count: 1)
        openExamSelect(handle)
        XCTAssertTrue(handle.element(labelContains: Self.notice).waitForExistence(timeout: 8))
        // 새 자료 없음.
        tapRefresh(handle)
        var notes = remoteNotes(handle, count: 2)
        XCTAssertEqual(notes.last?["trigger"] as? String, "refresh")
        XCTAssertEqual(notes.last?["outcome"] as? String, "unchanged")
        waitResult(handle, Self.same)
        // 받지 못함(서버 오류).
        server.set("pub=test-only-valid&mode=status&status=500")
        tapRefresh(handle)
        notes = remoteNotes(handle, count: 3)
        XCTAssertEqual(notes.last?["outcome"] as? String, "failed")
        waitResult(handle, Self.failed)
        handle.capture("받은자료-받지못함", theme: "light")
        // 서명이 틀린 발행물(seq 3): 버리고 자료 그대로.
        server.set("pub=test-only-bad-signature")
        tapRefresh(handle)
        notes = remoteNotes(handle, count: 4)
        XCTAssertEqual(notes.last?["outcome"] as? String, "failed")
        XCTAssertTrue((notes.last?["detail"] as? String ?? "").contains("서명"), "\(notes.last ?? [:])")
        waitResult(handle, Self.failed)
        // 시험 파일 한 바이트가 바뀐 발행물(seq 3): 버리고 자료 그대로.
        server.set("pub=test-only-changed-byte")
        tapRefresh(handle)
        notes = remoteNotes(handle, count: 5)
        XCTAssertEqual(notes.last?["outcome"] as? String, "failed")
        XCTAssertTrue((notes.last?["detail"] as? String ?? "").contains("sha256"), "\(notes.last ?? [:])")
        waitResult(handle, Self.failed)
        XCTAssertEqual(storedSeq(handle), 2, "보관한 자료는 seq 2 그대로")
        XCTAssertTrue(handle.element(labelContains: Self.issued).exists, "받은 자료 기준도 그대로")
        let body = handle.evaluate("return document.body.innerText;") as? String ?? ""
        XCTAssertFalse(body.contains("오후 8시 10분"), "틀린 발행물의 issuedAt(2030-01-02T20:10)이 화면에 없다")
        XCTAssertFalse(body.contains("테스트 전용 정정 안내예요."), "rev 3(정정 판)으로 바뀌지 않았다")
    }

    // MARK: 3. 통신 없이 다시 켜기

    func testOfflineRestartLoadsSavedDataAtStart() throws {
        let server = try ExamServer.make("offline")
        server.set("pub=test-only-valid")
        let handle = AppHandle(name: "remote-offline")
        handle.launch(extra: server.launchArguments)
        _ = remoteNotes(handle, count: 1)
        XCTAssertEqual(storedSeq(handle), 2)
        handle.terminate()
        // 통신이 안 되는 주소(아무도 듣지 않는 포트)로 다시 켠다. 보관한 자료가 시작할 때 들어와야 한다.
        handle.launch(extra: ["-SAExamURL", "http://127.0.0.1:9/s/offline/", "-SAExamKeyFile", ExamServer.keyFile])
        let start = handle.evaluate("const a = window.__SA_APP__; return { seq: a.remote ? a.remote.seq : null, exams: a.remote ? a.remote.exams.length : null };") as? [String: Any]
        XCTAssertEqual(start?["seq"] as? Int, 2, "문서가 시작될 때 __SA_APP__.remote 에 보관한 자료가 있다")
        XCTAssertEqual(start?["exams"] as? Int, 1)
        let notes = remoteNotes(handle, count: 1)
        XCTAssertEqual(notes.first?["outcome"] as? String, "failed", "통신이 안 되면 받지 못하고 가진 자료를 쓴다")
        openExamSelect(handle)
        XCTAssertTrue(handle.element(labelContains: Self.notice).waitForExistence(timeout: 8), "받은 자료 안내")
        XCTAssertTrue(handle.element(labelContains: Self.testExam).exists, "보관한 테스트 전용 시험")
        XCTAssertEqual(storedSeq(handle), 2)
    }

    // MARK: 4. 넘기는 응답(3xx)

    func testRedirectIsNotFollowed() throws {
        let server = try ExamServer.make("redirect")
        let target = "\(server.session)-target"
        server.set("pub=test-only-valid", session: target)
        server.set("pub=test-only-valid&mode=redirect&target=\(server.base)/s/\(target)/index.json")
        let handle = AppHandle(name: "remote-redirect")
        handle.launch(extra: server.launchArguments)
        let notes = remoteNotes(handle, count: 1)
        XCTAssertEqual(notes.first?["outcome"] as? String, "failed")
        XCTAssertTrue((notes.first?["detail"] as? String ?? "").contains("302"), "\(notes.first ?? [:])")
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertEqual(server.paths(session: target), [], "넘긴 주소로는 요청이 가지 않는다")
        XCTAssertEqual(server.paths(), ["/s/\(server.session)/index.json"], "넘기는 응답을 받으면 거기서 멈춘다")
        openExamSelect(handle)
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertFalse(handle.element(labelContains: Self.notice).exists, "받은 자료가 없으니 안내도 없다")
        XCTAssertFalse(handle.button(Self.refresh).exists)
    }

    // MARK: 5. 앞으로 돌아왔을 때(마지막 시도에서 정한 간격이 지났으면), 뒤에서는 받지 않음

    func testForegroundFetchAfterIntervalAndNothingInBackground() throws {
        let server = try ExamServer.make("foreground")
        server.set("pub=test-only-valid")
        let handle = AppHandle(name: "remote-foreground")
        // 간격을 6초로 줄인다(기본 300초).
        handle.launch(extra: server.launchArguments + ["-SAExamInterval", "6"])
        _ = remoteNotes(handle, count: 1)
        server.clear()
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 7)
        XCTAssertEqual(server.paths(), [], "뒤에 있는 동안에는 받지 않는다")
        handle.app.activate()
        let notes = remoteNotes(handle, count: 2)
        XCTAssertEqual(notes.last?["trigger"] as? String, "foreground", "간격이 지난 뒤 앞으로 돌아오면 받는다")
        XCTAssertEqual(notes.last?["outcome"] as? String, "unchanged")
        // 곧바로 다시 뒤로 갔다 오면(간격이 지나지 않음) 받지 않는다.
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        handle.app.activate()
        XCTAssertTrue(handle.web.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 2)
        let after = handle.shellStats()["remote"] as? [[String: Any]] ?? []
        XCTAssertEqual(after.count, 2, "간격 안에 돌아오면 다시 받지 않는다")
    }
}
