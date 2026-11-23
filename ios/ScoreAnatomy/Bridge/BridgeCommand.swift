import Foundation

/// 웹이 보낸 메시지를 껍데기가 할 일로 바꾼 것(docs/앱_다리_규격.md 2장).
enum BridgeCommand: Equatable, Sendable {
    /// saStore { op: "save", json }: store.json 에 기록 전체를 저장한다.
    case save(String)
    /// saStore { op: "archive" }: store.json 을 지우지 않고 다른 이름으로 보관한다.
    case archive
    /// saStore 의 save 인데 json 이 글자가 아니다. 저장하지 않고 storeFailed 로 알린다.
    case saveMalformed
    /// saHaptic "key": 가벼운 햅틱 한 번.
    case hapticKey
    /// saCopy: 이 기기의 클립보드에 넣을 글자.
    case copy(String)
    /// saCopy 인데 글자가 아니다. 복사하지 않고 copied(ok: false)로 답한다(saCopy 하나에 copied 하나).
    case copyMalformed
    /// 알 수 없는 메시지. 아무것도 하지 않는다.
    case ignored

    static func parse(name: String, body: Any) -> BridgeCommand {
        guard let inbound = BridgeSpec.Inbound(rawValue: name) else { return .ignored }
        switch inbound {
        case .store:
            guard let message = body as? [String: Any], let op = message["op"] as? String else { return .ignored }
            switch op {
            case "save":
                guard let json = message["json"] as? String else { return .saveMalformed }
                return .save(json)
            case "archive":
                return .archive
            default:
                return .ignored
            }
        case .haptic:
            return (body as? String) == "key" ? .hapticKey : .ignored
        case .copy:
            guard let text = body as? String else { return .copyMalformed }
            return .copy(text)
        }
    }
}

/// 껍데기가 window.__saFromApp 으로 웹에 알리는 것(docs/앱_다리_규격.md 3장).
enum ToWeb: Equatable, Sendable {
    case storeFailed
    case fontScale(Double)
    case copied(Bool)

    /// 웹에 넘기는 JSON 글자. 웹 쪽에서 JSON.parse 로 객체를 만든다(참과 거짓이 숫자로 바뀌지 않게).
    var json: String {
        let object: [String: Any]
        switch self {
        case .storeFailed:
            object = ["type": "storeFailed"]
        case .fontScale(let value):
            object = ["type": "fontScale", "value": value]
        case .copied(let ok):
            object = ["type": "copied", "ok": ok]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    /// 웹에 알리는 스크립트. JSON 은 그대로 자바스크립트 객체 글자로 쓸 수 있다(여기서 만드는 JSON 은 영문, 숫자, 참거짓뿐이다).
    /// 함수가 아직 없으면 아무것도 하지 않는다.
    /// WebKit 의 기본(Objective-C) API 인 evaluateJavaScript 로 돌린다. iOS 26 SDK 의 Swift 전용 함수(callAsyncJavaScript)는
    /// iOS 17, 18 에 없는 라이브러리(libswiftWebKit)를 불러서 앱이 켜지지 않는다(docs/ios_결정기록.md).
    var deliverScript: String {
        "(function () { var f = window.__saFromApp; if (typeof f === 'function') { f(\(json)); } })();"
    }
}

/// 페이지 읽기가 끝나기(didFinish) 전에 생긴 알림을 받은 차례대로 모아 둔다.
struct Outbox: Sendable {
    private(set) var pending: [ToWeb] = []

    mutating func add(_ message: ToWeb) {
        pending.append(message)
    }

    /// 모아 둔 것을 차례대로 꺼내고 비운다.
    mutating func drain() -> [ToWeb] {
        let all = pending
        pending.removeAll()
        return all
    }

    mutating func clear() {
        pending.removeAll()
    }
}
