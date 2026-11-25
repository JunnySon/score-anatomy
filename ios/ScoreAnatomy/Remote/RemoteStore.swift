import Foundation

/// 받아들인 시험 자료 하나(docs/시험_배포_규격.md 4장의 remote, 3-1 의 2번).
struct RemoteExam: Equatable, Sendable {
    let id: JSONString
    let rev: Int
    let sha256: String
    /// 시험 파일의 바이트 그대로(엄격한 UTF-8 의 JSON 객체).
    let bytes: [UInt8]
}

/// 웹에 넘기고 기기에 보관하는 시험 자료 전체.
struct RemoteSnapshot: Equatable, Sendable {
    /// 이 자료를 받아들일 때 쓴 공개 키의 지문. 앱이 믿는 키가 바뀌면 이 자료는 쓰지 않는다.
    let keyFingerprint: String
    let seq: Int
    let issuedAt: String
    /// index.json 의 locks 값 바이트 그대로(JSON 배열).
    let locks: [UInt8]
    /// 웹에 넘기는 차례: index.json 의 exams 차례, 그 뒤에 새 발행물에 없어 남긴 시험.
    let exams: [RemoteExam]

    /// 웹에 넘기는 remote 의 JSON 글자: { seq, issuedAt, exams, locks }. 시험과 달력은 받은 바이트를 그대로 잇는다(다시 직렬화하지 않음).
    var remoteJSON: String {
        var out = "{\"seq\":\(seq),\"issuedAt\":\"\(issuedAt)\",\"exams\":["
        for (index, exam) in exams.enumerated() {
            if index > 0 { out += "," }
            out += String(decoding: exam.bytes, as: UTF8.self)
        }
        out += "],\"locks\":" + String(decoding: locks, as: UTF8.self) + "}"
        return out
    }

    /// 새로 확인한 발행물을 받아들인 결과(docs/시험_배포_규격.md 3-1 의 2번).
    /// - 새 발행물의 시험은 index.json 차례대로 넣되, 가진 판의 rev 가 더 크면 가진 판을 그 자리에 둔다.
    /// - 받아들인 적 있는 시험 가운데 새 발행물에 없는 것은 지우지 않고 마지막으로 받은 판을 뒤에 남긴다.
    /// - seq, issuedAt, locks 는 새 발행물의 것이다.
    static func merging(current: RemoteSnapshot?, index: CheckedIndex, files: [String: [UInt8]], keyFingerprint: String) -> RemoteSnapshot {
        let kept = current?.keyFingerprint == keyFingerprint ? current?.exams ?? [] : []
        var byId: [JSONString: RemoteExam] = [:]
        for exam in kept { byId[exam.id] = exam }
        var exams: [RemoteExam] = []
        var listed = Set<JSONString>()
        for entry in index.entries {
            listed.insert(entry.id)
            if let old = byId[entry.id], old.rev > entry.rev {
                exams.append(old)
            } else {
                exams.append(RemoteExam(id: entry.id, rev: entry.rev, sha256: entry.sha256, bytes: files[entry.file] ?? []))
            }
        }
        for exam in kept where !listed.contains(exam.id) {
            exams.append(exam)
        }
        return RemoteSnapshot(keyFingerprint: keyFingerprint, seq: index.seq, issuedAt: index.issuedAt, locks: index.locks, exams: exams)
    }
}

/// 디스크의 마지막 이름 바꾸기와 마감 판정 사이의 순서를 정한다.
/// 바이트 쓰기, fsync, 정리는 이 잠금 밖에서 한다.
final class RemoteCommit: @unchecked Sendable {
    private let lock = NSLock()
    private let deadline: ContinuousClock.Instant?
    private var closed = false
    private var accepted: RemoteSnapshot?

    init(until deadline: ContinuousClock.Instant? = nil) { self.deadline = deadline }

    func publish(_ snapshot: RemoteSnapshot, whileCurrent: () -> Bool, replace: () throws -> Void) rethrows -> Bool {
        try lock.withLock {
            guard !closed, whileCurrent(), deadline.map({ ContinuousClock.now < $0 }) ?? true else { return false }
            try replace()
            accepted = snapshot
            closed = true
            return true
        }
    }

