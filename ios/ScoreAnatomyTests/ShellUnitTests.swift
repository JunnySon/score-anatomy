import CryptoKit
import JavaScriptCore
import UIKit
import WebKit
import XCTest
@testable import ScoreAnatomy

/// 글자 크기 배율.
final class FontScaleTests: XCTestCase {
    func testDefaultSizeIsOne() {
        XCTAssertEqual(FontScale.value(for: .large), 1.0)
    }

    func testSmallerSettingsAreOne() {
        for category in [UIContentSizeCategory.extraSmall, .small, .medium] {
            XCTAssertEqual(FontScale.value(for: category), 1.0, "\(category.rawValue)")
        }
    }

    func testLargestSettingIsTwo() {
        XCTAssertEqual(FontScale.value(for: .accessibilityExtraExtraExtraLarge), 2.0)
    }

    func testUnspecifiedIsOne() {
        XCTAssertEqual(FontScale.value(for: .unspecified), 1.0)
    }

    func testLargerSettingsFollowBodyTextScaling() {
        // 시스템 본문 글자(기본 17pt)가 커지는 비율과 같다. 가장 큰 일반 크기는 23pt, 접근성 첫 크기는 28pt, 둘째는 33pt.
        XCTAssertEqual(FontScale.value(for: .extraLarge), 19.0 / 17.0, accuracy: 0.001)
        XCTAssertEqual(FontScale.value(for: .extraExtraExtraLarge), 23.0 / 17.0, accuracy: 0.001)
        XCTAssertEqual(FontScale.value(for: .accessibilityMedium), 28.0 / 17.0, accuracy: 0.001)
        XCTAssertEqual(FontScale.value(for: .accessibilityLarge), 33.0 / 17.0, accuracy: 0.001)
        XCTAssertEqual(FontScale.value(for: .accessibilityExtraLarge), 2.0, "40pt 는 2배를 넘어서 2에서 멈춘다")
    }

    func testAllSettingsStayInRangeAndNeverShrink() {
        let ordered: [UIContentSizeCategory] = [
            .extraSmall, .small, .medium, .large, .extraLarge, .extraExtraLarge, .extraExtraExtraLarge,
            .accessibilityMedium, .accessibilityLarge, .accessibilityExtraLarge, .accessibilityExtraExtraLarge, .accessibilityExtraExtraExtraLarge,
        ]
        var previous = 0.0
        var line: [String] = []
        for category in ordered {
            let value = FontScale.value(for: category)
            XCTAssertGreaterThanOrEqual(value, 1.0)
            XCTAssertLessThanOrEqual(value, 2.0)
            XCTAssertGreaterThanOrEqual(value, previous, "\(category.rawValue) 에서 줄어들면 안 된다")
            previous = value
            line.append("\(category.rawValue)=\(String(format: "%.3f", value))")
        }
        // 검증 기록에 남길 수 있게 값을 출력한다.
        print("SA_FONT_SCALES " + line.joined(separator: " "))
    }
}

/// 웹 묶음과 manifest.json.
final class ManifestTests: XCTestCase {
    private struct Manifest: Decodable {
        struct File: Decodable {
            let sha256: String
            let bytes: Int
        }
        let version: String
        let bridge: Int
        let dirty: Bool
        let files: [String: File]
    }

    private func manifest() throws -> Manifest {
        let url = try XCTUnwrap(WebBundle.manifestURL(in: .main), "앱 안에 manifest.json 이 있어야 한다")
        return try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
    }

    func testBundledIndexMatchesManifestSHA256() throws {
        let manifest = try manifest()
        let index = try XCTUnwrap(WebBundle.indexURL(in: .main), "\(WebBundle.folder)/index.html 이 앱 안에 있어야 한다")
        let data = try Data(contentsOf: index)
        let expected = try XCTUnwrap(manifest.files["\(WebBundle.folder)/index.html"])
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(digest, expected.sha256)
        XCTAssertEqual(data.count, expected.bytes)
        XCTAssertFalse(manifest.dirty)
    }

    func testBridgeVersionAndAppVersionMatchManifest() throws {
        let manifest = try manifest()
        XCTAssertEqual(manifest.bridge, BridgeSpec.version, "묶음의 다리 규격 번호와 껍데기의 번호가 같아야 한다")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, manifest.version, "앱 버전은 manifest 의 버전과 같다")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String, "1")
    }

    func testOnlyOneBundleIsShipped() {
        // Debug 빌드는 시험용 묶음만, Release 빌드는 배포용 묶음만 싣는다.
        let other = WebBundle.folder == "app-test" ? "app-release" : "app-test"
        XCTAssertNotNil(Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: WebBundle.folder))
        XCTAssertNil(Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: other), "\(other) 는 실리지 않아야 한다")
    }
}

