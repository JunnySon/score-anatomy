import Observation
import UIKit
import WebKit

/// 껍데기의 상태. 화면(RootView)이 이 값을 보고 웹뷰나 실패 안내를 그린다.
@MainActor
@Observable
final class ShellState {
    enum Phase: Equatable {
        /// 아직 시작하지 않았다.
        case starting
        /// 차단 규칙을 걸고 묶음을 싣는 중이다.
        case loading
        /// 웹 화면이 그려졌다.
        case ready
        /// 묶음을 열지 못했다. "화면을 불러오지 못했어요. 앱을 다시 켜 주세요."를 보여 준다.
        case failed
    }

    var phase: Phase = .starting
}

/// 왜 실패했는지(기록용).
enum ShellFailure: String, Sendable {
    case missingBundle
    case rulesFailed
    case loadFailed
    case blankPage
    case timeout
    case webProcessCrashed
}

/// 껍데기의 중심. 웹뷰 하나를 만들어 앱 안의 웹 묶음을 싣고, 다리(docs/앱_다리_규격.md)를 잇는다.
/// 화면과 계산은 웹 코드가 맡고, 여기서는 기록 파일 저장, 햅틱, 글자 크기 전달, 복사, 바깥 통신 차단만 맡는다.
@MainActor
final class ShellController {
    let state = ShellState()
    let webView: WKWebView
    let store: StoreFile

    private var documentURL: URL?
    private let appVersion: String
    private let background: BackgroundTasking
    private let haptics = KeyHaptics()
    private let messageProxy = MessageProxy()
    private let delegate = WebDelegate()
    private var outbox = Outbox()
    /// 페이지 읽기가 끝났는지(didFinish). 그 전에는 웹에 알릴 것을 모아 둔다.
    private var pageReady = false
    /// 웹이 마지막으로 알고 있는 글자 크기 배율(넣어 준 값이나 마지막으로 보낸 값).
    private var lastFontScale = FontScale.minimum
    /// 웹 화면 프로세스가 끝난 시각들. 짧은 동안 거듭 끝나면 실패 안내를 띄운다.
    private var webProcessEnds: [Date] = []
    private var loadWatchdog: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []
    #if DEBUG
    private(set) var debug: DebugProbe?
    private var debugOptions = DebugOptions()
    #endif

    init(bundle: Bundle = .main, background: BackgroundTasking? = nil) {
        #if DEBUG
        let options = DebugOptions.parse(ProcessInfo.processInfo.arguments)
        debugOptions = options
        store = StoreFile(directory: options.storeDirectory ?? StoreLocation.defaultDirectory())
        documentURL = options.forceLoadFailure ? bundle.bundleURL.appendingPathComponent("없는-묶음/index.html") : WebBundle.indexURL(in: bundle)
        #else
        store = StoreFile(directory: StoreLocation.defaultDirectory())
        documentURL = WebBundle.indexURL(in: bundle)
        #endif
        appVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        self.background = background ?? AppBackgroundTasks()

        let configuration = WKWebViewConfiguration()
        // 웹 쪽 저장소(쿠키, localStorage 등)는 남기지 않는다. 기록은 다리로 store.json 에만 둔다.
        configuration.websiteDataStore = .nonPersistent()
        // 전화번호나 주소를 자동으로 링크로 바꾸지 않는다.
        configuration.dataDetectorTypes = []
        // 사기 사이트 경고(바깥 조회)를 쓰지 않는다. 바깥 주소를 열지 않으므로 필요 없다.
        configuration.preferences.isFraudulentWebsiteWarningEnabled = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        for name in BridgeSpec.Inbound.allCases {
            configuration.userContentController.add(messageProxy, contentWorld: .page, name: name.rawValue)
        }

        webView = WKWebView(frame: .zero, configuration: configuration)
        // 켤 때 깜빡이지 않게 웹뷰와 그 뒤를 토큰 배경색으로 칠한다.
        webView.isOpaque = false
        webView.backgroundColor = Palette.background
        webView.underPageBackgroundColor = Palette.background
        webView.scrollView.backgroundColor = Palette.background
        // 화면 전체가 당겨져 튕기지 않게. 위아래 여백은 웹이 안전 영역 값으로 처리한다.
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // 길게 눌러 뜨는 미리보기와 가장자리 밀기로 뒤로 가기를 끈다.
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        // Safari 웹 검사기는 Debug 빌드에서만 켠다.
        webView.isInspectable = true
        #endif

        messageProxy.owner = self
        delegate.owner = self
        webView.navigationDelegate = delegate
        webView.uiDelegate = delegate

        #if DEBUG
        if let seed = options.seed {
            DebugSeeds.apply(seed, to: store)
        }
        if options.probeDirectory != nil {
            debug = DebugProbe(options: options, webView: webView)
        }
        #endif

        observeSystem()
        start()
    }

