import SwiftUI
import WebKit

/// 앱의 시작점. 화면 전체를 웹뷰 하나가 차지한다.
@main
struct ScoreAnatomyApp: App {
    @State private var shell = ShellController()

    var body: some Scene {
        WindowGroup {
            RootView(shell: shell, state: shell.state)
        }
    }
}

/// 맨 아래에 토큰 배경색을 깔고 그 위에 웹뷰(또는 실패 안내)를 둔다.
struct RootView: View {
    let shell: ShellController
    let state: ShellState

    var body: some View {
        ZStack {
            Color(uiColor: Palette.background)
                .ignoresSafeArea()
            if state.phase == .failed {
                LoadFailureView()
            } else {
                // 위아래 여백은 웹이 안전 영역 값(env(safe-area-inset-*))으로 처리한다.
                // 키보드 자리도 웹뷰가 스스로 맞추므로 SwiftUI 가 웹뷰 크기를 줄이지 않게 한다.
                WebViewHost(webView: shell.webView)
                    .ignoresSafeArea()
            }
        }
    }
}

/// 묶음을 열지 못했을 때 흰 화면 대신 보여 주는 안내.
struct LoadFailureView: View {
    var body: some View {
        Text(verbatim: ShellText.loadFailed)
            .font(.body)
            .foregroundStyle(Color(uiColor: Palette.text))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("load-failed")
    }
}

/// SwiftUI 화면에 웹뷰를 그대로 놓는다.
struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// 껍데기가 직접 띄우는 글자. 해요체, 느낌표와 이모지 없음.
enum ShellText {
    static let loadFailed = "화면을 불러오지 못했어요. 앱을 다시 켜 주세요."
}

/// 디자인 토큰(docs/작업지시서.md 5장)의 색. 밝은 화면, 어두운 화면 순.
enum Palette {
    /// 배경 #FFFFFF, #111315
    static let background = dynamic(light: 0xFFFFFF, dark: 0x111315)
    /// 본문 글자 #17191C, #ECEEF1
    static let text = dynamic(light: 0x17191C, dark: 0xECEEF1)

    private static func dynamic(light: Int, dark: Int) -> UIColor {
        UIColor { traits in
            rgb(traits.userInterfaceStyle == .dark ? dark : light)
        }
    }

    private static func rgb(_ value: Int) -> UIColor {
        UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