/// 통신 차단 규칙과 이동 허락.
@MainActor
final class NetworkGuardTests: XCTestCase {
    func testRulesBlockHttpHttpsWsWss() throws {
        let rules = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(NetworkGuard.rules.utf8)) as? [[String: Any]])
        let filters = rules.compactMap { ($0["trigger"] as? [String: Any])?["url-filter"] as? String }
        let actions = rules.compactMap { ($0["action"] as? [String: Any])?["type"] as? String }
        XCTAssertEqual(filters, ["^https?:", "^wss?:"])
        XCTAssertEqual(actions, ["block", "block"])
        for url in ["http://example.com/", "https://example.com/a", "HTTPS://EXAMPLE.COM", "ws://127.0.0.1:80/", "wss://x"] {
            XCTAssertTrue(filters.contains { url.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }, url)
        }
        for url in ["file:///index.html", "data:text/plain,1", "blob:file:///x", "about:blank"] {
            XCTAssertFalse(filters.contains { url.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }, url)
        }
    }

    func testRulesCompileInWebKit() async throws {
        let list = try await NetworkGuard.compile()
        XCTAssertEqual(list.identifier, NetworkGuard.ruleListIdentifier)
    }

    func testOnlySameDocumentNavigationIsAllowed() throws {
        let doc = URL(fileURLWithPath: "/tmp/sa/app-test/index.html")
        XCTAssertTrue(NetworkGuard.allowsNavigation(to: doc, isMainFrame: true, document: doc))
        XCTAssertTrue(NetworkGuard.allowsNavigation(to: URL(string: doc.absoluteString + "#/input"), isMainFrame: true, document: doc))
        XCTAssertTrue(NetworkGuard.allowsNavigation(to: URL(string: doc.absoluteString + "#/?input=keypad"), isMainFrame: true, document: doc))
        XCTAssertFalse(NetworkGuard.allowsNavigation(to: doc, isMainFrame: false, document: doc), "다른 틀(iframe)에 싣는 것은 막는다")
        XCTAssertFalse(NetworkGuard.allowsNavigation(to: URL(string: doc.absoluteString + "?x=1"), isMainFrame: true, document: doc))
        XCTAssertFalse(NetworkGuard.allowsNavigation(to: URL(fileURLWithPath: "/tmp/sa/app-test/other.html"), isMainFrame: true, document: doc))
        XCTAssertFalse(NetworkGuard.allowsNavigation(to: URL(fileURLWithPath: "/etc/hosts"), isMainFrame: true, document: doc))
        for text in ["http://127.0.0.1/", "https://example.com/", "about:blank", "data:text/html,1", "javascript:alert(1)", "mailto:a@b.c", "tel:010", "sms:1"] {
            XCTAssertFalse(NetworkGuard.allowsNavigation(to: URL(string: text), isMainFrame: true, document: doc), text)
        }
        XCTAssertFalse(NetworkGuard.allowsNavigation(to: nil, isMainFrame: true, document: doc))
    }

    func testSymlinkedPathCountsAsSameDocument() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nav-\(UUID().uuidString)")
        let real = root.appendingPathComponent("real")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: real.appendingPathComponent("index.html"))
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertTrue(NetworkGuard.allowsNavigation(to: link.appendingPathComponent("index.html"), isMainFrame: true, document: real.appendingPathComponent("index.html")))
    }

    func testSameDocumentMeansOnlyTheFragmentChanges() {
        let doc = URL(fileURLWithPath: "/tmp/sa/app-test/index.html")
        let withHash = URL(string: doc.absoluteString + "#/history")
        XCTAssertTrue(NetworkGuard.isSameDocument(withHash, current: URL(string: doc.absoluteString + "#/")))
        XCTAssertTrue(NetworkGuard.isSameDocument(withHash, current: doc))
        XCTAssertFalse(NetworkGuard.isSameDocument(doc, current: withHash), "# 없는 같은 주소로 가면 문서를 새로 읽는다")
        XCTAssertFalse(NetworkGuard.isSameDocument(withHash, current: nil))
        XCTAssertFalse(NetworkGuard.isSameDocument(URL(string: "file:///tmp/other.html#/"), current: doc))
    }
}

/// 다리 메시지 읽기와 웹에 알리는 글자.
final class BridgeTests: XCTestCase {
    func testParseStoreMessages() {
        XCTAssertEqual(BridgeCommand.parse(name: "saStore", body: ["op": "save", "json": "{}"]), .save("{}"))
        XCTAssertEqual(BridgeCommand.parse(name: "saStore", body: ["op": "archive"]), .archive)
        XCTAssertEqual(BridgeCommand.parse(name: "saStore", body: ["op": "save"]), .saveMalformed)
        XCTAssertEqual(BridgeCommand.parse(name: "saStore", body: ["op": "save", "json": 3]), .saveMalformed)
        XCTAssertEqual(BridgeCommand.parse(name: "saStore", body: ["op": "delete"]), .ignored)
        XCTAssertEqual(BridgeCommand.parse(name: "saStore", body: "save"), .ignored)
    }