    /// 먼저 원자 교체했다면 그 판으로 답한다. 마감이 먼저라면 뒤늦은 교체를 막는다.
    func close() -> RemoteSnapshot? {
        lock.withLock {
            closed = true
            return accepted
        }
    }
}

/// 받아들인 시험 자료를 기기에 보관한다(docs/시험_배포_규격.md 3장의 7번).
///
/// - 시스템이 마음대로 지우는 곳(Caches)이 아니라 기록 파일과 같은 Application Support 아래 remote 폴더에 둔다.
/// - 파일 하나(remote.json)에 다 담는다. 바꿀 때는 같은 폴더의 임시 파일에 다 쓰고 디스크에 내린 뒤 이름 바꾸기 한 번으로
///   바꿔치기해서, 도중에 앱이 끝나도 옛 자료나 새 자료 가운데 하나가 온전히 남는다.
/// - 읽을 때 시험 파일마다 SHA-256 과 JSON 모양, id 와 rev 를 다시 본다. 하나라도 틀리거나 읽지 못하면 보관한 자료가 없는 것으로 다룬다
///   (기록 파일 store.json 은 건드리지 않는다).
/// - 기기 백업에서 빼지 않는다. 새 발행물에서 빠진 시험의 마지막 판은 다시 받을 수 없을 수 있어서다(docs/ios_결정기록.md).
final class RemoteStore: @unchecked Sendable {
    static let folderName = "remote"
    static let fileName = "remote.json"
    static let temporaryPrefix = ".remote-"
    static let temporarySuffix = ".tmp"
    /// 보관 파일의 형식 번호.
    static let storeFormat = 1

    let directory: URL
    var fileURL: URL { directory.appendingPathComponent(Self.fileName, isDirectory: false) }
    private let disk: StoreDisk
    private let lock = NSLock()

    /// storeDirectory 는 기록 파일(store.json)이 있는 폴더다. 그 아래 remote 폴더를 쓴다.
    init(storeDirectory: URL, disk: StoreDisk = FileStoreDisk()) {
        directory = storeDirectory.appendingPathComponent(Self.folderName, isDirectory: true)
        self.disk = disk
    }

    enum LoadResult: Equatable, Sendable {
        case none
        case snapshot(RemoteSnapshot)
        /// 파일은 있는데 읽지 못하거나 모양이 틀렸다(없는 것으로 다룬다).
        case unreadable
    }

    /// 보관한 자료를 읽는다. 앞선 실행이 쓰다 남긴 임시 파일은 지운다.
    func load() -> LoadResult {
        lock.lock()
        defer { lock.unlock() }
        for url in disk.list(directory) {
            let name = url.lastPathComponent
            if name.hasPrefix(Self.temporaryPrefix), name.hasSuffix(Self.temporarySuffix) {
                try? disk.remove(url)
            }
        }
        guard disk.exists(fileURL) else { return .none }
        guard let data = try? disk.read(fileURL), let snapshot = Self.decode(Array(data)) else { return .unreadable }
        return .snapshot(snapshot)
    }

