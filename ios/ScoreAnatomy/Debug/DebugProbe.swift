#if DEBUG
import Foundation
import WebKit

/// 시험용 탐침(DEBUG 빌드 전용). 화면 테스트가 웹뷰 안의 상태를 읽고, 바깥 요청이 막히는지 확인할 때 쓴다.
///
/// - 화면이 그려진 뒤 -SAProbe 로 고른 탐침을 한 번 돌려 결과를 probe-이름.json 에 쓴다.
/// - 탐침 폴더에 cmd-번호.js(자바스크립트 함수 본문)가 생기면 웹뷰에서 돌려 out-번호.json 에 결과를 쓴다.
/// - 껍데기가 막은 이동, 받은 메시지, 웹에 보낸 알림을 shell-stats.json 에 쓴다.
@MainActor
final class DebugProbe {
    let options: DebugOptions
    private weak var webView: WKWebView?
    private var watcher: DispatchSourceFileSystemObject?
    private var handled: Set<String> = []
    private var ranOneShot = false
    private var stats = Stats()
    private var statsWriteScheduled = false

    struct Stats: Codable {
        var failure: String?
        var rendered = 0
        var blockedNavigations: [String] = []
        var blockedWindows: [String] = []
        var received: [String: Int] = [:]
        var sent: [String] = []
        var archives: [Bool] = []
        var remote: [RemoteNote] = []
    }

    /// 시험 자료 받기 한 번의 기록.
    struct RemoteNote: Codable {
        var trigger: String
        var outcome: String
        var seq: Int?
        var exams: Int?
        var ms: Int
        var detail: String?
    }

    init(options: DebugOptions, webView: WKWebView) {
        self.options = options
        self.webView = webView
    }

    private var directory: URL? { options.probeDirectory }