    func testParseHapticAndCopy() {
        XCTAssertEqual(BridgeCommand.parse(name: "saHaptic", body: "key"), .hapticKey)
        XCTAssertEqual(BridgeCommand.parse(name: "saHaptic", body: "buzz"), .ignored)
        XCTAssertEqual(BridgeCommand.parse(name: "saCopy", body: "11번, 15번"), .copy("11번, 15번"))
        XCTAssertEqual(BridgeCommand.parse(name: "saCopy", body: ""), .copy(""))
        XCTAssertEqual(BridgeCommand.parse(name: "saCopy", body: 12), .copyMalformed)
        XCTAssertEqual(BridgeCommand.parse(name: "saUnknown", body: "x"), .ignored)
    }

    func testToWebJSONKeepsBooleansAndNumbers() throws {
        let context = try XCTUnwrap(JSContext())
        func parsed(_ message: ToWeb) -> JSValue {
            context.setObject(message.json, forKeyedSubscript: "s" as NSString)
            return context.evaluateScript("JSON.parse(s)")
        }
        XCTAssertEqual(parsed(.storeFailed).forProperty("type").toString(), "storeFailed")
        context.setObject(ToWeb.copied(true).json, forKeyedSubscript: "s" as NSString)
        XCTAssertTrue(context.evaluateScript("JSON.parse(s).ok === true").toBool(), "ok 는 숫자 1이 아니라 참이어야 한다(웹은 ok === true 로 본다)")
        context.setObject(ToWeb.copied(false).json, forKeyedSubscript: "s" as NSString)
        XCTAssertTrue(context.evaluateScript("JSON.parse(s).ok === false").toBool())
        context.setObject(ToWeb.fontScale(1.5).json, forKeyedSubscript: "s" as NSString)
        XCTAssertTrue(context.evaluateScript("JSON.parse(s).value === 1.5 && JSON.parse(s).type === 'fontScale'").toBool())
    }

    func testDeliverScriptCallsWebFunctionOnlyWhenReady() throws {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("var window = {}; var got = [];")
        // 함수가 아직 없으면 아무것도 하지 않는다(오류 없음).
        context.evaluateScript(ToWeb.copied(true).deliverScript)
        XCTAssertNil(context.exception)
        context.evaluateScript("window.__saFromApp = function (m) { got.push(m); };")
        context.evaluateScript(ToWeb.copied(true).deliverScript)
        context.evaluateScript(ToWeb.storeFailed.deliverScript)
        context.evaluateScript(ToWeb.fontScale(1.25).deliverScript)
        XCTAssertNil(context.exception)
        XCTAssertTrue(context.evaluateScript("got.length === 3 && got[0].type === 'copied' && got[0].ok === true").toBool(), "ok 는 숫자가 아니라 참이어야 한다")
        XCTAssertTrue(context.evaluateScript("got[1].type === 'storeFailed' && got[2].type === 'fontScale' && got[2].value === 1.25").toBool())
    }

    func testOutboxKeepsOrder() {
        var outbox = Outbox()
        outbox.add(.storeFailed)
        outbox.add(.copied(true))
        outbox.add(.fontScale(1.2))
        XCTAssertEqual(outbox.drain(), [.storeFailed, .copied(true), .fontScale(1.2)])
        XCTAssertEqual(outbox.drain(), [])
        outbox.add(.storeFailed)
        outbox.clear()
        XCTAssertEqual(outbox.pending, [])
    }

    private func evaluate(_ source: String) throws -> JSContext {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("var window = {};")
        context.evaluateScript(source)
        XCTAssertNil(context.exception, "\(String(describing: context.exception))")
        return context
    }

    func testAppInfoScriptCarriesStoreExactly() throws {
        let tricky = "{\"a\":\"따옴표 \\\" 와 \\\\ 역슬래시\",\"b\":\"줄\n바꿈\"}\u{2028}\u{2029}</script>"
        let context = try evaluate(AppInfoScript.source(appVersion: "0.2.0", store: .text(tricky), fontScale: 1.25))
        let app = context.evaluateScript("window.__SA_APP__")!
        XCTAssertTrue(app.isObject, "글자가 아니라 객체로 넣는다")
        XCTAssertEqual(app.forProperty("platform").toString(), "ios")
        XCTAssertTrue(context.evaluateScript("window.__SA_APP__.bridge === 1").toBool())
        XCTAssertEqual(app.forProperty("appVersion").toString(), "0.2.0")
        XCTAssertEqual(app.forProperty("fontScale").toDouble(), 1.25)
        XCTAssertEqual(app.forProperty("store").toString(), tricky)
    }