    // MARK: 싣기

    private func start() {
        guard state.phase == .starting else { return }
        state.phase = .loading
        store.removeLeftovers()
        guard let documentURL, FileManager.default.isReadableFile(atPath: documentURL.path) else {
            fail(.missingBundle)
            return
        }
        loadWatchdog = Task { [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard let self, !Task.isCancelled, self.state.phase == .loading else { return }
            self.fail(.timeout)
        }
        #if DEBUG
        debug?.start()
        if debugOptions.probeControl {
            // 대조 실행: 차단 규칙 없이 싣는다(탐침이 새는 요청을 잡아내는지 확인할 때만 쓴다).
            loadDocument()
            return
        }
        #endif
        Task { [weak self] in
            do {
                let list = try await NetworkGuard.compile()
                guard let self else { return }
                // 규칙을 먼저 건 뒤에 묶음을 싣는다.
                self.webView.configuration.userContentController.add(list)
                self.loadDocument()
            } catch {
                self?.fail(.rulesFailed)
            }
        }
    }

    private func loadDocument() {
        guard let documentURL else { return }
        installAppInfoScript()
        webView.loadFileURL(documentURL, allowingReadAccessTo: documentURL.deletingLastPathComponent())
    }

    /// window.__SA_APP__ 를 넣는 스크립트를 지금 기록과 글자 크기로 바꿔 건다. 새 문서를 만들기 전에 부른다.
    private func installAppInfoScript() {
        let scale = FontScale.current()
        lastFontScale = scale
        // 받은 저장을 모두 마친 뒤의 내용을 읽는다(다시 읽는 문서가 예전 기록으로 덮어쓰지 않게).
        let source = AppInfoScript.source(appVersion: appVersion, store: store.read(), fontScale: scale)
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    private func fail(_ reason: ShellFailure) {
        guard state.phase != .failed else { return }
        loadWatchdog?.cancel()
        state.phase = .failed
        #if DEBUG
        debug?.noteFailure(reason.rawValue)
        #endif
    }

    // MARK: 이동과 페이지

    func policy(for action: WKNavigationAction) -> WKNavigationActionPolicy {
        guard let documentURL,
              NetworkGuard.allowsNavigation(to: action.request.url, isMainFrame: action.targetFrame?.isMainFrame == true, document: documentURL)
        else {
            #if DEBUG
            debug?.noteBlockedNavigation(action.request.url)
            #endif
            return .cancel
        }
        if action.navigationType == .reload || !NetworkGuard.isSameDocument(action.request.url, current: webView.url) {
            installAppInfoScript()
        }
        return .allow
    }

    func pageWillLoad() {
        pageReady = false
        outbox.clear()
    }

    func pageDidFinish() {
        pageReady = true
        for message in outbox.drain() {
            deliver(message)
        }
        // 읽는 동안 바뀐 글자 크기는 지금 다시 보낸다.
        let scale = FontScale.current()
        if scale != lastFontScale {
            lastFontScale = scale
            deliver(.fontScale(scale))
        }
        Task { [weak self] in await self?.confirmRendered() }
    }

    /// 묶음의 화면이 실제로 그려졌는지 본다. 스크립트가 시작하지 못해 빈 화면이면 실패 안내를 띄운다.
    private func confirmRendered() async {
        for _ in 0..<20 {
            let count = await renderedRootChildren()
            if count > 0 {
                loadWatchdog?.cancel()
                if state.phase == .loading {
                    state.phase = .ready
                }
                #if DEBUG
                debug?.pageDidRender()
                #endif
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        fail(.blankPage)
    }

    /// 웹 화면의 뿌리(#root)에 그려진 요소 수.
    private func renderedRootChildren() async -> Int {
        await withCheckedContinuation { continuation in
            webView.evaluateJavaScript("(function () { var r = document.getElementById('root'); return r ? r.childElementCount : 0; })()") { value, _ in
                continuation.resume(returning: (value as? NSNumber)?.intValue ?? 0)
            }
        }
    }

    func pageDidFail(_ error: Error) {
        let nsError = error as NSError
        // 이동을 취소해서 생긴 오류는 실패가 아니다.
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }
        // 처음 싣는 중에만 실패 안내를 띄운다. 이미 그려진 화면은 그대로 둔다.
        if state.phase == .loading {
            fail(.loadFailed)
        }
    }

    func webContentDidTerminate() {
        let now = Date()
        webProcessEnds = webProcessEnds.filter { now.timeIntervalSince($0) < 30 } + [now]
        if webProcessEnds.count >= 3 {
            fail(.webProcessCrashed)
            return
        }
        pageReady = false
        outbox.clear()
        // 다시 읽는 문서가 최신 기록을 받게 스크립트를 바꾼 뒤 지금 화면(# 포함)을 다시 싣는다.
        installAppInfoScript()
        if webView.url != nil {
            webView.reload()
        } else {
            loadDocument()
        }
    }

    // MARK: 다리

    func receive(name: String, body: Any, isMainFrame: Bool) {
        guard isMainFrame else { return }
        let command = BridgeCommand.parse(name: name, body: body)
        #if DEBUG
        debug?.noteReceived(name)
        #endif
        switch command {
        case .save(let json):
            let ticket = BackgroundTicket(tasks: background, name: "기록 저장")
            store.save(json) { [weak self] ok in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        if !ok { self?.send(.storeFailed) }
                        ticket.end()
                    }
                }
            }
        case .archive:
            let ticket = BackgroundTicket(tasks: background, name: "기록 보관")
            store.archive { [weak self] ok in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        #if DEBUG
                        self?.debug?.noteArchive(ok)
                        #endif
                        _ = self
                        ticket.end()
                    }
                }
            }
        case .saveMalformed:
            send(.storeFailed)
        case .hapticKey:
            haptics.key(in: webView)
        case .copy(let text):
            send(.copied(Clipboard.copy(text)))
        case .copyMalformed:
            send(.copied(false))
        case .ignored:
            break
        }
    }

    /// 웹에 알린다. 페이지 읽기가 끝나기 전이면 모아 뒀다가 didFinish 에서 차례대로 보낸다.
    func send(_ message: ToWeb) {
        guard pageReady else {
            outbox.add(message)
            return
        }
        deliver(message)
    }

    private func deliver(_ message: ToWeb) {
        #if DEBUG
        debug?.noteSent(message)
        #endif
        webView.evaluateJavaScript(message.deliverScript, completionHandler: nil)
    }

    // MARK: 시스템

    private func observeSystem() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.contentSizeDidChange() }
        })
        observers.append(center.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            // 앱이 끝나기 전에 쓰던 저장을 마친다.
            MainActor.assumeIsolated { self?.store.flush() }
        })
    }

    private func contentSizeDidChange() {
        let scale = FontScale.current()
        // 페이지 읽기가 끝나기 전이면 didFinish 에서 보낸다.
        guard pageReady, scale != lastFontScale else { return }
        lastFontScale = scale
        deliver(.fontScale(scale))
    }
}

