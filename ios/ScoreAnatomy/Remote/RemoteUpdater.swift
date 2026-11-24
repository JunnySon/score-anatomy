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

/// 한 번 받기: 받기, 확인, 합치기, 보관(docs/시험_배포_규격.md 3장의 차례). 웹이나 화면과 상관없이 돌아서 화면을 막지 않는다.
struct RemoteRun: Sendable {
    let location: RemoteLocation
    let publicKey: [UInt8]
    /// 지금 가진 자료(시작할 때 읽은 것이나 마지막으로 받아들인 것).
    let current: RemoteSnapshot?
    let store: RemoteStore
    /// 받기와 확인 전체의 시간 제한(초).
    let limit: TimeInterval

    func run() async -> RemoteOutcome {
        let started = Date()
        let session = ReleaseFetchSession(limit: limit)
        defer { session.close() }
        guard let indexURL = location.url(for: ReleaseRules.indexFile), let signatureURL = location.url(for: ReleaseRules.signatureFile) else {
            return .failed("주소를 만들지 못함")
        }
        // 1. index.json 과 index.json.sig 를 캐시를 쓰지 않고 받는다.
        let index: [UInt8]
        switch await session.fetch(indexURL) {
        case .success(let bytes): index = bytes
        case .failure(let failure): return .failed("index.json: \(failure)")
        }
        let signature: [UInt8]
        switch await session.fetch(signatureURL) {
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
        if let mine, signed.seq <= mine.seq { return .unchanged(seq: signed.seq) }
        // 5. 항목의 모양과 안전한 경로.
        let checked: CheckedIndex
        switch ReleaseCheck.entries(of: signed) {
        case .success(let value): checked = value
        case .failure(let problem): return .failed(problem.description)
        }
        // 6~7. 시험 파일의 SHA-256, 파일 안의 id 와 rev. 같은 SHA-256 의 파일을 이미 가지고 있으면 그 바이트를 쓴다(같은 바이트다).
        var files: [String: [UInt8]] = [:]
        for entry in checked.entries {
            let bytes: [UInt8]
            if let kept = mine?.exams.first(where: { $0.sha256 == entry.sha256 }) {
                bytes = kept.bytes
            } else {
                guard let url = location.url(for: entry.file) else { return .failed("\(entry.file): 주소를 만들지 못함") }
                switch await session.fetch(url) {
                case .success(let value): bytes = value
                case .failure(let failure): return .failed("\(entry.file): \(failure)")
                }
            }
            if case .failure(let problem) = ReleaseCheck.examFile(bytes, for: entry) { return .failed(problem.description) }
            files[entry.file] = bytes
        }
        guard Date().timeIntervalSince(started) <= limit else { return .failed("시간 넘김") }
        // 모두 확인한 뒤 한 번에 바꾼다.
        let merged = RemoteSnapshot.merging(current: mine, index: checked, files: files, keyFingerprint: fingerprint)
        guard store.save(merged) else { return .failed("보관하지 못함") }
        return .accepted(merged)
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

    /// 웹에 넘긴(넘길) 지금 자료. 시작할 때 보관한 자료를 읽어 둔다.
    private(set) var snapshot: RemoteSnapshot?
    let settings: RemoteSettings
    private let store: RemoteStore
    private let interval: TimeInterval
    private var running: Task<RemoteOutcome, Never>?
    private var waitingRefreshes = 0
    private var lastAttempt: Date?
    private var startedAfterLaunch = false
    /// 웹에 알린다(껍데기의 send).
    var deliver: ((ToWeb) -> Void)?
    /// 받기가 끝날 때마다 불린다(기록용).
    var onFinish: ((String, RemoteOutcome, TimeInterval) -> Void)?

    init(settings: RemoteSettings, store: RemoteStore, interval: TimeInterval = RemoteUpdater.foregroundInterval) {
        self.settings = settings
        self.store = store
        self.interval = interval
        // 시작할 때 웹의 __SA_APP__.remote 에 바로 넣으려고 보관한 자료를 먼저 읽는다. 지금 믿는 키로 받아들인 자료만 쓴다.
        if case .snapshot(let saved) = store.load(), let fingerprint = settings.keyFingerprint, saved.keyFingerprint == fingerprint {
            snapshot = saved
        }
    }

    /// 화면이 처음 그려진 뒤.
    func pageRendered() {
        guard !startedAfterLaunch else { return }
        startedAfterLaunch = true
        start(trigger: "launch")
    }

    /// 앱이 앞으로 돌아왔을 때.
    func appWillEnterForeground() {
        guard startedAfterLaunch else { return }
        if let lastAttempt, Date().timeIntervalSince(lastAttempt) < interval { return }
        start(trigger: "foreground")
    }

    /// 웹의 새로 확인.
    func refreshRequested() {
        guard settings.canFetch else {
            deliver?(.remoteFailed)
            onFinish?("refresh", .failed("받는 주소나 공개 키가 없음"), 0)
            return
        }
        waitingRefreshes += 1
        start(trigger: "refresh")
    }

    private func start(trigger: String) {
        guard running == nil, let location = settings.location, let publicKey = settings.publicKey else { return }
        let began = Date()
        lastAttempt = began
        let job = RemoteRun(location: location, publicKey: publicKey, current: snapshot, store: store, limit: Self.limit)
        let task = Task.detached(priority: .utility) { await job.run() }
        running = task
        Task { [weak self] in
            let outcome = await task.value
            self?.finish(outcome, trigger: trigger, seconds: Date().timeIntervalSince(began))
        }
    }

    private func finish(_ outcome: RemoteOutcome, trigger: String, seconds: TimeInterval) {
        running = nil
        let replies = waitingRefreshes
        waitingRefreshes = 0
        switch outcome {
        case .accepted(let new):
            snapshot = new
            deliver?(.remote(new))
        case .unchanged:
            if replies > 0 { deliver?(snapshot.map(ToWeb.remote) ?? .remoteFailed) }
        case .failed:
            if replies > 0 { deliver?(.remoteFailed) }
        }
        onFinish?(trigger, outcome, seconds)
    }
}
