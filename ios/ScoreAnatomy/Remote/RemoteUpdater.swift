import Foundation

/// 받는 주소와 믿는 공개 키(docs/시험_배포_규격.md 6장, 3-1 의 3번).
struct RemoteSettings: Equatable, Sendable {
    /// 받는 주소. 없으면 받지 않는다.
    let location: RemoteLocation?
    /// 믿는 공개 키 32바이트. 없으면 받지 않고, 보관한 자료도 쓰지 않는다.
    let publicKey: [UInt8]?

    var keyFingerprint: String? { publicKey.map(ReleaseCheck.fingerprint) }
    var canFetch: Bool { location != nil && publicKey != nil }

    /// Info.plist 의 받는 주소(SAExamBaseURL, 빌드 설정 SA_EXAM_BASE_URL)와 앱에 든 공개 키 파일(exam-public-key.txt)로 정한다.
    /// 공개 키 파일은 빌드할 때 exam-data/public-key.txt 에서 넣는다(ios/scripts/exam_key.py). 파일이 비었거나 모양이 틀리면 키가 없다.
    /// 배포용 주소는 https 만 받는다.
    static func fromBundle(_ bundle: Bundle) -> RemoteSettings {
        let address = bundle.object(forInfoDictionaryKey: "SAExamBaseURL") as? String
        let keyFile = bundle.url(forResource: "exam-public-key", withExtension: "txt").flatMap { try? Data(contentsOf: $0) }
        return RemoteSettings(
            location: address.flatMap { RemoteLocation($0) },
            publicKey: keyFile.flatMap { ReleaseCheck.publicKeyBytes(fromFile: Array($0)) }
        )
    }
}

/// 한 번 받기의 결과.
enum RemoteOutcome: Equatable, Sendable {
    /// 새 자료를 받아들이고 보관했다.
    case accepted(RemoteSnapshot)
    /// 새 자료가 없다(seq 가 가진 것과 같거나 작다).
    case unchanged(seq: Int)
    /// 받지 못했거나 확인을 통과하지 못했다. 가진 자료를 그대로 쓴다.
    case failed(String)
}

/// 발행물 파일을 가져오는 곳. 앱은 정해진 주소(NetworkReleaseSource)에서 받고, 단위 테스트는 폴더나 만든 바이트를 쓴다.
protocol ReleaseSource: Sendable {
    /// path 는 index.json, index.json.sig 이거나 안전한 경로다.
    func get(_ path: String) async -> Result<[UInt8], ReleaseFetchSession.Failure>
}

/// 정해진 주소 한 곳에서 받는다. 주소 밖으로 나가는 요청은 만들지 않는다.
struct NetworkReleaseSource: ReleaseSource {
    let location: RemoteLocation
    let session: ReleaseFetchSession

    func get(_ path: String) async -> Result<[UInt8], ReleaseFetchSession.Failure> {
        guard let url = location.url(for: path) else { return .failure(.outsideBase) }
        // 이 세션의 요청은 발행물 하나에 속한다. 형제 파일 하나가 실패하면 나머지 URLSession 작업도 함께 끝낸다.
        return await withTaskCancellationHandler {
            await session.fetch(url)
        } onCancel: {
            session.close()
        }
    }
}

/// 한 번 받기: 받기, 확인, 합치기, 보관(docs/시험_배포_규격.md 3장의 차례). 웹이나 화면과 상관없이 돌아서 화면을 막지 않는다.
struct RemoteRun: Sendable {
    let location: RemoteLocation
    let publicKey: [UInt8]
    /// 지금 가진 자료(시작할 때 읽은 것이나 마지막으로 받아들인 것).
    let current: RemoteSnapshot?
    let store: RemoteStore
    /// 받기와 확인 전체의 시간 제한(초).
    let limit: TimeInterval
    var receipt = RemoteCommit()

    func run() async -> RemoteOutcome {
        let session = ReleaseFetchSession(limit: limit)
        defer { session.close() }
        return await withTaskCancellationHandler {
            await Self.evaluate(source: NetworkReleaseSource(location: location, session: session), publicKey: publicKey,
                                current: current, store: store, limit: limit, receipt: receipt)
        } onCancel: {
            session.close()
        }
    }

