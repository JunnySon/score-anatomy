import Foundation

/// 정해진 주소에서 발행물 파일을 받는다(docs/시험_배포_규격.md 3장의 받기, 3-1 의 1번). 껍데기가 통신하는 곳은 이 파일뿐이다.
///
/// - URLSession 하나만 쓴다(외부 패키지 없음). 캐시, 쿠키, 저장된 인증 정보를 쓰지 않는 세션이다.
/// - 다른 주소로 넘기는 응답(3xx)은 따라가지 않고 실패로 본다. 200 만 받는다.
/// - 요청 머리글은 정해 둔 값만 붙인다. 기기 이름, 기기 모델, OS 버전, 앱 버전, 사용자 언어 설정이 나가지 않게
///   User-Agent 와 Accept-Language 를 고정 값으로 덮어쓴다. 실제로 나간 머리글은 시험 서버가 받아 적어 확인한다.
/// - 파일 하나 5MB 제한을 받는 도중에 지킨다: 길이 머리글이 넘으면 본문을 받지 않고, 받는 동안 푼 바이트의 합이 넘으면 그 자리에서 끊는다.
/// - 한 번 받기(index.json, index.json.sig, 시험 파일)는 세션 하나로 하고, 정해진 시간이 지나면 세션째 끊는다.
final class ReleaseFetchSession: @unchecked Sendable {
    /// 요청에 붙이는 고정 값. 기기나 사용자를 가리키지 않는다.
    static let userAgent = "score-anatomy"
    static let acceptLanguage = "ko"
    static let accept = "*/*"
    static let acceptEncoding = "gzip, deflate"

    enum Failure: Error, Equatable, Sendable, CustomStringConvertible {
        /// 200 이 아닌 상태(3xx 포함).
        case status(Int)
        /// 5MB 를 넘음(길이 머리글이나 받는 도중).
        case tooBig
        /// 정해진 시간 안에 끝내지 못함.
        case timeout
        /// 연결 오류(URLError 의 번호).
        case network(Int)
        /// 정해진 주소 밖이라 보내지 않음.
        case outsideBase

        var description: String {
            switch self {
            case .status(let code): return "HTTP 상태 \(code)\((300..<400).contains(code) ? "(넘기는 응답은 따라가지 않음)" : "")"
            case .tooBig: return "5MB 를 넘음"
            case .timeout: return "시간 넘김"
            case .network(let code): return "연결 오류 \(code)"
            case .outsideBase: return "정해진 주소 밖"
            }
        }
    }

    private let session: URLSession
    private let delegate: FetchDelegate
    private let maxBytes: Int
    private let lock = NSLock()
    private var timedOut = false
    /// 세션을 닫았는지. 닫은 세션에는 요청을 만들지 않는다(만들면 앱이 멈춘다).
    private var closed = false
    private var timer: DispatchWorkItem?

    /// limit 초가 지나면 세션의 모든 요청을 끊는다(받기와 확인 전체의 시간 제한).
    init(limit: TimeInterval, maxBytes: Int = ReleaseRules.maxFileBytes) {
        self.maxBytes = maxBytes
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.waitsForConnectivity = false
        configuration.httpAdditionalHeaders = [:]
        configuration.timeoutIntervalForRequest = limit
        configuration.timeoutIntervalForResource = limit
        configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
        configuration.httpShouldUsePipelining = false
        delegate = FetchDelegate(maxBytes: maxBytes)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "com.junnyson.scoreanatomy.remote-fetch"
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: queue)
        let work = DispatchWorkItem { [weak self] in self?.expire() }
        timer = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + limit, execute: work)
    }

    deinit {
        timer?.cancel()
        session.invalidateAndCancel()
    }

    /// 다 쓴 뒤 부른다. 남은 요청을 끊고 세션을 닫는다.
    func close() {
        timer?.cancel()
        lock.lock()
        closed = true
        lock.unlock()
        session.invalidateAndCancel()
    }

    private func expire() {
        lock.lock()
        timedOut = true
        closed = true
        lock.unlock()
        session.invalidateAndCancel()
    }

    private var isTimedOut: Bool {
        lock.lock()
        defer { lock.unlock() }
        return timedOut
    }

    /// 파일 하나를 받는다. url 은 RemoteLocation 이 만든 정해진 주소 안의 주소여야 한다.
    func fetch(_ url: URL) async -> Result<[UInt8], Failure> {
        if isTimedOut { return .failure(.timeout) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: session.configuration.timeoutIntervalForRequest)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(Self.acceptLanguage, forHTTPHeaderField: "Accept-Language")
        request.setValue(Self.accept, forHTTPHeaderField: "Accept")
        request.setValue(Self.acceptEncoding, forHTTPHeaderField: "Accept-Encoding")
        let result: Result<[UInt8], Failure> = await withCheckedContinuation { continuation in
            // 닫는 일과 겹치지 않게, 요청은 잠근 채로 만든다.
            lock.lock()
            defer { lock.unlock() }
            guard !closed else {
                continuation.resume(returning: .failure(timedOut ? .timeout : .network(URLError.cancelled.rawValue)))
                return
            }
            delegate.start(request, in: session) { continuation.resume(returning: $0) }
        }
        if case .failure(.network) = result, isTimedOut { return .failure(.timeout) }
        return result
    }
}