/// 웹이 보낸 메시지를 껍데기로 넘긴다. 웹뷰가 받는 쪽을 강하게 잡아서, 껍데기는 약하게 잡는다.
@MainActor
final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: ShellController?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(name: message.name, body: message.body, isMainFrame: message.frameInfo.isMainFrame)
    }
}

/// 이동, 새 창, 길게 누른 미리보기, 권한 요청을 맡는다.
@MainActor
final class WebDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    weak var owner: ShellController?

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        decisionHandler(owner?.policy(for: navigationAction) ?? .cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        owner?.pageWillLoad()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        owner?.pageDidFinish()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        owner?.pageDidFail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        owner?.pageDidFail(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        owner?.webContentDidTerminate()
    }

    /// 새 창(target=_blank, window.open)은 열지 않는다.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        #if DEBUG
        owner?.debug?.noteBlockedWindow(navigationAction.request.url)
        #endif
        return nil
    }

    /// 길게 눌러 뜨는 링크와 그림의 미리보기 메뉴를 띄우지 않는다.
    func webView(_ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo, completionHandler: @escaping @MainActor @Sendable (UIContextMenuConfiguration?) -> Void) {
        completionHandler(nil)
    }

    /// 카메라와 마이크 권한은 요청하지 않는다.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    /// 기기 방향과 움직임 권한도 요청하지 않는다.
    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}