    /// 받아서 확인하고, 모두 통과하면 합쳐서 보관한다. 하나라도 틀리면 아무것도 바꾸지 않는다.
    static func evaluate(source: some ReleaseSource, publicKey: [UInt8], current: RemoteSnapshot?, store: RemoteStore, limit: TimeInterval,
                         receipt: RemoteCommit = RemoteCommit()) async -> RemoteOutcome {
        let deadline = ContinuousClock.now.advanced(by: .seconds(limit))
        let currentAttempt: @Sendable () -> Bool = { !Task.isCancelled && ContinuousClock.now < deadline }
        guard currentAttempt() else { return .failed("시간 넘김 또는 취소") }
        // 1. index.json 과 index.json.sig 를 캐시를 쓰지 않고 받는다.
        let index: [UInt8]
        switch await source.get(ReleaseRules.indexFile) {
        case .success(let bytes): index = bytes
        case .failure(let failure): return .failed("index.json: \(failure)")
        }
        let signature: [UInt8]
        switch await source.get(ReleaseRules.signatureFile) {
        case .success(let bytes): signature = bytes
        case .failure(let failure): return .failed("index.json.sig: \(failure)")
        }
        // 2~4. 서명, 엄격한 UTF-8 의 JSON, format, seq.
        let signed: SignedIndex
        switch ReleaseCheck.signedIndex(index: index, signature: signature, publicKey: publicKey) {
        case .success(let value): signed = value
        case .failure(let problem): return .failed(problem.description)
        }
        let fingerprint = ReleaseCheck.fingerprint(publicKey)
        // 다른 키로 받아들인 자료는 견주지도 합치지도 않는다.
        let mine = current?.keyFingerprint == fingerprint ? current : nil
        // seq 가 가진 것보다 작으면 버리고(옛 자료로 되돌리는 것을 막음) 같으면 그대로 둔다.
        guard currentAttempt() else { return .failed("시간 넘김 또는 취소") }
        if let mine, signed.seq <= mine.seq { return .unchanged(seq: signed.seq) }
        // 5. 항목의 모양과 안전한 경로.
        let checked: CheckedIndex
        switch ReleaseCheck.entries(of: signed) {
        case .success(let value): checked = value
        case .failure(let problem): return .failed(problem.description)
        }
        // 6~7. 시험 파일의 SHA-256, 파일 안의 id 와 rev. 같은 SHA-256 의 파일을 이미 가지고 있으면 그 바이트를 쓴다(같은 바이트다).
        let saved = Dictionary((mine?.exams ?? []).map { ($0.sha256, $0) }, uniquingKeysWith: { first, _ in first })
        store.keepStaged(Set(checked.entries.map(\.sha256)).subtracting(saved.keys))
        let files: [String: [UInt8]]
        do {
            files = try await withThrowingTaskGroup(of: (String, [UInt8]).self) { group in
                var remaining = checked.entries.makeIterator()
                var results: [String: [UInt8]] = [:]
                func enqueue(_ entry: ReleaseEntry) {
                    group.addTask {
                        guard currentAttempt() else { throw ReadFailure("시간 넘김 또는 취소") }
                        if let kept = saved[entry.sha256] {
                            if case .failure(let problem) = ReleaseCheck.examFile(kept.bytes, for: entry) { throw ReadFailure(problem.description) }
                            return (entry.file, kept.bytes)
                        }
                        if let staged = store.staged(entry) { return (entry.file, staged) }
                        switch await source.get(entry.file) {
                        case .failure(let error):
                            throw ReadFailure("\(entry.file): \(error)")
                        case .success(let bytes):
                            if case .failure(let problem) = ReleaseCheck.examFile(bytes, for: entry) { throw ReadFailure(problem.description) }
                            guard currentAttempt() else { throw ReadFailure("시간 넘김 또는 취소") }
                            store.stage(bytes, for: entry)
                            return (entry.file, bytes)
                        }
                    }
                }
                for _ in 0..<4 {
                    if let entry = remaining.next() { enqueue(entry) }
                }
                while let (path, bytes) = try await group.next() {
                    results[path] = bytes
                    if let next = remaining.next() { enqueue(next) }
                }
                return results
            }
        } catch {
            return .failed(String(describing: error))
        }
        guard currentAttempt() else { return .failed("시간 넘김 또는 취소") }
        let merged = RemoteSnapshot.merging(current: mine, index: checked, files: files, keyFingerprint: fingerprint)
        guard store.save(merged, receipt: receipt, whileCurrent: currentAttempt) else {
            return .failed(currentAttempt() ? "보관하지 못함" : "시간 넘김 또는 취소")
        }
        store.keepStaged([])
        return .accepted(merged)
    }

