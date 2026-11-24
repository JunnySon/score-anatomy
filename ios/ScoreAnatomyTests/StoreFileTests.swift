import XCTest
@testable import ScoreAnatomy

/// 기록 파일(store.json) 저장, 보관, 읽기.
final class StoreFileTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("store-tests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        // 권한을 바꾼 테스트가 있어서 되돌린 뒤 지운다.
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: directory.path)
        try? FileManager.default.removeItem(at: directory)
    }

    private func save(_ store: StoreFile, _ json: String) -> Bool {
        let done = expectation(description: "저장")
        let result = LockedBox(false)
        store.save(json) { ok in
            result.set(ok)
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        return result.get()
    }

    private func archive(_ store: StoreFile) -> Bool {
        let done = expectation(description: "보관")
        let result = LockedBox(false)
        store.archive { ok in
            result.set(ok)
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        return result.get()
    }

    private func names() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).sorted()
    }

    func testFileMissingReadsAsNull() {
        let store = StoreFile(directory: directory)
        XCTAssertEqual(store.read(), .missing)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path), "읽기만 해서는 폴더를 만들지 않는다")
    }

    func testFirstSaveCreatesFolderAndFile() throws {
        let store = StoreFile(directory: directory)
        XCTAssertTrue(save(store, #"{"version":1,"sessions":[]}"#))
        XCTAssertEqual(store.read(), .text(#"{"version":1,"sessions":[]}"#))
        XCTAssertEqual(store.fileURL.lastPathComponent, "store.json")
        XCTAssertEqual(names(), ["store.json"], "임시 파일이 남지 않는다")
    }

    func testHundredSavesKeepTheLastOne() {
        let store = StoreFile(directory: directory)
        let finished = expectation(description: "100번 저장")
        finished.expectedFulfillmentCount = 100
        let okCount = LockedBox(0)
        for i in 1...100 {
            store.save("{\"n\":\(i)}") { ok in
                if ok { okCount.update { $0 += 1 } }
                finished.fulfill()
            }
        }
        wait(for: [finished], timeout: 20)
        XCTAssertEqual(okCount.get(), 100)
        XCTAssertEqual(store.read(), .text("{\"n\":100}"))
        XCTAssertEqual(names(), ["store.json"])
    }

    func testSavesAreAppliedInOrderEvenWhenSentQuickly() {
        let store = StoreFile(directory: directory)
        let order = LockedBox<[Int]>([])
        let finished = expectation(description: "저장")
        finished.expectedFulfillmentCount = 30
        for i in 1...30 {
            store.save("\(i)") { _ in
                order.update { $0.append(i) }
                finished.fulfill()
            }
        }
        wait(for: [finished], timeout: 10)
        XCTAssertEqual(order.get(), Array(1...30), "받은 차례대로 처리한다")
        XCTAssertEqual(store.read(), .text("30"))
    }

    func testWriteFailureKeepsOriginalFile() throws {
        XCTAssertTrue(save(StoreFile(directory: directory), "원래 기록"))
        for step in [FailingDisk.Step.makeDirectory, .write, .replace] {
            let failing = StoreFile(directory: directory, disk: FailingDisk(failAt: step))
            XCTAssertFalse(save(failing, "새 기록"), "\(step) 에서 실패하면 false")
            XCTAssertEqual(StoreFile(directory: directory).read(), .text("원래 기록"), "\(step) 에서 실패해도 원래 파일 그대로")
            XCTAssertEqual(names(), ["store.json"], "\(step) 에서 실패해도 임시 파일이 남지 않는다")
        }
    }

    func testRealPermissionFailureKeepsOriginalFile() throws {
        let store = StoreFile(directory: directory)
        XCTAssertTrue(save(store, "원래 기록"))
        // 폴더에 쓸 수 없게 하면 임시 파일을 만들지 못한다.
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: directory.path)
        XCTAssertFalse(save(store, "새 기록"))
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: directory.path)
        XCTAssertEqual(store.read(), .text("원래 기록"))
        XCTAssertEqual(names(), ["store.json"])
        // 다시 쓸 수 있게 되면 저장된다.
        XCTAssertTrue(save(store, "새 기록"))
        XCTAssertEqual(store.read(), .text("새 기록"))
    }

    func testArchiveRenamesThenStartsFresh() throws {
        let fixed = Date(timeIntervalSince1970: 1_795_000_000)
        let store = StoreFile(directory: directory, now: { fixed })
        XCTAssertTrue(save(store, "앞선 기록"))
        XCTAssertTrue(archive(store))
        XCTAssertEqual(store.read(), .missing, "보관한 뒤에는 store.json 이 없다(새로 시작)")
        let archived = StoreFile.archiveName(at: fixed, attempt: 1)
        XCTAssertEqual(names(), [archived])
        XCTAssertTrue(save(store, "새 기록"))
        XCTAssertEqual(store.read(), .text("새 기록"))
        XCTAssertEqual(try String(contentsOf: directory.appendingPathComponent(archived), encoding: .utf8), "앞선 기록", "보관 파일은 지우지 않고 그대로 둔다")
        XCTAssertEqual(names(), [archived, "store.json"].sorted())
    }

    func testArchiveNameFormatAndCollision() throws {
        let fixed = Date(timeIntervalSince1970: 1_795_000_000)
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(StoreFile.archiveName(at: fixed, attempt: 1, timeZone: utc), "store-보관-20261118-110640.json")
        XCTAssertEqual(StoreFile.archiveName(at: fixed, attempt: 2, timeZone: utc), "store-보관-20261118-110640-2.json")
        let store = StoreFile(directory: directory, now: { fixed })
        XCTAssertTrue(save(store, "첫째"))
        XCTAssertTrue(archive(store))
        XCTAssertTrue(save(store, "둘째"))
        XCTAssertTrue(archive(store))
        XCTAssertEqual(names(), [StoreFile.archiveName(at: fixed, attempt: 1), StoreFile.archiveName(at: fixed, attempt: 2)].sorted())
    }

    func testArchiveWithoutFileSucceedsAndKeepsSaving() {
        let store = StoreFile(directory: directory)
        XCTAssertTrue(archive(store), "보관할 파일이 없으면 잃을 것도 없다")
        XCTAssertTrue(save(store, "기록"))
        XCTAssertEqual(store.read(), .text("기록"))
    }

    func testArchiveFailureStopsSavesForThisRun() throws {
        XCTAssertTrue(save(StoreFile(directory: directory), "읽지 못한 기록"))
        let store = StoreFile(directory: directory, disk: FailingDisk(failAt: .move))
        XCTAssertFalse(archive(store))
        XCTAssertFalse(save(store, "새 기록"), "보관하지 못하면 그 실행의 저장은 하지 않는다")
        XCTAssertFalse(save(store, "또 새 기록"))
        XCTAssertEqual(StoreFile(directory: directory).read(), .text("읽지 못한 기록"), "store.json 을 그대로 둔다")
        // 다음 실행(새 인스턴스)은 다시 저장할 수 있다.
        XCTAssertTrue(save(StoreFile(directory: directory), "다음 실행"))
    }

    func testOrderAcrossArchive() throws {
        let fixed = Date(timeIntervalSince1970: 1_795_000_000)
        let store = StoreFile(directory: directory, now: { fixed })
        let finished = expectation(description: "차례")
        finished.expectedFulfillmentCount = 3
        store.save("A") { _ in finished.fulfill() }
        store.archive { _ in finished.fulfill() }
        store.save("B") { _ in finished.fulfill() }
        wait(for: [finished], timeout: 5)
        XCTAssertEqual(store.read(), .text("B"))
        XCTAssertEqual(try String(contentsOf: directory.appendingPathComponent(StoreFile.archiveName(at: fixed, attempt: 1)), encoding: .utf8), "A")
    }

    func testUnreadableBytesReadAsEmptyText() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data([0xFF, 0xFE, 0xFD, 0x80]).write(to: directory.appendingPathComponent("store.json"))
        XCTAssertEqual(StoreFile(directory: directory).read(), .unreadable)
    }

    func testEmptyFileIsTextNotMissing() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data().write(to: directory.appendingPathComponent("store.json"))
        XCTAssertEqual(StoreFile(directory: directory).read(), .text(""), "빈 파일도 있는 파일이다(웹은 빈 글자를 읽을 수 없는 것으로 보고 보관한다)")
    }

    func testLeftoverTemporaryFilesAreRemoved() throws {
        let store = StoreFile(directory: directory)
        XCTAssertTrue(save(store, "기록"))
        let leftover = directory.appendingPathComponent(".store-ABC.tmp")
        try Data("반쯤 쓴 것".utf8).write(to: leftover)
        let archived = directory.appendingPathComponent("store-보관-20260101-000000.json")
        try Data("보관".utf8).write(to: archived)
        store.removeLeftovers()
        XCTAssertFalse(FileManager.default.fileExists(atPath: leftover.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: archived.path), "보관 파일은 지우지 않는다")
        XCTAssertEqual(store.read(), .text("기록"))
    }

    func testDefaultLocationIsApplicationSupportBundleFolder() {
        let url = StoreLocation.defaultDirectory(bundleIdentifier: "com.example.test")
        XCTAssertEqual(url.lastPathComponent, "com.example.test")
        XCTAssertEqual(url.deletingLastPathComponent().lastPathComponent, "Application Support")
        XCTAssertEqual(StoreLocation.defaultDirectory().lastPathComponent, Bundle.main.bundleIdentifier)
    }
}

