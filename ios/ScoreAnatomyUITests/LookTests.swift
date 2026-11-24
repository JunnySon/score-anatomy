import UIKit
import XCTest

/// 작업 지시서 3-2의 3-3: 배포용 묶음(Release)과 시험용 묶음(Debug)의 같은 화면 모양을 견준다.
///
/// - 상태를 심는 장치(탐침, 기록 심기)는 Release 에 없어서 쓰지 않는다. XCUITest 의 실제 누름과 손가락 밀기로만 시작, 시험 선택,
///   답 입력, 입력 확인, 표시, 점수 해부, 계단, 기록 화면까지 가며 찍는다. Release 빌드에 새 장치를 넣지 않았다.
/// - 같은 테스트를 두 구성에서 돌린다. verify.sh 가 Debug 를 먼저 돌리고(SA_CONFIG 없음), Release 를 나중에 돌린다
///   (SA_CONFIG=Release). 둘 다 SA_LOOK 폴더의 구성 이름 폴더에 화면(png)과 접근성 요소(json)를 남긴다.
/// - Release 실행이 Debug 결과를 읽어 견준다: 이름이 있는 요소 가운데 한쪽에만 있는 것, 크기가 다른 것, 모양(화소)이 다른 것.
///   달라도 되는 것은 기록 화면의 준비 중인 기능 목록과 "테스트 진행자용" 링크뿐이다(입력 방식 전환은 일반 화면에 없다).
///   결과는 SA_LOOK/compare.json 에 적고, 그 밖의 차이가 있으면 실패한다.
@MainActor
final class LookTests: XCTestCase {
    static let screens = ["01-시작", "02-시험선택", "03-답입력", "04-입력확인", "05-표시", "06-점수해부", "07-계단", "08-기록"]
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
        // 화면 전환과 연달아 누르기 보호 표시가 끝난 뒤에 찍는다.
        Thread.sleep(forTimeInterval: 1.0)
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
        // 기록 화면은 맨 아래(준비 중인 기능 목록과 진행자용 링크가 있는 곳)까지 내려 찍는다.
        for _ in 0..<4 { handle.web.swipeUp(velocity: .fast) }
        try shot(handle, "08-기록")

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

    private func load(_ config: String, _ name: String, window: CGRect) throws -> (items: [Item], image: PixelGrid?) {
        let dir = folder(config)
        let data = try Data(contentsOf: dir.appendingPathComponent("\(name).json"))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let items = (json["items"] as? [[String: Any]] ?? []).map { d in
            Item(type: d["type"] as? Int ?? 0, label: d["label"] as? String ?? "",
                 frame: CGRect(x: d["x"] as? Double ?? 0, y: d["y"] as? Double ?? 0, width: d["w"] as? Double ?? 0, height: d["h"] as? Double ?? 0))
        }
        let cg = UIImage(contentsOfFile: dir.appendingPathComponent("\(name).png").path)?.cgImage
        let image = cg.flatMap { PixelGrid(cgImage: $0, scale: CGFloat($0.width) / max(window.width, 1)) }
        return (items, image)
    }

    private func allowedDebugOnly(_ label: String) -> Bool {
        Self.debugOnly.contains { label.contains($0) }
    }

    /// 두 캡처의 같은 요소 자리(각자의 frame)를 화소로 견준다. 큰 차이(채널 32 넘게)가 난 화소의 비율.
    private func pixelDifference(_ a: PixelGrid, _ fa: CGRect, _ b: PixelGrid, _ fb: CGRect) -> (ratio: Double, max: Int) {
        let scale = a.scale
        let w = Int(min(fa.width, fb.width) * scale), h = Int(min(fa.height, fb.height) * scale)
        guard w > 2, h > 2 else { return (0, 0) }
        let ax = Int(fa.minX * scale), ay = Int(fa.minY * scale), bx = Int(fb.minX * scale), by = Int(fb.minY * scale)
        var differ = 0, worst = 0, total = 0
        var y = 0
        while y < h {
            var x = 0
            while x < w {
                let p = (ax + x, ay + y), q = (bx + x, by + y)
                if p.0 >= 0, p.1 >= 0, q.0 >= 0, q.1 >= 0, p.0 < a.width, p.1 < a.height, q.0 < b.width, q.1 < b.height {
                    let d = PixelGrid.distance(a.rgb(x: p.0, y: p.1), b.rgb(x: q.0, y: q.1))
                    worst = max(worst, d)
                    if d > 32 { differ += 1 }
                    total += 1
                }
                x += 2
            }
            y += 2
        }
        return (total == 0 ? 0 : Double(differ) / Double(total), worst)
    }