    private struct ReadFailure: Error, CustomStringConvertible {
        let description: String
        init(_ text: String) { description = text }
    }
}

/// 언제 받고 웹에 무엇을 알릴지 맡는다(작업 지시서 4의 3-3, docs/앱_다리_규격.md 7장).
///
/// - 앱을 켠 뒤 화면이 그려지면 한 번 받는다(화면을 막지 않는다).
/// - 앱이 앞으로 돌아왔을 때 마지막 시도에서 5분이 지났으면 받는다.
/// - 웹이 saRemote { op: "refresh" } 를 보내면 받는다. 받는 중이면 그 받기의 결과로 답한다.
/// - 뒤에서 받지 않고 알림도 보내지 않는다.
/// - 새 자료를 받아들이면 웹의 요청이 없어도 remote 로 알린다(새로 확인의 응답도 이것 하나다). 새로 확인에서 새 자료가 없으면 지금 가진
///   자료를 seq 그대로 remote 로, 받지 못했거나 확인을 통과하지 못했으면 remoteFailed 로 답한다.
@MainActor
final class RemoteUpdater {
    /// 앞으로 돌아왔을 때 다시 받기까지의 간격.
    static let foregroundInterval: TimeInterval = 300
    /// 받기와 확인 전체의 시간 제한. 웹이 새로 확인의 응답을 10초 기다려서, 알림이 닿는 시간을 남기고 9초로 둔다.
    static let limit: TimeInterval = 9

    /// 지금 믿는 키로 보관한 자료. 주소를 비워도 기기에서는 보존한다.
    private(set) var snapshot: RemoteSnapshot?
    /// 주소와 키가 모두 설정된 빌드에서만 보관 자료를 웹에 노출한다.
    var snapshotForWeb: RemoteSnapshot? { settings.canFetch ? snapshot : nil }
    let settings: RemoteSettings
    private let store: RemoteStore
    private let interval: TimeInterval
    private let requestLimit: TimeInterval
    private var responseDeadline: ContinuousClock.Instant?
    private var receipt: RemoteCommit?
    private var watchdog: Task<Void, Never>?
    private var expired = false
    private var running: Task<RemoteOutcome, Never>?
    private var waitingRefreshes = 0
    private var lastAttempt: ContinuousClock.Instant?
    private var startedAfterLaunch = false
    private var inBackground = false
    private var interrupted = false
    private var foregroundReply: ToWeb?
    /// 웹에 알린다(껍데기의 send).
    var deliver: ((ToWeb) -> Void)?
    /// 받기가 끝날 때마다 불린다(기록용).
    var onFinish: ((String, RemoteOutcome, TimeInterval) -> Void)?

    init(settings: RemoteSettings, store: RemoteStore, interval: TimeInterval = RemoteUpdater.foregroundInterval,
         requestLimit: TimeInterval = RemoteUpdater.limit) {
        self.settings = settings
        self.store = store
        self.interval = interval
        self.requestLimit = requestLimit
        // 시작할 때 웹의 __SA_APP__.remote 에 바로 넣으려고 보관한 자료를 먼저 읽는다. 지금 믿는 키로 받아들인 자료만 쓴다.
        if let fingerprint = settings.keyFingerprint, case .snapshot(let saved) = store.load(), saved.keyFingerprint == fingerprint {
            snapshot = saved
        }
    }

    /// 화면이 처음 그려진 뒤.
    func pageRendered() {
        guard !startedAfterLaunch else { return }
        startedAfterLaunch = true
        if !inBackground { start(trigger: "launch") }
    }

    /// 앱이 앞으로 돌아왔을 때.
    func appWillEnterForeground() {
        inBackground = false
        if let reply = foregroundReply {
            foregroundReply = nil
            waitingRefreshes = 0
            deliver?(reply)
        }
        // 사용자가 보낸 새로 확인은 앱이 스스로 받는 5분 간격에 묶이지 않는다.
        if waitingRefreshes > 0 {
            start(trigger: "refresh")
            return
        }
        guard startedAfterLaunch else { return }
        if let lastAttempt, lastAttempt.duration(to: .now) < .seconds(interval) { return }
        start(trigger: "foreground")
    }

