import UIKit
import XCTest

/// 작업 지시서 3-2의 3-3: 배포용 묶음(Release)과 시험용 묶음(Debug)의 같은 화면 모양을 견준다.
///
/// - 상태를 심는 장치(탐침, 기록 심기)는 Release 에 없어서 쓰지 않는다. XCUITest 의 실제 누름과 손가락 밀기로만 시작, 시험 선택,
///   답 입력, 입력 확인, 표시, 점수 해부, 계단, 기록 화면까지 가며 찍는다. Release 빌드에 새 장치를 넣지 않았다.
/// - 같은 테스트를 두 구성에서 돌린다. verify.sh 가 Debug 를 먼저 돌리고(SA_CONFIG 없음), Release 를 나중에 돌린다
///   (SA_CONFIG=Release). 둘 다 SA_LOOK 폴더의 구성 이름 폴더에 화면(png)과 접근성 요소(json)를 남긴다.
/// - Release 실행이 Debug 결과를 읽어 세 가지로 견준다.
///   1. 화면 전체 화소: 채널 차이 8 넘는 화소가 30개를 넘으면 다르다. 기록 화면은 Debug 에만 있는 목록의 위 끝에서 12pt 위까지만 본다.
///      (이 맥에서 01~07 화면은 두 구성이 화소 하나까지 같았다.)
///   2. 이름이 있는 접근성 요소: 한쪽에만 있는 요소, 자리나 크기가 1pt 넘게 다른 요소. Debug 에만 있어도 되는 것은 기록 화면의
///      준비 중인 기능 목록과 "테스트 진행자용" 링크뿐이고(입력 방식 전환은 일반 화면에 없다), 그 아래의 요소는 크기만 본다.
///   3. 요소마다 각자의 자리에서 잘라 견준 화소: 채널 차이 8 넘는 화소가 0.5% 넘으면 다르다.
///   기록 화면을 맨 아래까지 내린 것(08b)은 요소의 있고 없음만 본다. 결과는 SA_LOOK/compare.json 에 적고, 차이가 있으면 실패한다.
@MainActor
final class LookTests: XCTestCase {
    static let screens = ["01-시작", "02-시험선택", "03-답입력", "04-입력확인", "05-표시", "06-점수해부", "07-계단", "08-기록", "08b-기록-아래"]
    /// Debug(시험용 묶음)에만 있어야 하는 것(src/screens/HistoryExtras.tsx, src/strings.ts 의 S_TOOLS).
    static let debugOnly = ["준비 중인 기능", "7일 뒤 확인", "실수 카드", "공유 리포트", "점수대별 정답률", "준비 중이에요.", "응답이 모이면 열려요.", "테스트 진행자용"]

    override nonisolated func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private var config: String { ProcessInfo.processInfo.environment["SA_CONFIG"] ?? "Debug" }

    private var lookRoot: URL {
        if let path = ProcessInfo.processInfo.environment["SA_LOOK"], !path.isEmpty { return URL(fileURLWithPath: path, isDirectory: true) }
        return TestEnv.outDirectory.appendingPathComponent("look", isDirectory: true)
    }

    private func folder(_ config: String) -> URL { lookRoot.appendingPathComponent(config, isDirectory: true) }

    // MARK: 찍기

