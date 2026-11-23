import Foundation
import WebKit

/// 바깥 통신 차단. 웹뷰 안에서 http, https(와 ws, wss)로 나가는 요청을 모두 막고,
/// 처음 문서(앱 안의 index.html)가 아닌 곳으로 가려는 이동은 취소한다.
/// 껍데기 코드 자체는 네트워크 API 를 쓰지 않는다.
enum NetworkGuard {
    /// 컴파일한 규칙 목록의 이름. 규칙을 바꾸면 끝의 번호를 올린다.
    static let ruleListIdentifier = "sa-block-remote-1"

    /// WebKit 콘텐츠 규칙. 주소가 http:, https:, ws:, wss: 로 시작하는 요청을 모두 막는다(대소문자 구분 없음).
    static let rules = """
    [
      {"trigger": {"url-filter": "^https?:"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^wss?:"}, "action": {"type": "block"}}
    ]
    """

    /// 규칙을 컴파일한다. 실패하면 오류를 던진다(그때 껍데기는 묶음을 싣지 않고 실패 안내를 띄운다).
    @MainActor
    static func compile() async throws -> WKContentRuleList {
        guard let store = WKContentRuleListStore.default() else { throw GuardError.noStore }
        guard let list = try await store.compileContentRuleList(forIdentifier: ruleListIdentifier, encodedContentRuleList: rules) else {
            throw GuardError.compileFailed
        }
        return list
    }

    enum GuardError: Error {
        case noStore
        case compileFailed
    }

    /// 이 이동을 허락하는지. 처음 문서와 같은 파일을 가리키는 주 화면(main frame)의 이동만 허락한다.
    /// # 뒤만 다른 이동(웹의 화면 이동)도 같은 문서라 허락한다. 쿼리가 붙거나 다른 파일, 다른 스킴은 취소한다.
    static func allowsNavigation(to url: URL?, isMainFrame: Bool, document: URL) -> Bool {
        guard isMainFrame, let url, url.isFileURL, document.isFileURL else { return false }
        guard url.query == nil else { return false }
        return samePath(url, document)
    }

    /// 지금 문서 안에서 # 뒤만 바뀌는 이동인지(새 문서를 만들지 않는 이동).
    static func isSameDocument(_ url: URL?, current: URL?) -> Bool {
        guard let url, let current, url.isFileURL, current.isFileURL, url.fragment != nil else { return false }
        return samePath(url, current)
    }

    private static func samePath(_ a: URL, _ b: URL) -> Bool {
        // /var 와 /private/var 처럼 같은 파일을 가리키는 다른 표기도 같게 본다.
        a.standardizedFileURL.resolvingSymlinksInPath().path == b.standardizedFileURL.resolvingSymlinksInPath().path
    }
}