    /// 뒤로 간 동안에는 받지 않는다. 중도 취소한 시도는 5분을 기다리지 않고 다시 한다.
    func appDidEnterBackground() {
        inBackground = true
        if let running {
            interrupted = true
            lastAttempt = nil
            running.cancel()
        }
    }

    /// 웹의 새로 확인.
    func refreshRequested() {
        guard settings.canFetch else {
            reply(.remoteFailed)
            onFinish?("refresh", .failed("받는 주소나 공개 키가 없음"), 0)
            return
        }
        // 시간 제한으로 이미 실패한 작업이 파일 쓰기를 마치는 동안 새 요청을 그 작업에 붙이지 않는다.
        if running != nil, expired {
            reply(.remoteFailed)
            return
        }
        waitingRefreshes += 1
        start(trigger: "refresh")
    }

    private func start(trigger: String) {
        guard !inBackground, running == nil, let location = settings.location, let publicKey = settings.publicKey else { return }
        let began = ContinuousClock.now
        lastAttempt = began
        let deadline = began.advanced(by: .seconds(requestLimit))
        responseDeadline = deadline
        expired = false
        let receipt = RemoteCommit(until: deadline)
        self.receipt = receipt
        let job = RemoteRun(location: location, publicKey: publicKey, current: snapshot, store: store, limit: requestLimit, receipt: receipt)
        let task = Task.detached(priority: .utility) { await job.run() }
        running = task
        watchdog = Task { [weak self] in
            do { try await Task.sleep(until: deadline, clock: .continuous) } catch { return }
            self?.expire(at: deadline)
        }
        Task { [weak self] in
            let outcome = await task.value
            let elapsed = began.duration(to: .now).components
            self?.finish(outcome, trigger: trigger, seconds: Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18)
        }
    }

    private func expire(at deadline: ContinuousClock.Instant) {
        guard responseDeadline == deadline, !expired, let running else { return }
        expired = true
        // 웹에는 수락한 판 또는 실패 가운데 하나만 알린다. 저장 뒤 정리가 끝날 때까지 기다리지 않는다.
        let accepted = receipt?.close()
        running.cancel()
        if let accepted {
            snapshot = accepted
            waitingRefreshes = 0
            reply(.remote(accepted))
        } else if waitingRefreshes > 0 {
            waitingRefreshes = 0
            reply(.remoteFailed)
        }
    }

    private func finish(_ outcome: RemoteOutcome, trigger: String, seconds: TimeInterval) {
        if let deadline = responseDeadline, ContinuousClock.now >= deadline { expire(at: deadline) }
        watchdog?.cancel()
        watchdog = nil
        responseDeadline = nil
        receipt = nil
        running = nil
        // 원자 교체를 마친 직후 뒤로 갔더라도 보관 파일과 메모리는 같은 자료를 가리킨다.
        if case .accepted(let new) = outcome { snapshot = new }
        if expired {
            // 마감 때 원자 교체 여부를 확인해 이미 알렸다. 정리가 끝났다는 이유로 또 알리지 않는다.
            expired = false
            if case .accepted = outcome { onFinish?(trigger, outcome, seconds) }
            else { onFinish?(trigger, .failed("시간 넘김"), seconds) }
            if interrupted {
                interrupted = false
                if !inBackground { start(trigger: "foreground") }
            }
            return
        }
        if interrupted {
            interrupted = false
            if case .accepted(let new) = outcome {
                waitingRefreshes = 0
                reply(.remote(new))
            }
            onFinish?(trigger, outcome, seconds)
            if !inBackground { start(trigger: "foreground") }
            return
        }
        let replies = waitingRefreshes
        waitingRefreshes = 0
        switch outcome {
        case .accepted(let new):
            reply(.remote(new))
        case .unchanged:
            if replies > 0 { reply(snapshotForWeb.map(ToWeb.remote) ?? .remoteFailed) }
        case .failed:
            if replies > 0 { reply(.remoteFailed) }
        }
        onFinish?(trigger, outcome, seconds)
    }

    private func reply(_ message: ToWeb) {
        if inBackground {
            // 앞으로 돌아오기 전의 새로 확인 실패 때문에 이미 수락한 자료 알림을 잃지 않는다.
            if case .remote? = foregroundReply, case .remoteFailed = message { return }
            foregroundReply = message
        } else {
            deliver?(message)
        }
    }
}
