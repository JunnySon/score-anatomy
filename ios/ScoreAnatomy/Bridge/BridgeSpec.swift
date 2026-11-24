import Foundation

/// 웹과 껍데기의 약속(docs/앱_다리_규격.md). 규격 번호는 이 파일 한 곳에 둔다.
enum BridgeSpec {
    /// 다리 규격 번호. 웹 묶음의 manifest.json 에 적힌 bridge(묶음이 돌아가는 가장 낮은 규격) 이상, bridgeMax(웹이 아는
    /// 가장 높은 규격) 이하여야 한다(docs/앱_다리_규격.md 7-2, 단위 테스트 ManifestTests 가 확인한다).
    static let version = 1

    /// 껍데기 종류(window.__SA_APP__.platform).
    static let platform = "ios"

    /// 웹이 window.webkit.messageHandlers.<이름>.postMessage 로 보내는 메시지 이름.
    enum Inbound: String, CaseIterable, Sendable {
        case store = "saStore"
        case haptic = "saHaptic"
        case copy = "saCopy"
    }
}

/// 앱에 싣는 웹 묶음(docs/앱_다리_규격.md 5장).
enum WebBundle {
    #if DEBUG
    /// Debug 빌드는 시험용 묶음만 싣는다(진행자용 화면 포함).
    static let folder = "app-test"
    #else
    /// Release 빌드는 배포용 묶음만 싣는다.
    static let folder = "app-release"
    #endif

    static func indexURL(in bundle: Bundle) -> URL? {
        bundle.url(forResource: "index", withExtension: "html", subdirectory: folder)
    }

    static func manifestURL(in bundle: Bundle) -> URL? {
        bundle.url(forResource: "manifest", withExtension: "json")
    }
}
