import UIKit
import UniformTypeIdentifiers

/// 기기의 글자 크기 설정에서 구하는 배율(docs/앱_다리_규격.md 1장의 fontScale).
/// 기본 크기에서 1, 그보다 작은 설정도 1, 가장 크게는 2.
/// 그 설정에서 시스템 본문(.body) 글자가 기본 크기(큰 글자 설정이 아닌 "기본", 17pt)보다 몇 배인지를 쓴다.
/// 예: 가장 큰 일반 크기 23pt 는 23/17, 접근성 첫 크기 28pt 는 28/17, 그보다 크면 2 에서 멈춘다.
enum FontScale {
    static let minimum = 1.0
    static let maximum = 2.0

    static func value(for category: UIContentSizeCategory) -> Double {
        guard category != .unspecified else { return minimum }
        let base = UIFont.preferredFont(forTextStyle: .body, compatibleWith: UITraitCollection(preferredContentSizeCategory: .large)).pointSize
        let size = UIFont.preferredFont(forTextStyle: .body, compatibleWith: UITraitCollection(preferredContentSizeCategory: category)).pointSize
        guard base > 0 else { return minimum }
        let ratio = Double(size / base)
        guard ratio.isFinite else { return minimum }
        return min(maximum, max(minimum, ratio))
    }

    /// 지금 기기 설정의 배율.
    @MainActor
    static func current() -> Double {
        value(for: UIApplication.shared.preferredContentSizeCategory)
    }
}

/// 키패드 누름에 쓰는 가벼운 햅틱. 그 밖의 진동과 소리는 없다.
@MainActor
final class KeyHaptics {
    private var generator: UIImpactFeedbackGenerator?

    func key(in view: UIView) {
        let generator = self.generator ?? Self.makeGenerator(view: view)
        self.generator = generator
        generator.impactOccurred()
        // 다음 누름이 늦지 않게 준비해 둔다.
        generator.prepare()
    }

    private static func makeGenerator(view: UIView) -> UIImpactFeedbackGenerator {
        // 최소 버전이 iOS 18 이라 뷰를 받는 생성자(iOS 17.5 부터)를 늘 쓸 수 있다.
        UIImpactFeedbackGenerator(style: .light, view: view)
    }
}

/// 복사. 이 기기의 클립보드에만 넣는다(다른 기기로 넘기지 않는 옵션). 클립보드를 읽지는 않는다.
@MainActor
enum Clipboard {
    static func copy(_ text: String, to pasteboard: UIPasteboard = .general) -> Bool {
        let before = pasteboard.changeCount
        pasteboard.setItems([[UTType.utf8PlainText.identifier: text]], options: [.localOnly: true])
        return pasteboard.changeCount != before
    }
}