    private func compareWithDebug(window: CGRect) throws {
        var report: [[String: Any]] = []
        var problems: [String] = []
        for name in Self.screens {
            let debug = try load("Debug", name, window: window), release = try load("Release", name, window: window)
            let screenBounds = CGRect(x: 0, y: 0, width: 2000, height: 2000)
            let named = { (items: [Item]) in items.filter { !$0.label.isEmpty && $0.frame.width > 0 && $0.frame.height > 0 && $0.type != XCUIElement.ElementType.webView.rawValue } }
            let d = named(debug.items), r = named(release.items)
            var dCount: [String: Int] = [:], rCount: [String: Int] = [:]
            for i in d { dCount[i.key, default: 0] += 1 }
            for i in r { rCount[i.key, default: 0] += 1 }
            let onlyDebug = dCount.filter { ($0.value) > (rCount[$0.key] ?? 0) }.map { $0.key.split(separator: "|", maxSplits: 1).last.map(String.init) ?? $0.key }
            let onlyRelease = rCount.filter { ($0.value) > (dCount[$0.key] ?? 0) }.map { $0.key.split(separator: "|", maxSplits: 1).last.map(String.init) ?? $0.key }
            let unexpectedDebug = onlyDebug.filter { !allowedDebugOnly($0) }
            // 같은 이름의 요소를 차례대로 짝짓고, 크기와 화소를 견준다. 화면 안에 보이는 것만, Debug 전용 요소와 겹치는 것은 뺀다.
            let debugOnlyFrames = d.filter { allowedDebugOnly($0.label) }.map(\.frame)
            var sizeDiffs: [String] = [], pixelDiffs: [String] = []
            var compared = 0
            var seen: [String: Int] = [:]
            for item in d where (dCount[item.key] ?? 0) > 0 && (rCount[item.key] ?? 0) > 0 {
                let index = seen[item.key, default: 0]
                seen[item.key] = index + 1
                let peers = r.filter { $0.key == item.key }
                guard index < peers.count else { continue }
                let other = peers[index]
                guard screenBounds.contains(item.frame) else { continue }
                if abs(item.frame.width - other.frame.width) > 1 || abs(item.frame.height - other.frame.height) > 1 {
                    sizeDiffs.append("\(item.label.prefix(30)) \(Int(item.frame.width))x\(Int(item.frame.height)) / \(Int(other.frame.width))x\(Int(other.frame.height))")
                    continue
                }
                guard window.contains(item.frame), window.contains(other.frame), !debugOnlyFrames.contains(where: { $0.intersects(item.frame) }),
                      let a = debug.image, let b = release.image else { continue }
                let diff = pixelDifference(a, item.frame, b, other.frame)
                compared += 1
                if diff.ratio > 0.01 { pixelDiffs.append("\(item.label.prefix(30)) \(String(format: "%.3f", diff.ratio)) 최대 \(diff.max)") }
            }
            if !unexpectedDebug.isEmpty { problems.append("\(name): Debug 에만 있는 요소 \(unexpectedDebug)") }
            if !onlyRelease.isEmpty { problems.append("\(name): Release 에만 있는 요소 \(onlyRelease)") }
            if !sizeDiffs.isEmpty { problems.append("\(name): 크기가 다른 요소 \(sizeDiffs)") }
            if !pixelDiffs.isEmpty { problems.append("\(name): 모양이 다른 요소 \(pixelDiffs)") }
            report.append(["screen": name, "debugElements": d.count, "releaseElements": r.count, "onlyDebug": onlyDebug.sorted(), "onlyRelease": onlyRelease.sorted(),
                           "unexpectedDebug": unexpectedDebug, "sizeDiffs": sizeDiffs, "pixelCompared": compared, "pixelDiffs": pixelDiffs])
        }
        let data = try JSONSerialization.data(withJSONObject: ["screens": report, "problems": problems], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: lookRoot.appendingPathComponent("compare.json"))
        XCTAssertEqual(problems, [], "Release 와 Debug 의 화면이 달라도 되는 곳 말고도 다르다")
    }
}
