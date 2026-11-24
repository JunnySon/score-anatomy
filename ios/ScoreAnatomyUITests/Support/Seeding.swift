import UIKit
import XCTest

/// 웹이 받은 이벤트 열(-SAEventLog 로 켠 기록, 작업 지시서 3-2의 3-4). 경우마다 숫자 기록과 문서에 남긴다.
struct TapEvents {
    let raw: [[String: Any]]

    init(_ raw: [[String: Any]]) { self.raw = raw }

    private func kind(_ e: [String: Any]) -> String { e["type"] as? String ?? "" }
    private func time(_ e: [String: Any]) -> Double { (e["ts"] as? Double) ?? (e["now"] as? Double) ?? 0 }

    func count(_ name: String) -> Int { raw.filter { kind($0) == name }.count }

    /// 손가락에서 온 click 의 detail(trusted).
    var realClicks: [Int] {
        raw.filter { kind($0) == "click" && ($0["trusted"] as? Bool) == true }.compactMap { $0["detail"] as? Int }
    }

    /// 웹이 만들어 보낸 click 의 detail(trusted 가 false: 빠진 누름 채우기가 채운 click, 그 자리로 다시 보낸 click).
    var madeClicks: [Int] {
        raw.filter { kind($0) == "click" && ($0["trusted"] as? Bool) == false }.compactMap { $0["detail"] as? Int }
    }

    private func times(_ name: String) -> [Double] { raw.filter { kind($0) == name }.map(time) }

    /// 누름 시작 사이(touchstart 사이, ms).
    var pressToPress: [Double] {
        let s = times("touchstart")
        return zip(s.dropFirst(), s).map { ($0 - $1).rounded() }
    }

    /// 손뗌에서 다음 누름까지(앞 touchend 에서 다음 touchstart, ms).
    var releaseToPress: [Double] {
        let s = times("touchstart"), e = times("touchend")
        return zip(s.dropFirst(), e).map { ($0 - $1).rounded() }
    }

    /// 누르고 있던 시간(touchstart 에서 touchend, ms).
    var holds: [Double] {
        let s = times("touchstart"), e = times("touchend")
        return zip(e, s).map { ($0 - $1).rounded() }
    }

    /// 문서에 적는 한 줄. 웹이 만든 click 은 "(채움)"을 붙인다.
    var sequence: String {
        raw.map { e in
            let t = kind(e)
            guard t == "click" || t == "dblclick" else { return t }
            let d = e["detail"] as? Int ?? 0
            return (e["trusted"] as? Bool) == false ? "\(t) \(d)(채움)" : "\(t) \(d)"
        }.joined(separator: ", ")
    }

    var summary: [String: Any] {
        [
            "sequence": sequence,
            "pointerdown": count("pointerdown"), "pointerup": count("pointerup"), "pointercancel": count("pointercancel"),
            "touchstart": count("touchstart"), "touchend": count("touchend"), "touchcancel": count("touchcancel"),
            "realClicks": realClicks, "madeClicks": madeClicks, "dblclick": count("dblclick"),
            "pressToPressMs": pressToPress, "releaseToPressMs": releaseToPress, "holdMs": holds,
            "targets": Array(Set(raw.compactMap { $0["target"] as? String })).sorted(),
            "points": raw.filter { kind($0) == "touchstart" }.map { "\($0["x"] as? Int ?? -1),\($0["y"] as? Int ?? -1)" },
        ]
    }
}

/// 켜기 전에 기록을 넣고 화면 주소로 바로 연다(DEBUG 전용 탐침과 기록 폴더). 웹 e2e 의 seedStore, openApp 과 같은 방식이다.
@MainActor
extension AppHandle {
    /// 기록 파일(store.json)을 넣는다. 형식은 웹의 기록 형식(version 1) 그대로이고 예시 시험 A 의 기록 하나를 지금 기록으로 둔다.
    func seedSession(answers: [Int: Int], marks: [Int: String] = [:], gradedAt: String? = nil) {
        var session: [String: Any] = [
            "id": "s1", "examId": "sample-a", "createdAt": "2026-11-22T10:00:00.000Z",
            "gradedBefore": "not_yet", "seenBefore": "first",
            "answers": Dictionary(uniqueKeysWithValues: answers.map { (String($0.key), $0.value) }),
        ]
        if !marks.isEmpty { session["marks"] = Dictionary(uniqueKeysWithValues: marks.map { (String($0.key), $0.value) }) }
        if let gradedAt { session["gradedAt"] = gradedAt }
        let data: [String: Any] = ["version": 1, "sessions": [session], "currentId": "s1"]
        do {
            try FileManager.default.createDirectory(at: storeDirectory, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: data).write(to: storeFile)
        } catch {
            XCTFail("기록 파일을 넣지 못함: \(error)")
        }
    }