    func start() {
        guard let directory else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        writeStats()
        let descriptor = open(directory.path, O_EVTONLY)
        guard descriptor >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: [.write, .extend, .rename], queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.scanCommands() }
        }
        source.setCancelHandler { close(descriptor) }
        source.resume()
        watcher = source
    }

    // MARK: 기록

    func noteFailure(_ reason: String) {
        stats.failure = reason
        scheduleStats()
    }

    func noteBlockedNavigation(_ url: URL?) {
        stats.blockedNavigations.append(url?.absoluteString ?? "(없음)")
        scheduleStats()
    }

    func noteBlockedWindow(_ url: URL?) {
        stats.blockedWindows.append(url?.absoluteString ?? "(없음)")
        scheduleStats()
    }

    func noteReceived(_ name: String) {
        stats.received[name, default: 0] += 1
        scheduleStats()
    }

    func noteSent(_ message: ToWeb) {
        stats.sent.append(message.json)
        if stats.sent.count > 300 { stats.sent.removeFirst(stats.sent.count - 300) }
        scheduleStats()
    }

    func noteArchive(_ ok: Bool) {
        stats.archives.append(ok)
        scheduleStats()
    }

    func noteRemote(trigger: String, outcome: RemoteOutcome, seconds: TimeInterval) {
        var note = RemoteNote(trigger: trigger, outcome: "", ms: Int((seconds * 1000).rounded()))
        switch outcome {
        case .accepted(let snapshot):
            note.outcome = "accepted"
            note.seq = snapshot.seq
            note.exams = snapshot.exams.count
        case .unchanged(let seq):
            note.outcome = "unchanged"
            note.seq = seq
        case .failed(let why):
            note.outcome = "failed"
            note.detail = why
        }
        stats.remote.append(note)
        // 결과를 기다리는 화면 테스트가 곧바로 읽을 수 있게 바로 쓴다.
        writeStats()
    }

    func pageDidRender() {
        stats.rendered += 1
        scheduleStats()
        scanCommands()
        guard !ranOneShot else { return }
        ranOneShot = true
        Task { await runOneShotProbes() }
    }

    private func scheduleStats() {
        guard !statsWriteScheduled else { return }
        statsWriteScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            MainActor.assumeIsolated {
                self?.statsWriteScheduled = false
                self?.writeStats()
            }
        }
    }

    private func writeStats() {
        guard let directory, let data = try? JSONEncoder().encode(stats) else { return }
        try? data.write(to: directory.appendingPathComponent("shell-stats.json"), options: .atomic)
    }

    // MARK: 명령 파일

    private func scanCommands() {
        guard let directory, let webView, webView.url != nil else { return }
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in names.sorted() where name.hasPrefix("cmd-") && name.hasSuffix(".js") && !handled.contains(name) {
            handled.insert(name)
            let url = directory.appendingPathComponent(name)
            guard let body = try? String(contentsOf: url, encoding: .utf8) else { continue }
            try? FileManager.default.removeItem(at: url)
            let id = String(name.dropFirst(4).dropLast(3))
            Task { await self.run(body, writeTo: "out-\(id).json") }
        }
    }

    private func run(_ body: String, writeTo fileName: String) async {
        guard let directory, let webView else { return }
        if body == "// native-scroll-metrics" {
            let scroll = webView.scrollView
            let bounds = scroll.bounds
            let metrics: [String: Any] = [
                "zoomScale": scroll.zoomScale,
                "minimumZoomScale": scroll.minimumZoomScale,
                "maximumZoomScale": scroll.maximumZoomScale,
                "contentSize": ["width": scroll.contentSize.width, "height": scroll.contentSize.height],
                "bounds": ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height],
            ]
            let data = try? JSONSerialization.data(withJSONObject: ["ok": true, "value": metrics])
            try? data?.write(to: directory.appendingPathComponent(fileName), options: .atomic)
            return
        }
        let wrapped = "const __v = await (async () => {\n\(body)\n})();\nreturn JSON.stringify(__v === undefined ? null : __v);"
        // Swift 전용 함수(libswiftWebKit)를 쓰지 않으려고 Objective-C 기본 API 를 그대로 부른다(iOS 18 에서도 켜지게).
        let output: String = await withCheckedContinuation { continuation in
            webView.__callAsyncJavaScript(wrapped, arguments: nil, inFrame: nil, in: .page) { value, error in
                if let error {
                    let payload: [String: Any] = ["ok": false, "error": String(describing: error)]
                    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{\"ok\":false}".utf8)
                    continuation.resume(returning: String(decoding: data, as: UTF8.self))
                } else {
                    continuation.resume(returning: "{\"ok\":true,\"value\":\((value as? String) ?? "null")}")
                }
            }
        }
        try? Data(output.utf8).write(to: directory.appendingPathComponent(fileName), options: .atomic)
    }

    // MARK: 한 번 돌리는 탐침

    private func runOneShotProbes() async {
        if options.probes.contains("state") {
            await run(Self.stateProbe, writeTo: "probe-state.json")
        }
        if options.probes.contains("network"), let port = options.probePort {
            await run(Self.networkProbe(port: port), writeTo: "probe-network.json")
            // 이동 시도가 껍데기에 막힌 기록이 남도록 잠깐 기다렸다가 쓴다.
            try? await Task.sleep(for: .milliseconds(300))
            writeStats()
        }
    }

    /// 웹이 받는 이벤트 기록(-SAEventLog). 문서가 열리기 전에 window 의 capture 단계에 붙어서 웹 코드의 듣기보다 먼저
    /// 불린다. 그래서 웹이 버리는 click 과 웹이 새로 만들어 보내는 click(trusted 가 false)까지 본다. 기록만 하고
    /// 이벤트를 막거나 바꾸지 않는다(passive). 화면 테스트가 탐침으로 window.__saEventLog 를 읽고 비운다.
    static let eventLogScript = """
    (() => {
      const log = [];
      window.__saEventLog = log;
      const types = ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click', 'dblclick', 'contextmenu'];
      const describe = (node) => {
        const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
        if (!el || !el.closest) return '';
        const hit = el.closest('[data-mark-cell], [data-short-mark], button, a, [role="button"], [role="switch"], [role="radio"]') || el;
        const mark = hit.getAttribute('data-mark-cell');
        if (mark) return 'mark-cell:' + mark;
        const label = hit.getAttribute('aria-label') || (hit.textContent || '').replace(/\\s+/g, ' ').trim();
        return hit.tagName.toLowerCase() + ':' + label.slice(0, 40);
      };
      for (const type of types) {
        window.addEventListener(type, (e) => {
          const p = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
          log.push({
            type,
            ts: Math.round(e.timeStamp * 10) / 10,
            now: Math.round(performance.now() * 10) / 10,
            detail: typeof e.detail === 'number' ? e.detail : null,
            x: Math.round(p.clientX || 0),
            y: Math.round(p.clientY || 0),
            pointerType: e.pointerType || null,
            pointerId: typeof e.pointerId === 'number' ? e.pointerId : null,
            touches: e.touches ? e.touches.length : null,
            trusted: e.isTrusted,
            target: describe(e.target),
          });
          if (log.length > 3000) log.splice(0, log.length - 3000);
        }, { capture: true, passive: true });
      }
    })();
    """

    /// 웹 환경: 다리, 넣어 준 값, 웹 저장소를 쓰지 않는지, 루트 글자 크기.
    static let stateProbe = """
    const app = window.__SA_APP__;
    let ls = -1;
    try { ls = window.localStorage.length; } catch (e) { ls = -2; }
    return {
      href: location.href,
      hash: location.hash,
      htmlClass: document.documentElement.className,
      hasHandlers: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.saStore),
      fromAppType: typeof window.__saFromApp,
      app: app && typeof app === 'object' ? { platform: app.platform, bridge: app.bridge, appVersion: app.appVersion, fontScale: app.fontScale, storeType: app.store === null ? 'null' : typeof app.store, storeLength: typeof app.store === 'string' ? app.store.length : -1, remoteType: app.remote === null ? 'null' : typeof app.remote, remoteSeq: app.remote && typeof app.remote === 'object' ? app.remote.seq : null, remoteExams: app.remote && Array.isArray(app.remote.exams) ? app.remote.exams.length : null, keys: Object.keys(app).sort().join(',') } : null,
      localStorageLength: ls,
      cookie: document.cookie,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      bodyText: (document.body.innerText || '').slice(0, 400)
    };
    """

    /// 바깥 요청 탐침. 이 맥의 주소(127.0.0.1)로 하위 자원 요청(fetch, XHR, 그림, 스크립트, 스타일, 비컨, 웹소켓,
    /// 서버 이벤트, iframe)과 스크립트의 새 창 열기를 보내 본다. 막히면 그 포트의 시험용 수신기에 연결조차 오지 않는다.
    /// 문서 이동(링크, location, form)은 화면 테스트가 따로 시도한다(WebKit 이 링크 이동에 연결을 미리 맺을 수 있어서 따로 센다).
    static func networkProbe(port: Int) -> String {
        """
        const base = 'http://127.0.0.1:\(port)';
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const outcome = (make, ms) => new Promise((resolve) => {
          let done = false;
          const finish = (v) => { if (!done) { done = true; resolve(v); } };
          try { make(finish); } catch (e) { finish('throw:' + (e && e.message)); }
          setTimeout(() => finish('timeout'), ms);
        });
        const r = {};
        r.fetch = await outcome((f) => fetch(base + '/fetch', { mode: 'no-cors', cache: 'no-store' }).then(() => f('loaded'), (e) => f('error:' + e.message)), 3000);
        r.fetchHttps = await outcome((f) => fetch('https://127.0.0.1:\(port)/fetch-https', { mode: 'no-cors' }).then(() => f('loaded'), (e) => f('error:' + e.message)), 3000);
        r.xhr = await outcome((f) => { const x = new XMLHttpRequest(); x.onload = () => f('loaded'); x.onerror = () => f('error'); x.open('GET', base + '/xhr'); x.send(); }, 3000);
        r.image = await outcome((f) => { const i = new Image(); i.onload = () => f('loaded'); i.onerror = () => f('error'); i.src = base + '/image.png'; }, 3000);
        r.script = await outcome((f) => { const s = document.createElement('script'); s.onload = () => f('loaded'); s.onerror = () => f('error'); s.src = base + '/script.js'; document.head.appendChild(s); }, 3000);
        r.style = await outcome((f) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.onload = () => f('loaded'); l.onerror = () => f('error'); l.href = base + '/style.css'; document.head.appendChild(l); }, 3000);
        r.beacon = (() => { try { return navigator.sendBeacon(base + '/beacon', 'x'); } catch (e) { return 'throw:' + e.message; } })();
        r.websocket = await outcome((f) => { const w = new WebSocket('ws://127.0.0.1:\(port)/ws'); w.onopen = () => f('open'); w.onerror = () => f('error'); w.onclose = () => f('closed'); }, 3000);
        r.eventSource = await outcome((f) => { const s = new EventSource(base + '/sse'); s.onopen = () => f('open'); s.onerror = () => { s.close(); f('error'); }; }, 3000);
        r.iframe = await outcome((f) => { const fr = document.createElement('iframe'); fr.onload = () => f('loaded'); fr.onerror = () => f('error'); fr.src = base + '/frame'; document.body.appendChild(fr); }, 2000);
        r.windowOpenReturnedNull = (() => { try { return window.open(base + '/open') === null; } catch (e) { return 'throw:' + e.message; } })();
        await wait(300);
        return r;
        """
    }
}
#endif