    private func shot(_ handle: AppHandle, _ name: String) throws {
        XCTAssertTrue(Self.screens.contains(name))
        // 화면 전환, 연달아 누르기 보호 표시, 스크롤 막대가 사라진 뒤에 찍는다.
        Thread.sleep(forTimeInterval: 1.2)
        let dir = folder(config)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let screenshot = XCUIScreen.main.screenshot()
        try screenshot.pngRepresentation.write(to: dir.appendingPathComponent("\(name).png"))
        let snap = try handle.web.snapshot()
        var items: [[String: Any]] = []
        func walk(_ s: XCUIElementSnapshot) {
            let f = s.frame
            items.append(["type": s.elementType.rawValue, "label": s.label, "x": f.minX, "y": f.minY, "w": f.width, "h": f.height])
            for c in s.children { walk(c) }
        }
        walk(snap)
        let data = try JSONSerialization.data(withJSONObject: ["screen": name, "items": items], options: [.sortedKeys])
        try data.write(to: dir.appendingPathComponent("\(name).json"))
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "\(config)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 손가락으로 밀어 요소가 보이고 아래 띠에 가리지 않게 한다(탐침을 쓰지 않는다).
    private func revealBySwipe(_ handle: AppHandle, _ element: XCUIElement, up: Bool = true) {
        let window = handle.app.windows.firstMatch.frame
        for _ in 0..<8 {
            if element.exists, element.isHittable, element.frame.maxY < window.maxY - 90, element.frame.minY > window.minY + 60 { return }
            if up { handle.web.swipeUp(velocity: .slow) } else { handle.web.swipeDown(velocity: .slow) }
            Thread.sleep(forTimeInterval: 0.4)
        }
    }

    private func toTop(_ handle: AppHandle) {
        for _ in 0..<4 { handle.web.swipeDown(velocity: .fast) }
        Thread.sleep(forTimeInterval: 0.8)
    }

    func testTapThroughScreens() throws {
        let handle = AppHandle(name: "look-\(config)")
        handle.launch()
        let pick = handle.button("시험 고르기")
        XCTAssertTrue(pick.waitForExistence(timeout: 20), "시작 화면")
        XCTAssertFalse(handle.button("이어서 보기").exists, "앞서 남은 기록이 없는 새 상태에서 시작한다")
        try shot(handle, "01-시작")

        pick.tap()
        XCTAssertTrue(handle.any("어떤 시험을 넣을까요?").waitForExistence(timeout: 8))
        try shot(handle, "02-시험선택")

        handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "예시 시험 A")).firstMatch.tap()
        let notYet = handle.any("아직 안 했어요")
        XCTAssertTrue(notYet.waitForExistence(timeout: 5))
        notYet.tap()
        handle.button("답 넣기").tap()
        XCTAssertTrue(handle.nowNumber(1).waitForExistence(timeout: 10))
        handle.enterAnswers(from: 1, to: 11)
        XCTAssertTrue(handle.nowNumber(12).waitForExistence(timeout: 5))
        try shot(handle, "03-답입력")

        handle.enterAnswers(from: 12, to: 30)
        XCTAssertTrue(handle.any("넣은 답을 확인해 주세요").waitForExistence(timeout: 8))
        try shot(handle, "04-입력확인")

        let next = handle.button("맞아요, 다음으로")
        revealBySwipe(handle, next)
        next.tap()
        XCTAssertTrue(handle.markCell(9).waitForExistence(timeout: 8))
        for no in ExampleA.guesses {
            let cell = handle.markCell(no)
            revealBySwipe(handle, cell)
            cell.tap()
            XCTAssertTrue(handle.waitLabel(cell, contains: "고민"))
            Thread.sleep(forTimeInterval: 0.6)
            cell.tap()
            XCTAssertTrue(handle.waitLabel(cell, contains: "찍음"))
        }
        toTop(handle)
        try shot(handle, "05-표시")

        let grade = handle.button("채점하기")
        revealBySwipe(handle, grade)
        grade.tap()
        let direct = handle.button("점수 해부 바로 보기")
        XCTAssertTrue(direct.waitForExistence(timeout: 8))
        direct.tap()
        XCTAssertTrue(handle.staticText("78점").waitForExistence(timeout: 8), "점수 해부의 78점")
        let chip = handle.any("2등급")
        revealBySwipe(handle, chip)
        Thread.sleep(forTimeInterval: 0.6)
        chip.tap()
        handle.waitForText("3~7점 남았어요")
        toTop(handle)
        try shot(handle, "06-점수해부")

