import Foundation

/// 기록 파일을 읽은 결과(docs/앱_다리_규격.md 1장의 store).
enum StoreRead: Equatable, Sendable {
    /// 파일이 없다(store: null).
    case missing
    /// 파일의 내용.
    case text(String)
    /// 파일이 있는데 글자(UTF-8)로 읽지 못했다(store: "").
    case unreadable
}

/// 기록 파일(store.json) 하나를 맡는다(docs/앱_다리_규격.md 2장).
///
/// - 저장은 같은 폴더의 임시 파일에 다 쓰고 디스크에 내린 뒤, 이름 바꾸기 한 번으로 바꿔치기한다.
///   중간에 실패하면 원래 파일을 건드리지 않는다.
/// - 모든 일은 하나의 직렬 큐에서 받은 차례대로 한다. 여러 번 저장하면 마지막 것이 남는다.
/// - 보관(archive)은 store.json 의 이름만 바꾼다. 지우지 않는다. 보관하지 못하면 그 실행의 저장은 하지 않는다.
/// - 기기 백업에서 일부러 빼지 않는다(Apple 문서가 사용자 자료에는 백업 제외 속성을 쓰지 말라고 한다).
/// - 파일을 어디로도 보내지 않는다.
final class StoreFile: @unchecked Sendable {
    static let fileName = "store.json"
    /// 저장 중에 쓰는 임시 파일 이름의 앞부분. 앱이 쓰다 끝나 남은 것은 시작할 때 지운다.
    static let temporaryPrefix = ".store-"
    static let temporarySuffix = ".tmp"

    let directory: URL
    var fileURL: URL { directory.appendingPathComponent(Self.fileName, isDirectory: false) }

    private let queue = DispatchQueue(label: "com.junnyson.scoreanatomy.store", qos: .userInitiated)
    private let disk: StoreDisk
    private let now: @Sendable () -> Date
    /// 이 실행에서 보관에 실패했는지. 큐 안에서만 읽고 쓴다(@unchecked Sendable 의 근거).
    private var archiveFailed = false

    init(directory: URL, disk: StoreDisk = FileStoreDisk(), now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory
        self.disk = disk
        self.now = now
    }

    /// 지금까지 받은 저장과 보관을 모두 마친 뒤의 내용을 읽는다.
    func read() -> StoreRead {
        queue.sync { readNow() }
    }

    /// 기록 전체(JSON 글자)를 저장한다. 끝나면 성공 여부를 알린다(큐에서 부른다).
    func save(_ json: String, completion: @escaping @Sendable (Bool) -> Void) {
        queue.async { completion(self.saveNow(json)) }
    }

    /// store.json 을 "store-보관-날짜시각.json" 으로 이름만 바꾼다. 끝나면 성공 여부를 알린다(큐에서 부른다).
    func archive(completion: @escaping @Sendable (Bool) -> Void) {
        queue.async { completion(self.archiveNow()) }
    }

    /// 쌓인 일이 모두 끝날 때까지 기다린다(앱이 끝날 때).
    func flush() {
        queue.sync {}
    }

    /// 앞선 실행이 저장하다 끝나 남은 임시 파일을 지운다. store.json 과 보관 파일은 건드리지 않는다.
    func removeLeftovers() {
        queue.sync {
            for url in disk.list(directory) {
                let name = url.lastPathComponent
                if name.hasPrefix(Self.temporaryPrefix), name.hasSuffix(Self.temporarySuffix) {
                    try? disk.remove(url)
                }
            }
        }
    }

    /// 보관 파일 이름. 같은 이름이 있으면 뒤에 -2, -3 을 붙인다.
    static func archiveName(at date: Date, attempt: Int, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let stamp = String(format: "%04d%02d%02d-%02d%02d%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0, c.second ?? 0)
        let suffix = attempt > 1 ? "-\(attempt)" : ""
        return "store-보관-\(stamp)\(suffix).json"
    }

    // MARK: 아래는 큐 안에서만 부른다.

    private func readNow() -> StoreRead {
        let url = fileURL
        guard disk.exists(url) else { return .missing }
        guard let data = try? disk.read(url), let text = String(data: data, encoding: .utf8) else { return .unreadable }
        return .text(text)
    }

    private func saveNow(_ json: String) -> Bool {
        // 보관하지 못한 실행에서는 읽지 못한 기록을 덮어쓰지 않도록 저장하지 않는다.
        if archiveFailed { return false }
        let temporary = directory.appendingPathComponent("\(Self.temporaryPrefix)\(UUID().uuidString)\(Self.temporarySuffix)", isDirectory: false)
        do {
            try disk.makeDirectory(directory)
            try disk.writeNew(Data(json.utf8), to: temporary)
            try disk.replace(fileURL, with: temporary)
            return true
        } catch {
            try? disk.remove(temporary)
            return false
        }
    }

    private func archiveNow() -> Bool {
        let url = fileURL
        // 보관할 파일이 없으면 잃을 것도 없다.
        guard disk.exists(url) else { return true }
        let date = now()
        for attempt in 1...100 {
            let target = directory.appendingPathComponent(Self.archiveName(at: date, attempt: attempt), isDirectory: false)
            if disk.exists(target) { continue }
            do {
                try disk.moveWithoutReplacing(url, to: target)
                return true
            } catch {
                break
            }
        }
        archiveFailed = true
        return false
    }
}

/// 기록 파일이 쓰는 파일 조작. 단위 테스트가 실패를 흉내 낼 수 있게 따로 둔다.
protocol StoreDisk: Sendable {
    func exists(_ url: URL) -> Bool
    func read(_ url: URL) throws -> Data
    func list(_ directory: URL) -> [URL]
    func makeDirectory(_ url: URL) throws
    /// 새 파일을 만들어 쓰고 디스크에 내린다.
    func writeNew(_ data: Data, to url: URL) throws
    /// source 의 이름을 destination 으로 바꾼다. destination 이 있으면 한 번에 바꿔치기한다.
    func replace(_ destination: URL, with source: URL) throws
    /// source 의 이름을 destination 으로 바꾼다. destination 이 있으면 실패한다.
    func moveWithoutReplacing(_ source: URL, to destination: URL) throws
    func remove(_ url: URL) throws
}

/// 실제 파일 시스템.
struct FileStoreDisk: StoreDisk {
    func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    func read(_ url: URL) throws -> Data {
        try Data(contentsOf: url)
    }

    func list(_ directory: URL) -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    func makeDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func writeNew(_ data: Data, to url: URL) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let handle = try FileHandle(forWritingTo: url)
        do {
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
    }

    func replace(_ destination: URL, with source: URL) throws {
        let result = source.withUnsafeFileSystemRepresentation { from in
            destination.withUnsafeFileSystemRepresentation { to -> Int32 in
                guard let from, let to else { return -1 }
                return rename(from, to)
            }
        }
        if result != 0 {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }

    func moveWithoutReplacing(_ source: URL, to destination: URL) throws {
        try FileManager.default.moveItem(at: source, to: destination)
    }

    func remove(_ url: URL) throws {
        try FileManager.default.removeItem(at: url)
    }
}

/// 기록 파일을 두는 곳.
enum StoreLocation {
    /// Application Support 아래 번들 ID 이름의 폴더.
    static func defaultDirectory(bundleIdentifier: String? = Bundle.main.bundleIdentifier) -> URL {
        URL.applicationSupportDirectory.appendingPathComponent(bundleIdentifier ?? "com.junnyson.scoreanatomy", isDirectory: true)
    }
}