    func testAppInfoScriptStoreNullAndEmpty() throws {
        let missing = try evaluate(AppInfoScript.source(appVersion: "0.2.0", store: .missing, fontScale: 1))
        XCTAssertTrue(missing.evaluateScript("window.__SA_APP__.store === null").toBool(), "파일이 없으면 null")
        let unreadable = try evaluate(AppInfoScript.source(appVersion: "0.2.0", store: .unreadable, fontScale: 1))
        XCTAssertTrue(unreadable.evaluateScript("window.__SA_APP__.store === ''").toBool(), "읽지 못하면 빈 글자")
    }
}

/// 저장하는 동안 잡아 두는 시간.
@MainActor
final class BackgroundTicketTests: XCTestCase {
    private final class FakeTasks: BackgroundTasking {
        var begun: [String] = []
        var ended: [UIBackgroundTaskIdentifier] = []
        var expirations: [@MainActor () -> Void] = []
        private var next = 1

        func begin(name: String, expiration: @escaping @MainActor () -> Void) -> UIBackgroundTaskIdentifier {
            begun.append(name)
            expirations.append(expiration)
            defer { next += 1 }
            return UIBackgroundTaskIdentifier(rawValue: next)
        }

        func end(_ identifier: UIBackgroundTaskIdentifier) {
            ended.append(identifier)
        }
    }

    func testTicketEndsOnce() {
        let tasks = FakeTasks()
        let ticket = BackgroundTicket(tasks: tasks, name: "기록 저장")
        ticket.end()
        ticket.end()
        XCTAssertEqual(tasks.begun, ["기록 저장"])
        XCTAssertEqual(tasks.ended.count, 1)
    }

    func testExpirationEndsTicketAndLaterEndDoesNothing() {
        let tasks = FakeTasks()
        let ticket = BackgroundTicket(tasks: tasks, name: "기록 저장")
        tasks.expirations.first?()
        XCTAssertEqual(tasks.ended.count, 1, "시간이 다 되면 놓는다")
        ticket.end()
        XCTAssertEqual(tasks.ended.count, 1)
    }
}

/// 복사.
@MainActor
final class ClipboardTests: XCTestCase {
    func testCopyPutsTextOnPasteboard() throws {
        let board = try XCTUnwrap(UIPasteboard(name: UIPasteboard.Name("sa-test-\(UUID().uuidString)"), create: true))
        XCTAssertTrue(Clipboard.copy("예시 좌표 9번", to: board))
        XCTAssertEqual(board.string, "예시 좌표 9번")
        UIPasteboard.remove(withName: board.name)
    }
}

/// 껍데기 웹뷰의 설정(튕김, 미리보기, 가장자리 밀기, 웹 저장소, 팝업, 바깥 조회).
@MainActor
final class ShellConfigurationTests: XCTestCase {
    private final class Sink: NSObject, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {}
    }

    func testWebViewSettings() {
        let webView = ShellController.makeWebView(messageHandler: Sink())
        let configuration = webView.configuration
        XCTAssertFalse(configuration.websiteDataStore.isPersistent, "웹 쪽 저장소를 남기지 않는다")
        XCTAssertFalse(webView.scrollView.bounces, "화면 전체가 튕기지 않는다")
        XCTAssertFalse(webView.scrollView.alwaysBounceVertical)
        XCTAssertEqual(webView.scrollView.contentInsetAdjustmentBehavior, .never)
        XCTAssertFalse(webView.allowsLinkPreview, "길게 눌러 뜨는 미리보기가 없다")
        XCTAssertFalse(webView.allowsBackForwardNavigationGestures, "가장자리 밀기로 뒤로 가지 않는다")
        XCTAssertFalse(configuration.preferences.javaScriptCanOpenWindowsAutomatically)
        XCTAssertFalse(configuration.preferences.isFraudulentWebsiteWarningEnabled, "사기 사이트 경고(바깥 조회)를 쓰지 않는다")
        XCTAssertEqual(configuration.dataDetectorTypes, [])
        XCTAssertFalse(webView.isOpaque)
        #if DEBUG
        XCTAssertTrue(webView.isInspectable, "웹 검사기는 Debug 에서만")
        #else
        XCTAssertFalse(webView.isInspectable)
        #endif
    }

    func testOnlyTheThreeBridgeHandlersAreRegistered() {
        XCTAssertEqual(BridgeSpec.Inbound.allCases.map(\.rawValue), ["saStore", "saHaptic", "saCopy"])
    }
}
