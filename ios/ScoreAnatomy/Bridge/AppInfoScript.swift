import Foundation

/// 문서가 시작될 때(문서의 다른 스크립트보다 먼저) 페이지에 넣는 window.__SA_APP__ (docs/앱_다리_규격.md 1장).
enum AppInfoScript {
    static func source(appVersion: String, store: StoreRead, fontScale: Double) -> String {
        var info: [String: Any] = [
            "platform": BridgeSpec.platform,
            "bridge": BridgeSpec.version,
            "appVersion": appVersion,
            "fontScale": fontScale,
        ]
        switch store {
        case .missing:
            // 파일이 없으면 null.
            info["store"] = NSNull()
        case .text(let text):
            info["store"] = text
        case .unreadable:
            // 파일이 있는데 글자로 읽지 못하면 빈 글자. 웹이 덮어쓰기 전에 보관을 먼저 요청한다.
            info["store"] = ""
        }
        guard let data = try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]) else {
            // 만들지 못하면 객체를 넣지 않는다. 웹은 다리를 쓸 수 없는 것으로 보고 저장하지 않는다(기록을 덮어쓰지 않는다).
            return "window.__SA_APP__ = null;"
        }
        // U+2028, U+2029 는 JSON 에서는 그대로 써도 되지만 예전 자바스크립트 문법에서는 줄바꿈으로 읽혔다. 이스케이프해 둔다.
        let json = String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return "window.__SA_APP__ = \(json);"
    }
}