    /// 자료를 보관한다. 실패하면 원래 파일을 건드리지 않고 false.
    func save(_ snapshot: RemoteSnapshot, receipt: RemoteCommit = RemoteCommit(), whileCurrent: () -> Bool = { true }) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let data = Self.encode(snapshot) else { return false }
        let temporary = directory.appendingPathComponent("\(Self.temporaryPrefix)\(UUID().uuidString)\(Self.temporarySuffix)", isDirectory: false)
        do {
            try disk.makeDirectory(directory)
            try disk.writeNew(data, to: temporary)
            // 디스크에 쓰는 동안에도 취소되거나 마감이 지날 수 있다. 원본을 바꾸기 직전에 검사한다.
            let published = try receipt.publish(snapshot, whileCurrent: whileCurrent) { try disk.replace(fileURL, with: temporary) }
            guard published else {
                try? disk.remove(temporary)
                return false
            }
            return true
        } catch {
            try? disk.remove(temporary)
            return false
        }
    }

    /// 아직 전부 받지 못한 발행물의 확인된 파일. 이 폴더의 파일을 웹에 직접 넘기지는 않는다.
    private var staging: URL { directory.appendingPathComponent("staging", isDirectory: true) }

    func keepStaged(_ digests: Set<String>) {
        lock.withLock {
            for url in disk.list(staging) where !digests.contains(url.lastPathComponent) {
                try? disk.remove(url)
            }
        }
    }

    func staged(_ entry: ReleaseEntry) -> [UInt8]? {
        lock.withLock {
            let url = staging.appendingPathComponent(entry.sha256)
            guard let data = try? disk.read(url) else { return nil }
            let bytes = Array(data)
            if case .success = ReleaseCheck.examFile(bytes, for: entry) { return bytes }
            try? disk.remove(url)
            return nil
        }
    }

    func stage(_ bytes: [UInt8], for entry: ReleaseEntry) {
        lock.withLock {
            let url = staging.appendingPathComponent(entry.sha256)
            // 쓰기 도중 종료된 파일은 다음 읽기에서 SHA-256과 내용이 모두 맞아야 쓴다.
            do {
                try disk.makeDirectory(staging)
                try disk.writeNew(Data(bytes), to: url)
            } catch {
                try? disk.remove(url)
            }
        }
    }

    // MARK: 파일 모양

    static func encode(_ snapshot: RemoteSnapshot) -> Data? {
        let object: [String: Any] = [
            "storeFormat": storeFormat,
            "keyFingerprint": snapshot.keyFingerprint,
            "seq": snapshot.seq,
            "issuedAt": snapshot.issuedAt,
            "locks": Data(snapshot.locks).base64EncodedString(),
            "exams": snapshot.exams.map { ["sha256": $0.sha256, "bytes": Data($0.bytes).base64EncodedString()] },
        ]
        return try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    /// 보관 파일을 읽는다. 모양이 하나라도 틀리면 nil.
    static func decode(_ bytes: [UInt8]) -> RemoteSnapshot? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any],
              (object["storeFormat"] as? NSNumber)?.intValue == storeFormat,
              let fingerprint = object["keyFingerprint"] as? String, fingerprint.count == 16,
              let seqNumber = object["seq"] as? NSNumber, CFGetTypeID(seqNumber) != CFBooleanGetTypeID(),
              let issuedAt = object["issuedAt"] as? String, ReleaseCheck.isValidYmdHm(issuedAt),
              let locksText = object["locks"] as? String, let locksData = Data(base64Encoded: locksText),
              let examList = object["exams"] as? [[String: Any]]
        else { return nil }
        let seq = seqNumber.intValue
        guard seq >= 1, Double(seq) == seqNumber.doubleValue else { return nil }
        let locks = Array(locksData)
        guard let locksNode = try? StrictJSON.parse(locks), case .array = locksNode.value, locksNode.range == 0..<locks.count else { return nil }
        var exams: [RemoteExam] = []
        var ids = Set<JSONString>()
        for item in examList {
            guard let sha = item["sha256"] as? String, let text = item["bytes"] as? String, let data = Data(base64Encoded: text) else { return nil }
            let examBytes = Array(data)
            guard ReleaseCheck.sha256Hex(examBytes) == sha,
                  let root = try? StrictJSON.parse(examBytes), root.isObject,
                  let id = ReleaseCheck.idOf(root), !id.isBlankForJavaScript, ids.insert(id).inserted,
                  let revValue = ReleaseCheck.revOf(root), let rev = ReleaseCheck.safeInteger(JSONNode(value: .number(revValue), range: 0..<0), minimum: 1)
            else { return nil }
            exams.append(RemoteExam(id: id, rev: rev, sha256: sha, bytes: examBytes))
        }
        return RemoteSnapshot(keyFingerprint: fingerprint, seq: seq, issuedAt: issuedAt, locks: locks, exams: exams)
    }
}