/// URLSession 의 알림을 받아 요청마다 바이트를 모은다. 알림은 세션의 직렬 큐 하나에서만 온다.
private final class FetchDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private struct Pending {
        var data: [UInt8] = []
        var failure: ReleaseFetchSession.Failure?
        let finish: @Sendable (Result<[UInt8], ReleaseFetchSession.Failure>) -> Void
    }

    private let maxBytes: Int
    private let lock = NSLock()
    private var pending: [Int: Pending] = [:]

    init(maxBytes: Int) {
        self.maxBytes = maxBytes
    }

    func start(_ request: URLRequest, in session: URLSession, finish: @escaping @Sendable (Result<[UInt8], ReleaseFetchSession.Failure>) -> Void) {
        let task = session.dataTask(with: request)
        lock.lock()
        pending[task.taskIdentifier] = Pending(finish: finish)
        lock.unlock()
        task.resume()
    }

    private func update(_ task: URLSessionTask, _ change: (inout Pending) -> Void) {
        lock.lock()
        if var item = pending[task.taskIdentifier] {
            change(&item)
            pending[task.taskIdentifier] = item
        }
        lock.unlock()
    }

    private func fail(_ task: URLSessionTask, _ failure: ReleaseFetchSession.Failure) {
        update(task) { item in
            if item.failure == nil { item.failure = failure }
        }
        task.cancel()
    }

    // 다른 주소로 넘기는 응답은 따라가지 않는다. nil 을 주면 3xx 응답이 그대로 와서 아래에서 실패로 본다.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    // 서버 인증서 확인은 시스템에 맡기고, 그 밖의 인증 요청(계정, 기기 인증서)에는 아무것도 보내지 않는다.
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            update(dataTask) { item in
                if item.failure == nil { item.failure = .status((response as? HTTPURLResponse)?.statusCode ?? 0) }
            }
            completionHandler(.cancel)
            return
        }
        // 길이 머리글이 제한을 넘으면 본문을 받지 않는다.
        if let length = http.value(forHTTPHeaderField: "Content-Length"), let declared = Int(length.trimmingCharacters(in: .whitespaces)), declared > maxBytes {
            update(dataTask) { item in
                if item.failure == nil { item.failure = .tooBig }
            }
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        var tooBig = false
        update(dataTask) { item in
            guard item.failure == nil else { return }
            if item.data.count + data.count > maxBytes {
                item.failure = .tooBig
                item.data = []
                tooBig = true
            } else {
                item.data.append(contentsOf: data)
            }
        }
        if tooBig { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let item = pending.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let item else { return }
        if let failure = item.failure {
            item.finish(.failure(failure))
        } else if let error {
            let code = (error as? URLError)?.code
            item.finish(.failure(code == .timedOut ? .timeout : .network(code?.rawValue ?? -1)))
        } else {
            item.finish(.success(item.data))
        }
    }

    func urlSession(_ session: URLSession, didBecomeInvalidWithError error: Error?) {
        // 세션을 닫을 때 끝나지 않은 요청이 있으면 실패로 끝낸다(기다리는 쪽이 멈추지 않게).
        lock.lock()
        let left = pending
        pending.removeAll()
        lock.unlock()
        for item in left.values {
            item.finish(.failure(item.failure ?? .network(URLError.cancelled.rawValue)))
        }
    }
}

/// 정해진 주소 하나(끝이 / 인 주소)와 그 안의 파일 주소 만들기(docs/시험_배포_규격.md 6장).
struct RemoteLocation: Equatable, Sendable {
    let base: URL

    /// 주소 글자를 받는 주소로 읽는다. https 만 받는다(allowLoopbackHTTP 이면 Debug 의 시험 서버 http://127.0.0.1 도 받는다).
    /// 계정, 쿼리, 조각이 든 주소는 받지 않는다. 끝이 / 가 아니면 붙인다.
    init?(_ text: String, allowLoopbackHTTP: Bool = false) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, var parts = URLComponents(string: trimmed), let scheme = parts.scheme?.lowercased(), let host = parts.host, !host.isEmpty else {
            return nil
        }
        let loopback = host == "127.0.0.1"
        guard scheme == "https" || (scheme == "http" && allowLoopbackHTTP && loopback) else { return nil }
        guard parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil else { return nil }
        if parts.path.isEmpty { parts.path = "/" }
        if !parts.path.hasSuffix("/") { parts.path += "/" }
        guard let url = parts.url, url.absoluteString.hasSuffix("/") else { return nil }
        base = url
    }

    /// 정해진 주소 안의 파일 주소. path 는 index.json, index.json.sig 이거나 안전한 경로(ReleaseCheck.isSafePath)여야 한다.
    /// 만든 주소가 정해진 주소 밖이면 nil(이중 확인).
    func url(for path: String) -> URL? {
        guard path == ReleaseRules.indexFile || path == ReleaseRules.signatureFile || ReleaseCheck.isSafePath(path) else { return nil }
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL else { return nil }
        let text = url.absoluteString
        guard text.hasPrefix(base.absoluteString), text.count > base.absoluteString.count,
              url.scheme == base.scheme, url.host == base.host, url.port == base.port,
              url.query == nil, url.fragment == nil
        else { return nil }
        return url
    }
}