        let toSteps = handle.web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "고칠 것")).firstMatch
        revealBySwipe(handle, toSteps)
        toSteps.tap()
        XCTAssertTrue(handle.web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "먼저 고칠")).firstMatch.waitForExistence(timeout: 8))
        toTop(handle)
        try shot(handle, "07-계단")

        handle.web.links.matching(handle.exact("기록")).firstMatch.tap()
        XCTAssertTrue(handle.any("앱을 지우면 기록도 함께 지워져요.").waitForExistence(timeout: 8), "기록 화면")
        try shot(handle, "08-기록")
        // 맨 아래(준비 중인 기능 목록과 진행자용 링크가 있는 곳)까지 내린 것도 남긴다.
        for _ in 0..<4 { handle.web.swipeUp(velocity: .fast) }
        try shot(handle, "08b-기록-아래")

        if config == "Release" {
            try compareWithDebug(window: handle.app.windows.firstMatch.frame)
        }
    }

    // MARK: 견주기(Release 실행에서)

    private struct Item {
        let type: Int
        let label: String
        let frame: CGRect
        var key: String { "\(type)|\(label)" }
    }

    /// 기록 항목의 이름에는 그 기록을 만든 날짜와 시각이 들어간다. 두 실행이 자정을 넘겨도 짝지어지게 날짜와 시각을 지운다.
    private static func normalized(_ label: String) -> String {
        label.replacingOccurrences(of: "[0-9]{4}년 [0-9]{1,2}월 [0-9]{1,2}일", with: "(날짜)", options: .regularExpression)
            .replacingOccurrences(of: "[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?", with: "(시각)", options: .regularExpression)
    }

    private func load(_ config: String, _ name: String, window: CGRect) throws -> (items: [Item], image: PixelGrid?) {
        let dir = folder(config)
        let data = try Data(contentsOf: dir.appendingPathComponent("\(name).json"))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let items = (json["items"] as? [[String: Any]] ?? []).map { d in
            Item(type: d["type"] as? Int ?? 0, label: Self.normalized(d["label"] as? String ?? ""),
                 frame: CGRect(x: d["x"] as? Double ?? 0, y: d["y"] as? Double ?? 0, width: d["w"] as? Double ?? 0, height: d["h"] as? Double ?? 0))
        }
        let cg = UIImage(contentsOfFile: dir.appendingPathComponent("\(name).png").path)?.cgImage
        let image = cg.flatMap { PixelGrid(cgImage: $0, scale: CGFloat($0.width) / max(window.width, 1)) }
        return (items, image)
    }

    private func allowedDebugOnly(_ label: String) -> Bool {
        Self.debugOnly.contains { label.contains($0) }
    }

    /// 두 캡처의 [0, height) 줄(pt)에서 채널 차이가 8 넘는 화소의 수.
    private func fullDifference(_ a: PixelGrid, _ b: PixelGrid, height: CGFloat) -> Int {
        guard a.width == b.width, a.height == b.height else { return Int.max }
        let rows = min(a.height, Int(height * a.scale))
        var differ = 0
        for y in 0..<rows {
            for x in 0..<a.width where PixelGrid.distance(a.rgb(x: x, y: y), b.rgb(x: x, y: y)) > 8 { differ += 1 }
        }
        return differ
    }

    /// 같은 요소를 각자의 자리에서 잘라 견준다. 채널 차이가 8 넘는 화소의 비율과 가장 큰 차이.
    private func pixelDifference(_ a: PixelGrid, _ fa: CGRect, _ b: PixelGrid, _ fb: CGRect) -> (ratio: Double, max: Int) {
        let scale = a.scale
        let w = Int(min(fa.width, fb.width) * scale), h = Int(min(fa.height, fb.height) * scale)
        guard w > 2, h > 2 else { return (0, 0) }
        let ax = Int(fa.minX * scale), ay = Int(fa.minY * scale), bx = Int(fb.minX * scale), by = Int(fb.minY * scale)
        var differ = 0, worst = 0, total = 0
        for y in 0..<h {
            for x in 0..<w {
                let p = (ax + x, ay + y), q = (bx + x, by + y)
                guard p.0 >= 0, p.1 >= 0, q.0 >= 0, q.1 >= 0, p.0 < a.width, p.1 < a.height, q.0 < b.width, q.1 < b.height else { continue }
                let d = PixelGrid.distance(a.rgb(x: p.0, y: p.1), b.rgb(x: q.0, y: q.1))
                worst = max(worst, d)
                if d > 8 { differ += 1 }
                total += 1
            }
        }
        return (total == 0 ? 0 : Double(differ) / Double(total), worst)
    }

    private func compareWithDebug(window: CGRect) throws {
        var report: [[String: Any]] = []
        var problems: [String] = []
        for name in Self.screens {
            let presenceOnly = name == "08b-기록-아래"
            let debug = try load("Debug", name, window: window), release = try load("Release", name, window: window)
            let named = { (items: [Item]) in items.filter { !$0.label.isEmpty && $0.frame.width > 0 && $0.frame.height > 0 && $0.type != XCUIElement.ElementType.webView.rawValue } }
            let d = named(debug.items), r = named(release.items)
            var dCount: [String: Int] = [:], rCount: [String: Int] = [:]
            for i in d { dCount[i.key, default: 0] += 1 }
            for i in r { rCount[i.key, default: 0] += 1 }
            let labelOf = { (key: String) in key.split(separator: "|", maxSplits: 1).last.map(String.init) ?? key }
            let onlyDebug = dCount.filter { $0.value > (rCount[$0.key] ?? 0) }.map { labelOf($0.key) }.sorted()
            let onlyRelease = rCount.filter { $0.value > (dCount[$0.key] ?? 0) }.map { labelOf($0.key) }.sorted()
            let unexpectedDebug = onlyDebug.filter { !allowedDebugOnly($0) }
            if !unexpectedDebug.isEmpty { problems.append("\(name): Debug 에만 있는 요소 \(unexpectedDebug)") }
            if !onlyRelease.isEmpty { problems.append("\(name): Release 에만 있는 요소 \(onlyRelease)") }
            var row: [String: Any] = ["screen": name, "debugElements": d.count, "releaseElements": r.count, "onlyDebug": onlyDebug, "onlyRelease": onlyRelease, "unexpectedDebug": unexpectedDebug]
            if presenceOnly {
                row["presenceOnly"] = true
                report.append(row)
                continue
            }
            guard let a = debug.image, let b = release.image else {
                problems.append("\(name): 캡처를 읽지 못함")
                report.append(row)
                continue
            }
            // Debug 에만 있는 목록이 화면에 보이면 그 위 끝까지만 화면 전체와 자리를 엄하게 견준다. 글자는 접근성 상자보다
            // 몇 화소 위까지 그려져서(개발용 실행에서 제목 글자가 상자 위 6pt 까지 그려짐) 12pt 를 더 남긴다.
            let visibleDebugOnly = d.filter { allowedDebugOnly($0.label) && $0.frame.intersects(window) }
            let cut = visibleDebugOnly.isEmpty ? window.height : max(0, (visibleDebugOnly.map(\.frame.minY).min() ?? 0) - 12)
            let full = fullDifference(a, b, height: cut)
            if full > 30 { problems.append("\(name): 화면 전체 화소 차이 \(full)화소(위에서 \(Int(cut))pt 까지)") }
            var positionDiffs: [String] = [], sizeDiffs: [String] = [], pixelDiffs: [String] = []
            var compared = 0
            var seen: [String: Int] = [:]
            for item in d where (rCount[item.key] ?? 0) > 0 {
                let index = seen[item.key, default: 0]
                seen[item.key] = index + 1
                let peers = r.filter { $0.key == item.key }
                guard index < peers.count else { continue }
                let other = peers[index]
                let text = String(item.label.prefix(30))
                if abs(item.frame.width - other.frame.width) > 1 || abs(item.frame.height - other.frame.height) > 1 {
                    sizeDiffs.append("\(text) \(Int(item.frame.width))x\(Int(item.frame.height)) / \(Int(other.frame.width))x\(Int(other.frame.height))")
                    continue
                }
                if item.frame.maxY <= cut, abs(item.frame.minX - other.frame.minX) > 1 || abs(item.frame.minY - other.frame.minY) > 1 {
                    positionDiffs.append("\(text) (\(Int(item.frame.minX)),\(Int(item.frame.minY))) / (\(Int(other.frame.minX)),\(Int(other.frame.minY)))")
                }
                guard window.contains(item.frame), window.contains(other.frame), !visibleDebugOnly.contains(where: { $0.frame.intersects(item.frame) }) else { continue }
                let diff = pixelDifference(a, item.frame, b, other.frame)
                compared += 1
                if diff.ratio > 0.005 { pixelDiffs.append("\(text) \(String(format: "%.3f", diff.ratio)) 최대 \(diff.max)") }
            }
            if !positionDiffs.isEmpty { problems.append("\(name): 자리가 다른 요소 \(positionDiffs)") }
            if !sizeDiffs.isEmpty { problems.append("\(name): 크기가 다른 요소 \(sizeDiffs)") }
            if !pixelDiffs.isEmpty { problems.append("\(name): 모양이 다른 요소 \(pixelDiffs)") }
            row["fullDiffPixels"] = full
            row["fullComparedHeight"] = Int(cut)
            row["positionDiffs"] = positionDiffs
            row["sizeDiffs"] = sizeDiffs
            row["pixelCompared"] = compared
            row["pixelDiffs"] = pixelDiffs
            report.append(row)
        }
        let data = try JSONSerialization.data(withJSONObject: ["screens": report, "problems": problems], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: lookRoot.appendingPathComponent("compare.json"))
        XCTAssertEqual(problems, [], "Release 와 Debug 의 화면이 달라도 되는 곳 말고도 다르다")
    }
}