/// 정해 둔 단계에서 실패하는 파일 조작. 나머지는 실제 파일 시스템을 쓴다.
struct FailingDisk: StoreDisk {
    enum Step: CaseIterable { case makeDirectory, write, replace, move }
    let failAt: Step
    private let real = FileStoreDisk()

    func exists(_ url: URL) -> Bool { real.exists(url) }
    func read(_ url: URL) throws -> Data { try real.read(url) }
    func list(_ directory: URL) -> [URL] { real.list(directory) }

    func makeDirectory(_ url: URL) throws {
        if failAt == .makeDirectory { throw CocoaError(.fileWriteNoPermission) }
        try real.makeDirectory(url)
    }

    func writeNew(_ data: Data, to url: URL) throws {
        if failAt == .write {
            // 쓰다가 멈춘 것처럼 반쯤 쓴 임시 파일을 남기고 실패한다.
            try real.writeNew(data.prefix(1), to: url)
            throw CocoaError(.fileWriteOutOfSpace)
        }
        try real.writeNew(data, to: url)
    }

    func replace(_ destination: URL, with source: URL) throws {
        if failAt == .replace { throw POSIXError(.EIO) }
        try real.replace(destination, with: source)
    }

    func moveWithoutReplacing(_ source: URL, to destination: URL) throws {
        if failAt == .move { throw CocoaError(.fileWriteNoPermission) }
        try real.moveWithoutReplacing(source, to: destination)
    }

    func remove(_ url: URL) throws { try real.remove(url) }
}

/// 여러 스레드에서 쓰는 값을 잠가 둔다(테스트용).
final class LockedBox<Value>: @unchecked Sendable {
    private var value: Value
    private let lock = NSLock()

    init(_ value: Value) { self.value = value }

    func get() -> Value {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func set(_ newValue: Value) {
        update { $0 = newValue }
    }

    func update(_ change: (inout Value) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        change(&value)
    }
}