    /// 웹 화면 주소(# 뒤)를 바꿔 연다. 화면이 그려지고 처음 막기(0.5초)가 끝날 때까지 기다린다.
    func open(_ path: String, route: String, file: StaticString = #filePath, line: UInt = #line) {
        _ = evaluate("location.hash = \(jsString("#" + path)); return true;")
        waitForRoute(route, file: file, line: line)
        Thread.sleep(forTimeInterval: 0.7)
    }

    /// 웹이 받은 이벤트 기록을 가져오고 비운다(-SAEventLog 로 켰을 때만 있다).
    func takeEvents() -> TapEvents {
        TapEvents(evaluate("const l = window.__saEventLog; if (!l) return []; const out = l.slice(); l.length = 0; return out;") as? [[String: Any]] ?? [])
    }

    func noticeCount() -> Int {
        (evaluate("return document.querySelectorAll('[data-testid=\"tap-notice\"], .tap-notice').length;") as? Int) ?? -1
    }

    func modalCount() -> Int {
        (evaluate("return document.querySelectorAll('[aria-modal=\"true\"]').length;") as? Int) ?? -1
    }

    func route() -> String? {
        evaluate("return document.documentElement.getAttribute('data-route');") as? String
    }

    /// 표시 칸의 상태(data-mark: none, doubt, guess).
    func markOf(_ no: Int) -> String? {
        evaluate("const e = document.querySelector('[data-mark-cell=\"\(no)\"]'); return e ? e.getAttribute('data-mark') : null;") as? String
    }

    /// 표시 칸 전체의 상태(표시가 있는 칸만).
    func markedCells() -> [String: String] {
        evaluate("const o = {}; document.querySelectorAll('[data-mark-cell]').forEach((e) => { const m = e.getAttribute('data-mark'); if (m && m !== 'none') o[e.getAttribute('data-mark-cell')] = m; }); return o;") as? [String: String] ?? [:]
    }

    func key(_ label: String) -> XCUIElement { keypad.buttons.matching(exact(label)).firstMatch }

    /// 입력 확인 화면의 칸(data-cell). 접근성 이름을 웹에서 읽어 같은 이름의 요소를 찾는다.
    func reviewCell(_ no: Int) -> XCUIElement {
        let label = evaluate("const e = document.querySelector('[data-cell=\"\(no)\"]'); return e ? (e.getAttribute('aria-label') || e.textContent.replace(/\\s+/g, ' ').trim()) : null;") as? String ?? "\(no)번"
        return web.descendants(matching: .any).matching(exact(label)).firstMatch
    }

    /// 기록 파일의 지금 기록의 답(문항 번호와 값).
    func answerMap() -> [Int: Int] {
        storedAnswers().compactMapValues { $0 as? Int }
    }

    /// 기록 파일의 지금 기록의 표시.
    func storedMarks() -> [String: String] {
        ((storeJSON()?["sessions"] as? [[String: Any]])?.first?["marks"] as? [String: String]) ?? [:]
    }

    /// 진행 중인 측정의 채운 누름과 버린 누름(기록 파일). 측정 중이 아니면 nil.
    func runCounts() -> (filled: Int, discarded: Int)? {
        guard let json = storeJSON(), let active = json["activeRunId"] as? String,
              let runs = json["testRuns"] as? [[String: Any]],
              let run = runs.first(where: { ($0["id"] as? String) == active }) else { return nil }
        return ((run["filledTaps"] as? Int) ?? -1, (run["discardedTaps"] as? Int) ?? -1)
    }

    /// 기록 파일이 바뀌어 조건을 만족할 때까지 기다린 뒤의 측정 값.
    func waitRunCounts(timeout: TimeInterval = 3, _ condition: ((filled: Int, discarded: Int)) -> Bool) -> (filled: Int, discarded: Int)? {
        let deadline = Date().addingTimeInterval(timeout)
        var last = runCounts()
        while Date() < deadline {
            if let now = runCounts(), condition(now) { return now }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            last = runCounts()
        }
        return last
    }
}

/// 화면 캡처의 화소를 읽는다(sRGB, 화소 단위). 키패드 판이 화면 아래 끝까지 이어지는지 볼 때 쓴다.
struct PixelGrid {
    let width: Int
    let height: Int
    let scale: CGFloat
    private let bytes: [UInt8]

    /// CGImage 를 sRGB 화소로 그린다. scale 은 점(pt) 하나의 화소 수다.
    init?(cgImage cg: CGImage, scale: CGFloat) {
        let w = cg.width, h = cg.height
        var buffer = [UInt8](repeating: 0, count: w * h * 4)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let drawn: Bool = buffer.withUnsafeMutableBytes { raw in
            guard let context = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        width = w
        height = h
        self.scale = scale
        bytes = buffer
    }

    @MainActor
    init?(_ screenshot: XCUIScreenshot) {
        let image = screenshot.image
        guard let cg = image.cgImage else { return nil }
        self.init(cgImage: cg, scale: image.scale)
    }

    /// 화소 (x, y)의 RGB(위에서 아래로 센 y).
    func rgb(x: Int, y: Int) -> [Int] {
        let i = (y * width + x) * 4
        return [Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2])]
    }

    /// 점(pt) 좌표의 RGB.
    func rgb(at point: CGPoint) -> [Int] {
        rgb(x: min(width - 1, max(0, Int(point.x * scale))), y: min(height - 1, max(0, Int(point.y * scale))))
    }

    static func distance(_ a: [Int], _ b: [Int]) -> Int {
        zip(a, b).map { abs($0 - $1) }.max() ?? 255
    }

    /// CSS 의 "rgb(1, 2, 3)" 이나 "rgba(1, 2, 3, 1)" 을 RGB 로.
    static func parseCSS(_ text: String) -> [Int]? {
        let numbers = text.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).filter { !$0.isEmpty }.compactMap { Double($0) }
        guard numbers.count >= 3 else { return nil }
        return numbers.prefix(3).map { Int($0.rounded()) }
    }
}
