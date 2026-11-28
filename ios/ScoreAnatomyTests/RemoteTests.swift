import CryptoKit
import JavaScriptCore
import XCTest
@testable import ScoreAnatomy

// 시험 자료 받기와 서명 확인의 단위 테스트(작업 지시서 4의 3-3, docs/시험_배포_규격.md 3장, exam-data/testdata/README.md).
// 테스트 전용 발행물과 공개 키는 저장소의 exam-data/testdata 에서 읽는다(읽기만 함). 테스트 전용 비밀 키는 파일을 쓰지 않고
// scripts/exams/sign.ts 와 같은 방법(이름의 SHA-256 을 씨앗으로)으로 만든다. 키 값을 이 소스에 적지 않는다.
// 통신 테스트는 ios/scripts/exam_server.py(verify.sh 가 켬)의 주소를 SA_EXAM_SERVER 로 받는다.

enum RemoteFixtures {
    /// 저장소 폴더(이 파일: ios/ScoreAnatomyTests/RemoteTests.swift).
    static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    /// 테스트 전용 발행물 폴더. 단위 테스트를 돌리는 앱은 데스크톱 폴더(macOS 의 개인정보 보호로 관리되는 곳)를 읽지 못해서,
    /// verify.sh 가 exam-data/testdata 를 데스크톱 밖 임시 폴더에 복사해 SA_TESTDATA 로 넘긴다. 없으면 저장소의 폴더를 읽는다.
    static let testdata: URL = {
        if let path = ProcessInfo.processInfo.environment["SA_TESTDATA"], !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return repo.appendingPathComponent("exam-data/testdata", isDirectory: true)
    }()
    /// 배포용 앱 검사 스크립트(ios/scripts/exam_key.py). 같은 까닭으로 SA_EXAM_KEY_SCRIPT 로 복사본을 받는다.
    static let scanScript: URL = {
        if let path = ProcessInfo.processInfo.environment["SA_EXAM_KEY_SCRIPT"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        return repo.appendingPathComponent("ios/scripts/exam_key.py")
    }()
    static let keyNames = ["score-anatomy/test-only-signing-key/v1", "score-anatomy/test-only-other-key/v1"]

    static func bytes(_ publication: String, _ path: String) throws -> [UInt8] {
        let url = testdata.appendingPathComponent(publication).appendingPathComponent(path)
        return Array(try Data(contentsOf: url))
    }

    /// 발행물 폴더 하나를 경로별 바이트로.
    static func publication(_ name: String) throws -> [String: [UInt8]] {
        let root = testdata.appendingPathComponent(name, isDirectory: true)
        var files: [String: [UInt8]] = [:]
        files["index.json"] = try bytes(name, "index.json")
        files["index.json.sig"] = try bytes(name, "index.json.sig")
        for file in try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("files").path) {
            files["files/\(file)"] = try bytes(name, "files/\(file)")
        }
        return files
    }

    static func testPublicKey() throws -> [UInt8] {
        let file = Array(try Data(contentsOf: testdata.appendingPathComponent("test-only-public-key.txt")))
        return try XCTUnwrap(ReleaseCheck.publicKeyBytes(fromFile: file), "테스트 전용 공개 키 파일을 읽어야 한다")
    }

    /// scripts/exams/sign.ts 의 seededSigningKey 와 같은 방법으로 만든 테스트 전용 비밀 키.
    static func signingKey(_ number: Int = 0) -> Curve25519.Signing.PrivateKey {
        let seed = Data(SHA256.hash(data: Data(keyNames[number].utf8)))
        return try! Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    }

    /// index.json 바이트에 대한 서명 파일(표준 base64 한 줄과 LF).
    static func signature(_ index: [UInt8], key: Curve25519.Signing.PrivateKey = signingKey()) -> [UInt8] {
        let sig = try! key.signature(for: Data(index))
        return Array((sig.base64EncodedString() + "\n").utf8)
    }

    static func temporaryDirectory(_ name: String = #function) -> URL {
        let safe = name.replacingOccurrences(of: "[^A-Za-z0-9]", with: "-", options: .regularExpression)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("remote-\(safe)-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// 시험 서버 주소(verify.sh 가 TEST_RUNNER_SA_EXAM_SERVER 로 넘김). 없으면 nil.
    static var server: String? {
        let value = ProcessInfo.processInfo.environment["SA_EXAM_SERVER"] ?? ""
        return value.isEmpty ? nil : value
    }
}

/// 경로별 바이트에서 가져온다. 가져간 경로를 적는다.
final class MemorySource: ReleaseSource, @unchecked Sendable {
    private let files: [String: [UInt8]]
    private let lock = NSLock()
    private var asked: [String] = []

    init(_ files: [String: [UInt8]]) {
        self.files = files
    }

    var requested: [String] {
        lock.lock()
        defer { lock.unlock() }
        return asked
    }

    func get(_ path: String) async -> Result<[UInt8], ReleaseFetchSession.Failure> {
        lock.withLock { asked.append(path) }
        guard let bytes = files[path] else { return .failure(.status(404)) }
        return .success(bytes)
    }
}

// MARK: - 엄격한 JSON

final class StrictJSONTests: XCTestCase {
    private func parse(_ text: String) throws -> JSONNode {
        try StrictJSON.parse(Array(text.utf8))
    }

    private func rejects(_ bytes: [UInt8], _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try StrictJSON.parse(bytes), message, file: file, line: line)
    }

    private func rejects(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        rejects(Array(text.utf8), "받지 않아야 한다: \(text)", file: file, line: line)
    }

    func testReadsValuesLikeJSONParse() throws {
        let node = try parse(#" { "a": [1, -0, 2.5e3, 1E-2, true, false, null], "b": "한글 \"따옴표\" \\ \/ \n \u00e9 \ud83d\ude00", "c": {} } "#)
        guard case .array(let items)? = node.member("a")?.value else { return XCTFail("배열이어야 한다") }
        XCTAssertEqual(items.count, 7)
        if case .number(let v) = items[0].value { XCTAssertEqual(v, 1) } else { XCTFail() }
        if case .number(let v) = items[2].value { XCTAssertEqual(v, 2500) } else { XCTFail() }
        if case .number(let v) = items[3].value { XCTAssertEqual(v, 0.01) } else { XCTFail() }
        if case .bool(true) = items[4].value {} else { XCTFail() }
        if case .null = items[6].value {} else { XCTFail() }
        guard case .string(let b)? = node.member("b")?.value else { return XCTFail() }
        XCTAssertEqual(b.text, "한글 \"따옴표\" \\ / \n \u{e9} \u{1F600}")
        XCTAssertTrue(node.member("c")?.isObject ?? false)
    }

    func testKeepsLoneSurrogatesAsUnits() throws {
        let node = try parse(#"{"a":"\ud800","b":"\udbff"}"#)
        guard case .string(let a)? = node.member("a")?.value, case .string(let b)? = node.member("b")?.value else { return XCTFail() }
        XCTAssertEqual(a.units, [0xD800])
        XCTAssertNotEqual(a, b, "짝 없는 서로게이트도 자바스크립트처럼 코드 단위로 견준다")
    }

    func testDuplicateKeysUseTheLastLikeJSONParse() throws {
        let node = try parse(#"{"id":"first","id":"last"}"#)
        guard case .string(let id)? = node.member("id")?.value else { return XCTFail() }
        XCTAssertEqual(id.text, "last")
    }

    func testRangesPointAtTheExactBytes() throws {
        let text = #"{ "locks" : [ {"x":1} ] , "n": 2 }"#
        let bytes = Array(text.utf8)
        let node = try StrictJSON.parse(bytes)
        let locks = try XCTUnwrap(node.member("locks"))
        XCTAssertEqual(String(decoding: bytes[locks.range], as: UTF8.self), #"[ {"x":1} ]"#)
    }

    func testBigNumbersFollowJavaScript() throws {
        let node = try parse("[1e400, 9007199254740993]")
        guard case .array(let items) = node.value, case .number(let inf) = items[0].value, case .number(let big) = items[1].value else { return XCTFail() }
        XCTAssertEqual(inf, .infinity)
        XCTAssertEqual(big, 9_007_199_254_740_992)
    }

    func testRejectsBOMAndBrokenUTF8() {
        rejects([0xEF, 0xBB, 0xBF] + Array("{}".utf8), "BOM 은 빈칸이 아니다(웹의 JSON.parse 도 읽지 못함)")
        rejects([0x22, 0xC3, 0x28, 0x22], "깨진 UTF-8")
        rejects([0x22, 0xC0, 0x80, 0x22], "너무 긴 UTF-8(overlong)")
        rejects([0x22, 0xED, 0xA0, 0x80, 0x22], "UTF-8 로 적은 서로게이트")
        rejects([0x22, 0xF4, 0x90, 0x80, 0x80, 0x22], "U+10FFFF 를 넘는 글자")
        rejects([0x22, 0xE2, 0x82, 0x22], "중간에 끊긴 글자")
    }

    func testRejectsGrammarErrors() {
        for text in ["", " ", "01", "+1", ".5", "1.", "1e", "-", "--1", "[1,]", "{\"a\":1,}", "{'a':1}", "{a:1}", "[1 2]",
                     "\"\u{1}\"", "\"\\x\"", "\"\\u12\"", "\"\\u12G4\"", "NaN", "Infinity", "[1]//", "/*x*/1", "{} x", "tru", "nul",
                     "\u{A0}1", "[\"a\"\u{3000}]", "\"abc", "{\"a\" 1}", "[", "{"] {
            rejects(text)
        }
    }

    func testDepthLimit() throws {
        let ok = String(repeating: "[", count: StrictJSON.maxDepth) + String(repeating: "]", count: StrictJSON.maxDepth)
        XCTAssertNoThrow(try parse(ok))
        let deep = String(repeating: "[", count: StrictJSON.maxDepth + 1) + String(repeating: "]", count: StrictJSON.maxDepth + 1)
        XCTAssertThrowsError(try parse(deep)) { error in
            XCTAssertEqual(error as? StrictJSON.Failure, .tooDeep)
        }
    }

    func testJavaScriptTrimSpaces() {
        XCTAssertTrue(JSONString("\u{3000} \t\u{FEFF}").isBlankForJavaScript)
        XCTAssertFalse(JSONString(" a ").isBlankForJavaScript)
        XCTAssertFalse(JSONString("\u{200B}").isBlankForJavaScript, "폭 없는 빈칸(U+200B)은 자바스크립트의 trim 이 지우지 않는다")
    }
}

// MARK: - 공개 키, 서명, 테스트 전용 키

final class ReleaseKeyTests: XCTestCase {
    func testTestOnlyPublicKeyFileAndFingerprint() throws {
        let key = try RemoteFixtures.testPublicKey()
        XCTAssertEqual(ReleaseCheck.fingerprint(key), "f7e7dc5cfc6ce2a0", "docs/시험_배포_규격.md 7장의 지문")
        XCTAssertEqual(key, Array(RemoteFixtures.signingKey(0).publicKey.rawRepresentation), "sign.ts 의 첫째 이름으로 만든 키와 같다")
    }

    func testSecondTestOnlyKeyFromSignTsName() {
        let other = Array(RemoteFixtures.signingKey(1).publicKey.rawRepresentation)
        XCTAssertEqual(ReleaseCheck.fingerprint(other), "99e0a1fa9d0331bc", "docs/시험_배포_규격.md 3-1 의 3번의 지문")
    }

    /// 배포용 앱 검사(ios/scripts/exam_key.py)에 적은 두 공개 키가 sign.ts 의 이름으로 만든 키와 같은지.
    func testReleaseScanScriptHasTheSameTestKeys() throws {
        let script = try String(contentsOf: RemoteFixtures.scanScript, encoding: .utf8)
        for number in 0..<2 {
            let pub = RemoteFixtures.signingKey(number).publicKey.rawRepresentation
            let line = "\"\(ReleaseCheck.fingerprint(Array(pub)))\": \"\(pub.base64EncodedString())\""
            XCTAssertTrue(script.contains(line), "exam_key.py 에 \(line) 이 있어야 한다")
        }
    }

    func testPublicKeyTextStrictness() throws {
        let good = try XCTUnwrap(String(data: Data(contentsOf: RemoteFixtures.testdata.appendingPathComponent("test-only-public-key.txt")), encoding: .utf8))
        let body = good.trimmingCharacters(in: .newlines)
        XCTAssertNotNil(ReleaseCheck.publicKeyBytes(fromFile: Array((body + "\n").utf8)))
        XCTAssertNotNil(ReleaseCheck.publicKeyBytes(fromFile: Array((body + "\r\n").utf8)), "끝의 CRLF 하나는 괜찮다")
        XCTAssertNotNil(ReleaseCheck.publicKeyBytes(fromFile: Array(body.utf8)), "줄바꿈이 없어도 된다")
        XCTAssertNil(ReleaseCheck.publicKeyBytes(fromFile: Array((body + "\n\n").utf8)), "줄이 둘이면 안 된다")
        XCTAssertNil(ReleaseCheck.publicKeyBytes(fromFile: Array((" " + body).utf8)))
        XCTAssertNil(ReleaseCheck.publicKeyBytes(fromFile: Array(String(body.dropLast()).utf8)), "패딩이 없으면 안 된다")
        XCTAssertNil(ReleaseCheck.publicKeyBytes(fromFile: Array("-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----\n".utf8)))
        // 남는 비트가 0이 아닌 글자(다시 적으면 다른 글자가 됨)는 받지 않는다.
        var chars = Array(body)
        let last = chars[42]
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")
        let index = try XCTUnwrap(alphabet.firstIndex(of: last))
        chars[42] = alphabet[(index & ~3) | ((index & 3) == 0 ? 1 : 0)]
        XCTAssertNil(ReleaseCheck.publicKeyBytes(fromFile: Array(String(chars).utf8)), "정규 모양이 아닌 base64")
    }

    func testSignatureTextStrictness() throws {
        let sig = try RemoteFixtures.bytes("test-only-valid", "index.json.sig")
        XCTAssertNotNil(ReleaseCheck.signatureBytes(fromFile: sig))
        let body = String(decoding: sig, as: UTF8.self).trimmingCharacters(in: .newlines)
        XCTAssertNotNil(ReleaseCheck.signatureBytes(fromFile: Array((body + "\r\n").utf8)))
        XCTAssertNil(ReleaseCheck.signatureBytes(fromFile: Array((body + " \n").utf8)))
        XCTAssertNil(ReleaseCheck.signatureBytes(fromFile: Array(String(body.dropLast(2)).utf8)))
        XCTAssertNil(ReleaseCheck.signatureBytes(fromFile: [0xFF] + sig), "UTF-8 이 아니면 틀린 모양")
    }

    /// 규격 10장: CryptoKit 이 문서의 공개 키(32바이트)와 서명(64바이트) 모양을 그대로 받는지.
    func testCryptoKitAcceptsTheDocumentedKeyAndSignatureShape() throws {
        let key = try RemoteFixtures.testPublicKey()
        let valid = ReleaseCheck.signedIndex(index: try RemoteFixtures.bytes("test-only-valid", "index.json"),
                                             signature: try RemoteFixtures.bytes("test-only-valid", "index.json.sig"), publicKey: key)
        guard case .success(let signed) = valid else { return XCTFail("정상 발행물의 서명이 맞아야 한다: \(valid)") }
        XCTAssertEqual(signed.seq, 2)
        let bad = ReleaseCheck.signedIndex(index: try RemoteFixtures.bytes("test-only-bad-signature", "index.json"),
                                           signature: try RemoteFixtures.bytes("test-only-bad-signature", "index.json.sig"), publicKey: key)
        guard case .failure(.signatureMismatch) = bad else { return XCTFail("다른 키로 한 서명은 맞지 않아야 한다: \(bad)") }
        let changed = ReleaseCheck.signedIndex(index: try RemoteFixtures.bytes("test-only-changed-byte", "index.json"),
                                               signature: try RemoteFixtures.bytes("test-only-changed-byte", "index.json.sig"), publicKey: key)
        guard case .success = changed else { return XCTFail("한 바이트 바뀐 발행물은 index.json 의 서명은 맞다: \(changed)") }
        // 서명 한 비트를 바꾸면 맞지 않는다.
        var sig = try RemoteFixtures.bytes("test-only-valid", "index.json.sig")
        sig[10] = sig[10] == UInt8(ascii: "A") ? UInt8(ascii: "B") : UInt8(ascii: "A")
        let flipped = ReleaseCheck.signedIndex(index: try RemoteFixtures.bytes("test-only-valid", "index.json"), signature: sig, publicKey: key)
        XCTAssertNotEqual(flipped.successValue?.seq, 2)
    }
}

extension Result {
    var successValue: Success? {
        if case .success(let value) = self { return value }
        return nil
    }
}

// MARK: - 받는 쪽 시험 순서와 틀린 발행물

final class ReleaseRunTests: XCTestCase {
    private var store: RemoteStore!
    private var key: [UInt8] = []

    override func setUpWithError() throws {
        store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory(name))
        key = try RemoteFixtures.testPublicKey()
    }

    private func run(_ files: [String: [UInt8]], current: RemoteSnapshot?) async -> (RemoteOutcome, [String]) {
        let source = MemorySource(files)
        let outcome = await RemoteRun.evaluate(source: source, publicKey: key, current: current, store: store, limit: 9)
        return (outcome, source.requested)
    }

    private func accepted(_ outcome: RemoteOutcome, file: StaticString = #filePath, line: UInt = #line) -> RemoteSnapshot? {
        guard case .accepted(let snapshot) = outcome else {
            XCTFail("받아들여야 한다: \(outcome)", file: file, line: line)
            return nil
        }
        return snapshot
    }

    private func failed(_ outcome: RemoteOutcome, containing text: String, file: StaticString = #filePath, line: UInt = #line) {
        guard case .failed(let why) = outcome else { return XCTFail("버려야 한다: \(outcome)", file: file, line: line) }
        XCTAssertTrue(why.contains(text), "까닭에 '\(text)' 가 있어야 한다: \(why)", file: file, line: line)
    }

    /// exam-data/testdata/README.md 의 "받는 쪽 시험 순서" 1~7번.
    func testReceivingOrderFromTestdataReadme() async throws {
        let valid = try RemoteFixtures.publication("test-only-valid")
        let badSignature = try RemoteFixtures.publication("test-only-bad-signature")
        let changedByte = try RemoteFixtures.publication("test-only-changed-byte")
        let olderSeq = try RemoteFixtures.publication("test-only-older-seq")

        // 1. 아무것도 받지 않은 상태에서 서명이 틀린 것은 버린다.
        var (outcome, asked) = await run(badSignature, current: nil)
        failed(outcome, containing: "서명")
        XCTAssertEqual(asked, ["index.json", "index.json.sig"], "서명이 틀리면 시험 파일을 받지 않는다")
        XCTAssertEqual(store.load(), .none)
        // 2. 한 바이트 바뀐 것도 버린다.
        (outcome, _) = await run(changedByte, current: nil)
        failed(outcome, containing: "sha256")
        XCTAssertEqual(store.load(), .none)
        // 3. 정상 발행물을 받아들인다(seq 2, rev 2).
        (outcome, asked) = await run(valid, current: nil)
        let first = try XCTUnwrap(accepted(outcome))
        XCTAssertEqual(first.seq, 2)
        XCTAssertEqual(first.exams.map(\.rev), [2])
        XCTAssertEqual(first.exams.first?.id.text, "test-only-exam")
        XCTAssertEqual(asked, ["index.json", "index.json.sig", "files/test-only-exam.2.json"])
        XCTAssertEqual(store.load(), .snapshot(first), "받아들인 자료를 보관한다")
        // 4. 같은 것을 다시 주면 seq 가 같아 그대로 둔다(시험 파일은 받지 않는다).
        (outcome, asked) = await run(valid, current: first)
        XCTAssertEqual(outcome, .unchanged(seq: 2))
        XCTAssertEqual(asked, ["index.json", "index.json.sig"])
        // 5. seq 가 작은 것은 버린다(seq 2 그대로).
        (outcome, _) = await run(olderSeq, current: first)
        XCTAssertEqual(outcome, .unchanged(seq: 1))
        XCTAssertEqual(store.load(), .snapshot(first))
        // 6. 서명이 틀린 것과 한 바이트 바뀐 것(둘 다 seq 3)은 버린다.
        (outcome, _) = await run(badSignature, current: first)
        failed(outcome, containing: "서명")
        (outcome, _) = await run(changedByte, current: first)
        failed(outcome, containing: "sha256")
        XCTAssertEqual(store.load(), .snapshot(first), "seq 2 그대로")
        // 7. 처음 상태에서 seq 가 작은 것을 받아들이고(정답 공개 전 판), 이어서 정상 발행물을 받아들인다.
        store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory("seven"))
        (outcome, _) = await run(olderSeq, current: nil)
        let older = try XCTUnwrap(accepted(outcome))
        XCTAssertEqual(older.seq, 1)
        XCTAssertEqual(older.exams.map(\.rev), [1])
        (outcome, _) = await run(valid, current: older)
        let newer = try XCTUnwrap(accepted(outcome))
        XCTAssertEqual(newer.seq, 2)
        XCTAssertEqual(newer.exams.map(\.rev), [2], "같은 id 는 rev 가 큰 판")
    }

    // MARK: 틀린 발행물 만들기

    private func validIndexText() throws -> String {
        String(decoding: try RemoteFixtures.bytes("test-only-valid", "index.json"), as: UTF8.self)
    }

    private func examText() throws -> String {
        String(decoding: try RemoteFixtures.bytes("test-only-valid", "files/test-only-exam.2.json"), as: UTF8.self)
    }

    /// index.json 글자를 바꾸고 테스트 전용 키로 다시 서명한 발행물.
    private func signed(index: [UInt8], files extra: [String: [UInt8]] = [:]) throws -> [String: [UInt8]] {
        var files = try RemoteFixtures.publication("test-only-valid")
        files["index.json"] = index
        files["index.json.sig"] = RemoteFixtures.signature(index)
        for (path, bytes) in extra { files[path] = bytes }
        return files
    }

    private func replaced(_ text: String, _ old: String, _ new: String, file: StaticString = #filePath, line: UInt = #line) -> String {
        XCTAssertTrue(text.contains(old), "바꿀 글자가 있어야 한다: \(old)", file: file, line: line)
        return text.replacingOccurrences(of: old, with: new)
    }

    private func expectRejected(index: String, extra: [String: [UInt8]] = [:], because text: String, file: StaticString = #filePath, line: UInt = #line) async throws {
        try await expectRejected(indexBytes: Array(index.utf8), extra: extra, because: text, file: file, line: line)
    }

    private func expectRejected(indexBytes: [UInt8], extra: [String: [UInt8]] = [:], because text: String, file: StaticString = #filePath, line: UInt = #line) async throws {
        let (outcome, _) = await run(try signed(index: indexBytes, files: extra), current: nil)
        failed(outcome, containing: text, file: file, line: line)
        XCTAssertEqual(store.load(), .none, "아무것도 보관하지 않는다", file: file, line: line)
    }

    func testRejectsBOMAndBrokenUTF8InIndex() async throws {
        let text = try validIndexText()
        try await expectRejected(indexBytes: [0xEF, 0xBB, 0xBF] + Array(text.utf8), because: "엄격한 UTF-8")
        var broken = Array(text.utf8)
        let at = try XCTUnwrap(broken.firstIndex(of: UInt8(ascii: "T")))
        broken[at] = 0xFF
        try await expectRejected(indexBytes: broken, because: "엄격한 UTF-8")
    }

    func testRejectsUnknownFormatAndBadSeq() async throws {
        let text = try validIndexText()
        try await expectRejected(index: replaced(text, "\"format\": 1,", "\"format\": 2,"), because: "format")
        try await expectRejected(index: replaced(text, "\"format\": 1,", "\"format\": \"1\","), because: "format")
        for seq in ["0", "2.5", "\"2\"", "9007199254740993", "-1", "true", "null"] {
            try await expectRejected(index: replaced(text, "\"seq\": 2\n", "\"seq\": \(seq)\n"), because: "seq")
        }
    }

    func testRejectsBadIssuedAtLocksAndExams() async throws {
        let text = try validIndexText()
        for issued in ["2030-02-30T17:10", "2030-01-02T24:00", "2030-01-02T17:60", "2030-01-02 17:10", "2030-1-02T17:10", "２０３０-01-02T17:10"] {
            try await expectRejected(index: replaced(text, "\"2030-01-02T17:10\"", "\"\(issued)\""), because: "issuedAt")
        }
        let noLocksArray = replaced(text, "\"locks\": [\n    {\n      \"end\": \"2030-01-02T17:45\",\n      \"id\": \"test-only-lock\",\n      \"label\": \"테스트 전용 잠금(형식 예시 시각)\",\n      \"start\": \"2030-01-02T08:40\"\n    }\n  ],", "\"locks\": {},")
        try await expectRejected(index: noLocksArray, because: "locks")
        let examsObject = replaced(text, "\"exams\": [", "\"exams\": {\"list\": [")
        try await expectRejected(index: replaced(examsObject, "  ],\n  \"format\"", "  ]},\n  \"format\""), because: "exams")
    }

    private func expectEntryRejected(index: String, because reason: String, file: StaticString = #filePath, line: UInt = #line) async throws {
        let (result, asked) = await run(try signed(index: Array(index.utf8)), current: nil)
        failed(result, containing: reason, file: file, line: line)
        XCTAssertEqual(store.load(), .none, file: file, line: line)
        XCTAssertEqual(asked, ["index.json", "index.json.sig"], "목록 검사에서 거부하면 시험 파일을 요청하지 않는다", file: file, line: line)
    }

    func testRejectsBadEntries() async throws {
        let text = try validIndexText()
        let entry = "    {\n      \"file\": \"files/test-only-exam.2.json\",\n      \"id\": \"test-only-exam\",\n      \"rev\": 2,\n      \"sha256\": \"b5c482cf24759d67ebc7263fc7bafc60ce23bded7b880b1ab96e19ee6ef59241\"\n    }"
        XCTAssertTrue(text.contains(entry))
        // 겹친 id(파일 이름은 다르게).
        let second = entry.replacingOccurrences(of: "files/test-only-exam.2.json", with: "files/copy.json")
        try await expectEntryRejected(index: replaced(text, entry, entry + ",\n" + second), because: "id 가 앞의 항목과 겹쳐요")
        // 겹친 file.
        let third = entry.replacingOccurrences(of: "\"test-only-exam\"", with: "\"other-exam\"")
        try await expectEntryRejected(index: replaced(text, entry, entry + ",\n" + third), because: "file 이 앞의 항목과 겹쳐요")
        // 빈 id 와 자바스크립트가 지우는 빈칸만 있는 id.
        for id in ["", "   ", "\\u3000"] {
            try await expectEntryRejected(index: replaced(text, "\"id\": \"test-only-exam\"", "\"id\": \"\(id)\""), because: "id 가 비어 있어요")
        }
        // 안전하지 않은 경로.
        let longPath = "files/" + String(repeating: "a", count: 200) + ".json"
        for path in ["../files/test-only-exam.2.json", "/files/test-only-exam.2.json", "files/./test-only-exam.2.json", "files\\\\test-only-exam.2.json",
                     "files/%2e%2e/x.json", "files/x.json?a=1", "files/.hidden.json", "files//x.json", "index.json", "index.json.sig",
                     "C:/x.json", "", "https://example.com/x.json", "files/한글.json", longPath] {
            try await expectEntryRejected(index: replaced(text, "\"files/test-only-exam.2.json\"", "\"\(path)\""), because: "file")
        }
        // rev 와 sha256 모양.
        for rev in ["0", "\"2\"", "2.5", "null"] {
            try await expectEntryRejected(index: replaced(text, "\"rev\": 2,", "\"rev\": \(rev),"), because: "rev")
        }
        for sha in ["B5C482CF24759D67EBC7263FC7BAFC60CE23BDED7B880B1AB96E19EE6EF59241", "b5c482", "zz" + String(repeating: "0", count: 62)] {
            try await expectEntryRejected(index: replaced(text, "b5c482cf24759d67ebc7263fc7bafc60ce23bded7b880b1ab96e19ee6ef59241", sha), because: "sha256")
        }
        // 항목이 객체가 아님.
        try await expectEntryRejected(index: replaced(text, entry, "    \"files/test-only-exam.2.json\""), because: "객체가 아니에요")
    }

    func testRejectsExamFileProblems() async throws {
        let text = try validIndexText()
        let exam = try examText()
        let path = "files/test-only-exam.2.json"
        let oldSHA = "b5c482cf24759d67ebc7263fc7bafc60ce23bded7b880b1ab96e19ee6ef59241"
        func with(file bytes: [UInt8]) -> String {
            text.replacingOccurrences(of: oldSHA, with: ReleaseCheck.sha256Hex(bytes))
        }
        // sha256 이 다름.
        try await expectRejected(index: replaced(text, oldSHA, String(repeating: "0", count: 64)), because: "sha256")
        // 파일 안의 id 가 다름(sha256 은 맞게).
        let otherId = Array(replaced(exam, "\"id\": \"test-only-exam\"", "\"id\": \"other-exam\"").utf8)
        try await expectRejected(index: with(file: otherId), extra: [path: otherId], because: "id")
        // 파일 안의 rev 가 다름.
        let otherRev = Array(replaced(exam, "\"rev\": 2,", "\"rev\": 3,").utf8)
        try await expectRejected(index: with(file: otherRev), extra: [path: otherRev], because: "rev")
        let stringRev = Array(replaced(exam, "\"rev\": 2,", "\"rev\": \"2\",").utf8)
        try await expectRejected(index: with(file: stringRev), extra: [path: stringRev], because: "rev")
        // JSON 이 아님, BOM, 깨진 UTF-8, 객체가 아님.
        let notJSON = Array("시험 파일이 아니에요".utf8)
        try await expectRejected(index: with(file: notJSON), extra: [path: notJSON], because: "JSON")
        let bom = [0xEF, 0xBB, 0xBF] + Array(exam.utf8)
        try await expectRejected(index: with(file: bom), extra: [path: bom], because: "JSON")
        var broken = Array(exam.utf8)
        broken[3] = 0xFE
        try await expectRejected(index: with(file: broken), extra: [path: broken], because: "JSON")
        let array = Array("[]".utf8)
        try await expectRejected(index: with(file: array), extra: [path: array], because: "객체가 아니에요")
        // 시험 파일을 받지 못함.
        var files = try signed(index: Array(text.utf8))
        files[path] = nil
        let (outcome, _) = await run(files, current: nil)
        failed(outcome, containing: path)
    }

    /// 시험 파일에 rev 가 없으면 웹의 revOf 처럼 1로 본다.
    func testExamWithoutRevCountsAsRevOne() async throws {
        let text = try validIndexText()
        let exam = try examText()
        let noRev = Array(replaced(exam, "  \"rev\": 2,\n", "").utf8)
        var index = replaced(text, "b5c482cf24759d67ebc7263fc7bafc60ce23bded7b880b1ab96e19ee6ef59241", ReleaseCheck.sha256Hex(noRev))
        index = replaced(index, "\"rev\": 2,", "\"rev\": 1,")
        let (outcome, _) = await run(try signed(index: Array(index.utf8), files: ["files/test-only-exam.2.json": noRev]), current: nil)
        XCTAssertEqual(accepted(outcome)?.exams.first?.rev, 1)
    }

    /// 다른 키로 받아들인 자료는 견주지 않고, 지금 키로 새로 받아들인다.
    func testDataFromAnotherKeyIsNotMerged() async throws {
        let other = RemoteSnapshot(keyFingerprint: "0000000000000000", seq: 99, issuedAt: "2030-01-02T17:10", locks: Array("[]".utf8),
                                   exams: [RemoteExam(id: JSONString("kept"), rev: 1, sha256: "x", bytes: Array("{}".utf8))])
        let (outcome, _) = await run(try RemoteFixtures.publication("test-only-valid"), current: other)
        let snapshot = try XCTUnwrap(accepted(outcome))
        XCTAssertEqual(snapshot.seq, 2, "다른 키의 seq 99 와 견주지 않는다")
        XCTAssertEqual(snapshot.exams.map(\.id.text), ["test-only-exam"], "다른 키로 받은 시험을 남기지 않는다")
    }
}

// MARK: - 합치기(3-1 의 2번)

final class RemoteMergeTests: XCTestCase {
    private func exam(_ id: String, _ rev: Int) -> RemoteExam {
        let bytes = Array("{\"id\":\"\(id)\",\"rev\":\(rev)}".utf8)
        return RemoteExam(id: JSONString(id), rev: rev, sha256: ReleaseCheck.sha256Hex(bytes), bytes: bytes)
    }

    private func entry(_ id: String, _ rev: Int) -> ReleaseEntry {
        let e = exam(id, rev)
        return ReleaseEntry(id: e.id, rev: rev, file: "files/\(id).\(rev).json", sha256: e.sha256)
    }

    func testKeepsAcceptedExamsByIdAndLargerRev() {
        let current = RemoteSnapshot(keyFingerprint: "k", seq: 1, issuedAt: "2030-01-02T08:40", locks: Array("[1]".utf8),
                                     exams: [exam("a", 2), exam("b", 1)])
        let index = CheckedIndex(seq: 2, issuedAt: "2030-01-02T17:10", entries: [entry("a", 1), entry("c", 1)], locks: Array("[]".utf8))
        let files = ["files/a.1.json": exam("a", 1).bytes, "files/c.1.json": exam("c", 1).bytes]
        let merged = RemoteSnapshot.merging(current: current, index: index, files: files, keyFingerprint: "k")
        XCTAssertEqual(merged.exams.map(\.id.text), ["a", "c", "b"], "새 발행물 차례, 그 뒤에 남긴 시험")
        XCTAssertEqual(merged.exams.map(\.rev), [2, 1, 1], "가진 판의 rev 가 크면 가진 판을 둔다")
        XCTAssertEqual(merged.seq, 2)
        XCTAssertEqual(merged.locks, Array("[]".utf8), "잠금 달력은 새 발행물의 것")
    }

    func testRemoteJSONIsExactBytes() throws {
        let tricky = Array("{\"id\":\"t\",\"rev\":1,\"note\":\"\\ud800 \u{2028} 1.0\",\"__proto__\":{\"x\":1}}\n".utf8)
        let snapshot = RemoteSnapshot(keyFingerprint: "k", seq: 3, issuedAt: "2030-01-02T17:10", locks: Array("[ ]".utf8),
                                      exams: [RemoteExam(id: JSONString("t"), rev: 1, sha256: ReleaseCheck.sha256Hex(tricky), bytes: tricky)])
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("var window = {}; var got = [];")
        context.evaluateScript("window.__saFromApp = function (m) { got.push(m); };")
        context.evaluateScript(ToWeb.remote(snapshot).deliverScript)
        XCTAssertNil(context.exception)
        XCTAssertTrue(context.evaluateScript("got.length === 1 && got[0].type === 'remote' && got[0].remote.seq === 3 && got[0].remote.issuedAt === '2030-01-02T17:10'").toBool())
        XCTAssertTrue(context.evaluateScript("Array.isArray(got[0].remote.locks) && got[0].remote.exams.length === 1").toBool())
        XCTAssertTrue(context.evaluateScript("Object.prototype.hasOwnProperty.call(got[0].remote.exams[0], '__proto__')").toBool(), "JSON.parse 처럼 __proto__ 를 제 칸으로 읽는다")
        XCTAssertTrue(context.evaluateScript("got[0].remote.exams[0].note.charCodeAt(0) === 0xD800 && got[0].remote.exams[0].note.charCodeAt(2) === 0x2028").toBool())
    }
}

// MARK: - 보관

final class RemoteStoreTests: XCTestCase {
    private func snapshot() throws -> RemoteSnapshot {
        let bytes = try RemoteFixtures.bytes("test-only-valid", "files/test-only-exam.2.json")
        return RemoteSnapshot(keyFingerprint: "f7e7dc5cfc6ce2a0", seq: 2, issuedAt: "2030-01-02T17:10", locks: Array("[]".utf8),
                              exams: [RemoteExam(id: JSONString("test-only-exam"), rev: 2, sha256: ReleaseCheck.sha256Hex(bytes), bytes: bytes)])
    }

    func testSaveAndLoad() throws {
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        XCTAssertEqual(store.load(), .none)
        let value = try snapshot()
        XCTAssertTrue(store.save(value))
        XCTAssertEqual(store.load(), .snapshot(value))
        XCTAssertTrue(store.directory.path.hasSuffix("/remote"), "기록 파일 폴더 아래 remote 폴더")
    }

    func testBrokenFileCountsAsNone() throws {
        let directory = RemoteFixtures.temporaryDirectory()
        let store = RemoteStore(storeDirectory: directory)
        let value = try snapshot()
        XCTAssertTrue(store.save(value))
        let good = try Data(contentsOf: store.fileURL)
        func write(_ data: Data) throws {
            try data.write(to: store.fileURL)
        }
        for broken in [Data(), Data("{".utf8), Data([0xFF, 0x00]), good.prefix(good.count / 2)] {
            try write(broken)
            XCTAssertEqual(store.load(), .unreadable)
        }
        // 시험 파일 바이트가 바뀌면(SHA-256 이 다름) 읽지 못한 것으로 다룬다.
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: good) as? [String: Any])
        var exams = try XCTUnwrap(object["exams"] as? [[String: Any]])
        let original = Data(base64Encoded: try XCTUnwrap(exams[0]["bytes"] as? String))!
        var changed = original
        changed[changed.count - 3] ^= 0x01
        exams[0]["bytes"] = changed.base64EncodedString()
        object["exams"] = exams
        try write(try JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(store.load(), .unreadable)
        // 모르는 형식 번호.
        object = try XCTUnwrap(JSONSerialization.jsonObject(with: good) as? [String: Any])
        object["storeFormat"] = 2
        try write(try JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(store.load(), .unreadable)
        // 기록 파일(store.json)은 건드리지 않는다.
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("store.json").path))
    }

    func testUnreadableRemotePreservesExistingRecordBytes() throws {
        let directory = RemoteFixtures.temporaryDirectory()
        let store = RemoteStore(storeDirectory: directory)
        XCTAssertTrue(store.save(try snapshot()))
        let record = directory.appendingPathComponent("store.json")
        let existing = Data("{\"records\":[]}".utf8)
        try existing.write(to: record)
        try Data("{".utf8).write(to: store.fileURL)
        XCTAssertEqual(store.load(), .unreadable)
        XCTAssertEqual(try Data(contentsOf: record), existing)
    }

    func testFailedSaveKeepsTheOldFile() throws {
        final class FailingDisk: StoreDisk, @unchecked Sendable {
            let real = FileStoreDisk()
            var failReplace = false
            func exists(_ url: URL) -> Bool { real.exists(url) }
            func read(_ url: URL) throws -> Data { try real.read(url) }
            func list(_ directory: URL) -> [URL] { real.list(directory) }
            func makeDirectory(_ url: URL) throws { try real.makeDirectory(url) }
            func writeNew(_ data: Data, to url: URL) throws { try real.writeNew(data, to: url) }
            func replace(_ destination: URL, with source: URL) throws {
                if failReplace { throw CocoaError(.fileWriteUnknown) }
                try real.replace(destination, with: source)
            }
            func moveWithoutReplacing(_ source: URL, to destination: URL) throws { try real.moveWithoutReplacing(source, to: destination) }
            func remove(_ url: URL) throws { try real.remove(url) }
        }
        let disk = FailingDisk()
        let directory = RemoteFixtures.temporaryDirectory()
        let store = RemoteStore(storeDirectory: directory, disk: disk)
        let old = try snapshot()
        XCTAssertTrue(store.save(old))
        disk.failReplace = true
        let newer = RemoteSnapshot(keyFingerprint: old.keyFingerprint, seq: 3, issuedAt: old.issuedAt, locks: old.locks, exams: old.exams)
        XCTAssertFalse(store.save(newer), "바꿔치기하지 못하면 실패")
        XCTAssertEqual(store.load(), .snapshot(old), "옛 자료가 온전히 남는다")
        let left = (try? FileManager.default.contentsOfDirectory(atPath: store.directory.path)) ?? []
        XCTAssertEqual(left, ["remote.json"], "임시 파일을 남기지 않는다")
    }

    func testLeftoverTemporaryFilesAreRemoved() throws {
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        try FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
        let leftover = store.directory.appendingPathComponent(".remote-앞선실행.tmp")
        try Data("x".utf8).write(to: leftover)
        _ = store.load()
        XCTAssertFalse(FileManager.default.fileExists(atPath: leftover.path))
    }

    @MainActor
    func testUpdaterUsesSavedDataOnlyForTheSameKey() throws {
        let directory = RemoteFixtures.temporaryDirectory()
        let value = try snapshot()
        XCTAssertTrue(RemoteStore(storeDirectory: directory).save(value))
        let key = try RemoteFixtures.testPublicKey()
        let same = RemoteUpdater(settings: RemoteSettings(location: nil, publicKey: key), store: RemoteStore(storeDirectory: directory))
        XCTAssertEqual(same.snapshot, value, "주소가 없어도 같은 키로 받아들인 보관 자료는 시작할 때 넘긴다")
        let other = RemoteUpdater(settings: RemoteSettings(location: nil, publicKey: Array(RemoteFixtures.signingKey(1).publicKey.rawRepresentation)),
                                  store: RemoteStore(storeDirectory: directory))
        XCTAssertNil(other.snapshot, "다른 키로 받아들인 자료는 쓰지 않는다")
        let none = RemoteUpdater(settings: RemoteSettings(location: nil, publicKey: nil), store: RemoteStore(storeDirectory: directory))
        XCTAssertNil(none.snapshot, "믿는 키가 없으면 보관 자료도 쓰지 않는다")
    }
}

// MARK: - 다리와 주소

final class RemoteBridgeTests: XCTestCase {
    func testParseRemoteRefresh() {
        XCTAssertEqual(BridgeCommand.parse(name: "saRemote", body: ["op": "refresh"]), .remoteRefresh)
        XCTAssertEqual(BridgeCommand.parse(name: "saRemote", body: ["op": "other"]), .ignored)
        XCTAssertEqual(BridgeCommand.parse(name: "saRemote", body: "refresh"), .ignored)
    }

    func testRemoteFailedScript() throws {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("var window = {}; var got = []; window.__saFromApp = function (m) { got.push(m); };")
        context.evaluateScript(ToWeb.remoteFailed.deliverScript)
        XCTAssertNil(context.exception)
        XCTAssertTrue(context.evaluateScript("got.length === 1 && got[0].type === 'remoteFailed'").toBool())
    }

    func testAppInfoScriptCarriesRemote() throws {
        let bytes = try RemoteFixtures.bytes("test-only-valid", "files/test-only-exam.2.json")
        let snapshot = RemoteSnapshot(keyFingerprint: "k", seq: 2, issuedAt: "2030-01-02T17:10", locks: Array("[]".utf8),
                                      exams: [RemoteExam(id: JSONString("test-only-exam"), rev: 2, sha256: ReleaseCheck.sha256Hex(bytes), bytes: bytes)])
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("var window = {};")
        context.evaluateScript(AppInfoScript.source(appVersion: "0.3.2", store: .missing, fontScale: 1, remote: snapshot))
        XCTAssertNil(context.exception)
        XCTAssertTrue(context.evaluateScript("window.__SA_APP__.bridge === 2 && window.__SA_APP__.remote.seq === 2").toBool())
        XCTAssertTrue(context.evaluateScript("window.__SA_APP__.remote.exams[0].id === 'test-only-exam' && window.__SA_APP__.remote.exams[0].rev === 2").toBool())
        let none = try XCTUnwrap(JSContext())
        none.evaluateScript("var window = {};")
        none.evaluateScript(AppInfoScript.source(appVersion: "0.3.2", store: .missing, fontScale: 1, remote: nil))
        XCTAssertTrue(none.evaluateScript("window.__SA_APP__.remote === null && window.__SA_APP__.bridge === 2").toBool(), "보관한 자료가 없으면 null")
    }

    func testLocationRules() throws {
        let base = try XCTUnwrap(RemoteLocation("https://exams.example.com/score-anatomy"))
        XCTAssertEqual(base.base.absoluteString, "https://exams.example.com/score-anatomy/")
        XCTAssertEqual(base.url(for: "index.json")?.absoluteString, "https://exams.example.com/score-anatomy/index.json")
        XCTAssertEqual(base.url(for: "files/a.1.json")?.absoluteString, "https://exams.example.com/score-anatomy/files/a.1.json")
        for bad in ["../x.json", "/x.json", "files/../x", "x?y", "https://other.example/x", "", ".x"] {
            XCTAssertNil(base.url(for: bad), bad)
        }
        XCTAssertNil(RemoteLocation("http://exams.example.com/"), "배포용 주소는 https 만")
        XCTAssertNil(RemoteLocation("http://127.0.0.1:4180/"), "시험 서버 주소는 Debug 에서만(allowLoopbackHTTP)")
        XCTAssertNotNil(RemoteLocation("http://127.0.0.1:4180/s/a/", allowLoopbackHTTP: true))
        XCTAssertNil(RemoteLocation("http://localhost:4180/", allowLoopbackHTTP: true), "시험 서버도 127.0.0.1 만")
        XCTAssertNil(RemoteLocation("http://example.com/", allowLoopbackHTTP: true))
        for bad in ["", " ", "exams.example.com/", "https://user:pw@exams.example.com/", "https://exams.example.com/?a=1", "https://exams.example.com/#x", "ftp://exams.example.com/"] {
            XCTAssertNil(RemoteLocation(bad), bad)
        }
    }

    /// 이 앱(시험을 돌리는 Debug 앱)의 설정: 주소(SA_EXAM_BASE_URL)가 비어 있고 exam-data/public-key.txt 가 없어서 받지 않는다.
    func testBundleSettingsWithoutAddressAndKeyDoNotFetch() {
        let settings = RemoteSettings.fromBundle(.main)
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "SAExamBaseURL") as? String, "", "주소 칸은 있고 비어 있다")
        XCTAssertNil(settings.location)
        XCTAssertFalse(settings.canFetch)
        let keyFile = Bundle.main.url(forResource: "exam-public-key", withExtension: "txt")
        XCTAssertNotNil(keyFile, "빌드 단계가 공개 키 파일을 늘 넣는다(없으면 빈 파일)")
        // 공개 키 파일이 비어 있으면(exam-data/public-key.txt 가 없을 때) 키가 없다.
        if let keyFile, let data = try? Data(contentsOf: keyFile), data.isEmpty {
            XCTAssertNil(settings.publicKey)
        }
    }

    @MainActor
    func testRefreshWithoutAddressAnswersFailed() {
        let updater = RemoteUpdater(settings: RemoteSettings(location: nil, publicKey: nil), store: RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory()))
        var sent: [ToWeb] = []
        updater.deliver = { sent.append($0) }
        updater.refreshRequested()
        XCTAssertEqual(sent, [.remoteFailed], "받을 수 없으면 곧바로 remoteFailed")
        updater.pageRendered()
        XCTAssertEqual(sent, [.remoteFailed], "주소가 없으면 켤 때 받지 않는다")
    }
}

// MARK: - 시험 서버로 받기

final class ReleaseNetworkTests: XCTestCase {
    private var serverBase = ""
    private var sessionName = ""

    override func setUpWithError() throws {
        guard let server = RemoteFixtures.server else {
            throw XCTSkip("시험 서버 주소(SA_EXAM_SERVER)가 없다. ios/scripts/verify.sh 가 켜서 넘긴다.")
        }
        serverBase = server.hasSuffix("/") ? String(server.dropLast()) : server
        sessionName = "u\(UUID().uuidString.prefix(8))"
    }

    private func control(_ query: String, session: String? = nil) async throws -> Data {
        try await Self.control(base: serverBase, session: session ?? sessionName, query)
    }

    static func control(base: String, session: String, _ query: String) async throws -> Data {
        let url = try XCTUnwrap(URL(string: "\(base)/control/\(session)/\(query)"))
        let (data, _) = try await URLSession(configuration: .ephemeral).data(from: url)
        return data
    }

    private func set(_ query: String, session: String? = nil) async throws {
        _ = try await control("set?\(query)", session: session)
    }

    private func log(session: String? = nil) async throws -> [[String: Any]] {
        let data = try await control("log", session: session)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    }

    private var location: RemoteLocation {
        RemoteLocation("\(serverBase)/s/\(sessionName)/", allowLoopbackHTTP: true)!
    }

    private func fetch(_ path: String, limit: TimeInterval = 9) async -> Result<[UInt8], ReleaseFetchSession.Failure> {
        let session = ReleaseFetchSession(limit: limit)
        defer { session.close() }
        return await NetworkReleaseSource(location: location, session: session).get(path)
    }

    func testFetchesPublicationBytesExactly() async throws {
        try await set("pub=test-only-valid")
        let got = await fetch("index.json")
        XCTAssertEqual(got.successValue, try RemoteFixtures.bytes("test-only-valid", "index.json"))
    }

    func testTooLargeLengthHeaderIsRefused() async throws {
        try await set("pub=test-only-valid&mode=biglength&size=\(5 * 1024 * 1024 + 1)")
        let got = await fetch("index.json")
        XCTAssertEqual(got, .failure(.tooBig))
    }

    func testStreamingOverFiveMegabytesIsCut() async throws {
        try await set("pub=test-only-valid&mode=bigstream&size=\(6 * 1024 * 1024)")
        let got = await fetch("index.json")
        XCTAssertEqual(got, .failure(.tooBig))
    }

    func testExactlyFiveMegabytesIsAllowed() async throws {
        try await set("pub=test-only-valid&mode=biglength&size=\(5 * 1024 * 1024)")
        let got = await fetch("index.json")
        XCTAssertEqual(got.successValue?.count, 5 * 1024 * 1024, "5MB 까지는 받는다")
    }

    func testRedirectIsNotFollowed() async throws {
        let target = "t\(UUID().uuidString.prefix(8))"
        try await set("pub=test-only-valid", session: target)
        try await set("pub=test-only-valid&mode=redirect&target=\(serverBase)/s/\(target)/index.json")
        let got = await fetch("index.json")
        XCTAssertEqual(got, .failure(.status(302)))
        try await Task.sleep(for: .milliseconds(300))
        let reached = try await log(session: target).count
        XCTAssertEqual(reached, 0, "넘긴 주소로는 요청이 가지 않는다")
    }

    func testNotFoundAndServerError() async throws {
        try await set("pub=test-only-valid&mode=status&status=404")
        let notFound = await fetch("index.json")
        XCTAssertEqual(notFound, .failure(.status(404)))
        try await set("pub=test-only-valid&mode=status&status=500")
        let serverError = await fetch("index.json")
        XCTAssertEqual(serverError, .failure(.status(500)))
    }

    func testSlowResponseTimesOut() async throws {
        try await set("pub=test-only-valid&mode=slow&delay=3")
        let started = Date()
        let got = await fetch("index.json", limit: 1)
        XCTAssertEqual(got, .failure(.timeout))
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.5, "제한 시간에서 끊는다")
    }

    func testTrickleTimesOutAtTheOverallLimit() async throws {
        try await set("pub=test-only-valid&mode=trickle&delay=0.2")
        let started = Date()
        let got = await fetch("index.json", limit: 1.5)
        XCTAssertEqual(got, .failure(.timeout), "조금씩 계속 와도 전체 시간 제한에서 끊는다")
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }

    func testCutOrDroppedConnectionFails() async throws {
        try await set("pub=test-only-valid&mode=cut")
        if case .success = await fetch("index.json") { XCTFail("도중에 끊기면 실패") }
        try await set("pub=test-only-valid&mode=drop")
        if case .success = await fetch("index.json") { XCTFail("응답 없이 끊기면 실패") }
    }

    func testGzipTransferIsDecoded() async throws {
        try await set("pub=test-only-valid&mode=gzip")
        let got = await fetch("index.json")
        XCTAssertEqual(got.successValue, try RemoteFixtures.bytes("test-only-valid", "index.json"), "전송 압축을 푼 바이트로 확인한다")
    }

    /// 요청에 붙는 머리글: 정해 둔 값뿐이고 기기나 사용자를 가리키는 값이 없다. 받은 머리글 전체를 결과 폴더에 적는다.
    func testRequestHeadersAreFixed() async throws {
        try await set("pub=test-only-valid")
        _ = await fetch("index.json")
        let entries = try await log()
        let entry = try XCTUnwrap(entries.first)
        let headers = try XCTUnwrap(entry["headers"] as? [[String]])
        var byName: [String: String] = [:]
        for pair in headers { byName[pair[0].lowercased()] = pair[1] }
        XCTAssertEqual(byName["user-agent"], "score-anatomy")
        XCTAssertEqual(byName["accept-language"], "ko")
        XCTAssertEqual(byName["cache-control"], "no-cache")
        XCTAssertEqual(byName["accept"], "*/*")
        XCTAssertEqual(byName["accept-encoding"], "gzip, deflate")
        XCTAssertEqual(entry["query"] as? String, "", "쿼리를 붙이지 않는다")
        // 이 맥의 iOS 26.4, 18.4 시뮬레이터에서 실제로 나간 머리글이 이 일곱 개였다(docs/ios_결정기록.md). 하나라도 더 붙으면 실패한다.
        let expected: Set<String> = ["host", "user-agent", "accept-language", "cache-control", "accept", "accept-encoding", "connection"]
        XCTAssertEqual(Set(byName.keys), expected, "정해 둔 머리글만 나가야 한다: \(headers)")
        XCTAssertEqual(headers.count, expected.count, "같은 머리글이 두 번 나가지 않는다")
        XCTAssertNil(byName["cookie"])
        let out = ProcessInfo.processInfo.environment["SA_OUT"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.temporaryDirectory
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let record = try JSONSerialization.data(withJSONObject: ["path": entry["path"] ?? "", "version": entry["version"] ?? "", "headers": headers], options: [.prettyPrinted, .sortedKeys])
        try record.write(to: out.appendingPathComponent("request-headers.json"))
    }

    /// 한 번 받기 전체: 정상 발행물을 받아들이고, 요청은 정해진 주소의 index.json, index.json.sig, 시험 파일뿐이다.
    func testFullRunRequestsOnlyThePublicationFiles() async throws {
        try await set("pub=test-only-valid")
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        let run = RemoteRun(location: location, publicKey: try RemoteFixtures.testPublicKey(), current: nil, store: store, limit: 9)
        let outcome = await run.run()
        guard case .accepted(let snapshot) = outcome else { return XCTFail("받아들여야 한다: \(outcome)") }
        XCTAssertEqual(snapshot.seq, 2)
        let paths = try await log().compactMap { $0["path"] as? String }
        XCTAssertEqual(paths, ["/s/\(sessionName)/index.json", "/s/\(sessionName)/index.json.sig", "/s/\(sessionName)/files/test-only-exam.2.json"])
    }

    /// 넘기는 응답이 시험 파일에서 와도 받지 않고, 아무것도 바꾸지 않는다.
    func testRedirectOnExamFileFailsTheWholeRun() async throws {
        try await set("pub=test-only-valid&mode=redirect&only=files/test-only-exam.2.json&target=\(serverBase)/s/elsewhere/x.json")
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        let outcome = await RemoteRun(location: location, publicKey: try RemoteFixtures.testPublicKey(), current: nil, store: store, limit: 9).run()
        guard case .failed(let why) = outcome else { return XCTFail("실패해야 한다: \(outcome)") }
        XCTAssertTrue(why.contains("302"), why)
        XCTAssertEqual(store.load(), .none)
    }

    /// 새로 확인: 처음 받아들이면 remote 하나, 다시 확인하면 지금 자료를 remote 로, 받지 못하면 remoteFailed.
    func testGzipChecksDecodedByteCount() async throws {
        try await set("pub=test-only-valid&mode=gzip")
        let file = "files/test-only-exam.2.json"
        let bytes = try RemoteFixtures.bytes("test-only-valid", file)
        let session = ReleaseFetchSession(limit: 9, maxBytes: bytes.count - 1)
        defer { session.close() }
        let result = await NetworkReleaseSource(location: location, session: session).get(file)
        XCTAssertEqual(result, .failure(.tooBig))
    }

    func testStopsBeforeTheEndOfAnOversizedResponse() async throws {
        try await set("pub=test-only-valid&mode=bigstream&size=\(ReleaseRules.maxFileBytes + 2)&delay=4")
        let result = await fetch("index.json", limit: 2)
        XCTAssertEqual(result, .failure(.tooBig), "마지막 바이트가 오기 전에 크기 초과를 판정한다")
    }

    func testCumulativeFetchDeadlineAndClosedSession() async throws {
        try await set("pub=test-only-valid&mode=slow&delay=0.8")
        let session = ReleaseFetchSession(limit: 1.35)
        defer { session.close() }
        let source = NetworkReleaseSource(location: location, session: session)
        let first = await source.get("index.json")
        XCTAssertNotNil(first.successValue)
        let second = await source.get("index.json.sig")
        XCTAssertEqual(second, .failure(.timeout))
        let third = await source.get("index.json")
        XCTAssertEqual(third, .failure(.timeout))
        let closed = ReleaseFetchSession(limit: 9)
        closed.close()
        let skipped = await NetworkReleaseSource(location: location, session: closed).get("index.json")
        XCTAssertEqual(skipped, .failure(.network(URLError.cancelled.rawValue)))
    }

    func testRejectsAuthenticationAndReusesNeitherCookiesNorResponses() async throws {
        let session = ReleaseFetchSession(limit: 9)
        defer { session.close() }
        let source = NetworkReleaseSource(location: location, session: session)
        try await set("pub=test-only-valid&mode=cookie")
        for _ in 0..<2 {
            let result = await source.get("index.json")
            XCTAssertNotNil(result.successValue)
        }
        try await set("pub=test-only-valid&mode=auth")
        let denied = await source.get("index.json")
        if case .success = denied { XCTFail("인증 요청은 실패해야 한다") }
        let rows = try await log()
        XCTAssertGreaterThanOrEqual(rows.count, 3)
        for row in rows {
            let headers = try XCTUnwrap(row["headers"] as? [[String]])
            let names = headers.compactMap { $0.first?.lowercased() }
            XCTAssertFalse(names.contains("authorization"))
            XCTAssertFalse(names.contains("cookie"))
        }
    }

    func testSevenPublicationStepsOverLoopback() async throws {
        let key = try RemoteFixtures.testPublicKey()
        var store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        func run(_ publication: String, current: RemoteSnapshot?) async throws -> RemoteOutcome {
            try await set("pub=" + publication)
            return await RemoteRun(location: location, publicKey: key, current: current, store: store, limit: 9).run()
        }
        func failure(_ outcome: RemoteOutcome, _ reason: String) {
            guard case .failed(let detail) = outcome else { return XCTFail("거부해야 한다") }
            XCTAssertTrue(detail.contains(reason), detail)
        }
        failure(try await run("test-only-bad-signature", current: nil), "서명")
        failure(try await run("test-only-changed-byte", current: nil), "sha256")
        XCTAssertEqual(store.load(), .none)
        guard case .accepted(let valid) = try await run("test-only-valid", current: nil) else { return XCTFail("정상 자료") }
        XCTAssertEqual(valid.seq, 2)
        let same = try await run("test-only-valid", current: valid)
        XCTAssertEqual(same, .unchanged(seq: 2))
        let past = try await run("test-only-older-seq", current: valid)
        XCTAssertEqual(past, .unchanged(seq: 1))
        failure(try await run("test-only-bad-signature", current: valid), "서명")
        failure(try await run("test-only-changed-byte", current: valid), "sha256")
        XCTAssertEqual(store.load(), .snapshot(valid))
        store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        guard case .accepted(let older) = try await run("test-only-older-seq", current: nil),
              case .accepted(let newer) = try await run("test-only-valid", current: older) else { return XCTFail("구판에서 새판으로 갱신") }
        XCTAssertEqual(older.seq, 1)
        XCTAssertEqual(newer, valid)
        XCTAssertEqual(store.load(), .snapshot(newer))
    }

    @MainActor
    func testUpdaterAnswersRefreshes() async throws {
        let base = serverBase
        let name = sessionName
        _ = try await Self.control(base: base, session: name, "set?pub=test-only-valid")
        let updater = RemoteUpdater(settings: RemoteSettings(location: location, publicKey: try RemoteFixtures.testPublicKey()),
                                    store: RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory()))
        var sent: [ToWeb] = []
        updater.deliver = { sent.append($0) }
        func waitFor(_ count: Int) async {
            for _ in 0..<200 where sent.count < count {
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
        updater.refreshRequested()
        updater.refreshRequested()
        await waitFor(1)
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(sent.count, 1, "받는 중에 온 새로 확인은 그 받기의 결과 하나로 답한다")
        guard case .remote(let first)? = sent.first else { return XCTFail("\(sent)") }
        XCTAssertEqual(first.seq, 2)
        updater.refreshRequested()
        await waitFor(2)
        XCTAssertEqual(sent.last, .remote(first), "새 자료가 없으면 지금 자료를 seq 그대로")
        _ = try await Self.control(base: base, session: name, "set?pub=test-only-valid&mode=status&status=500")
        updater.refreshRequested()
        await waitFor(3)
        XCTAssertEqual(sent.last, .remoteFailed)
        XCTAssertEqual(updater.snapshot, first, "받지 못해도 가진 자료 그대로")
    }
}

// MARK: 여러 파일 받기, 보관과 화면 생명주기

extension ReleaseRunTests {
    func testVerifiedStagingIsRecheckedAndNeverBecomesTheActiveStoreByItself() async throws {
        let publication = try RemoteFixtures.publication("test-only-valid")
        let path = "files/test-only-exam.2.json"
        let bytes = try XCTUnwrap(publication[path])
        let entry = ReleaseEntry(id: JSONString("test-only-exam"), rev: 2, file: path, sha256: ReleaseCheck.sha256Hex(bytes))
        var incomplete = publication
        incomplete.removeValue(forKey: path)
        store.stage(bytes, for: entry)
        XCTAssertEqual(store.load(), .none)
        let (outcome, asked) = await run(incomplete, current: nil)
        let value = try XCTUnwrap(accepted(outcome))
        XCTAssertEqual(asked, ["index.json", "index.json.sig"])
        XCTAssertEqual(value.exams.first?.bytes, bytes)
        XCTAssertNil(store.staged(entry), "반영한 뒤 중간 파일을 정리한다")

        let secondStore = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        secondStore.stage([0], for: entry)
        let source = MemorySource(publication)
        let retried = await RemoteRun.evaluate(source: source, publicKey: key, current: nil, store: secondStore, limit: 9)
        XCTAssertEqual(try XCTUnwrap(accepted(retried)), value)
        XCTAssertEqual(source.requested, ["index.json", "index.json.sig", path], "손상된 중간 파일은 서버에서 다시 받는다")
    }
}

extension RemoteStoreTests {
    func testDeadlineBeforeAtomicReplacePreservesCurrentStore() throws {
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        let old = try snapshot()
        let new = RemoteSnapshot(keyFingerprint: old.keyFingerprint, seq: old.seq + 1, issuedAt: old.issuedAt,
                                 locks: old.locks, exams: old.exams)
        XCTAssertTrue(store.save(old))
        var checkedAfterWrite = false
        XCTAssertFalse(store.save(new, whileCurrent: {
            checkedAfterWrite = (try? FileManager.default.contentsOfDirectory(atPath: store.directory.path))?
                .contains(where: { $0.hasPrefix(RemoteStore.temporaryPrefix) }) == true
            return false
        }))
        XCTAssertTrue(checkedAfterWrite)
        XCTAssertEqual(store.load(), .snapshot(old))
    }

    @MainActor
    func testBlankAddressKeepsDiskAndExposesNullUntilAddressIsConfigured() throws {
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory())
        let value = try snapshot()
        let key = try RemoteFixtures.testPublicKey()
        XCTAssertTrue(store.save(value))
        let disabled = RemoteUpdater(settings: RemoteSettings(location: nil, publicKey: key), store: store)
        XCTAssertNil(disabled.snapshotForWeb)
        XCTAssertEqual(store.load(), .snapshot(value))
        let location = try XCTUnwrap(RemoteLocation("http://127.0.0.1/", allowLoopbackHTTP: true))
        let enabled = RemoteUpdater(settings: RemoteSettings(location: location, publicKey: key), store: store)
        XCTAssertEqual(enabled.snapshotForWeb, value, "주소가 설정된 다음 시작에는 같은 키의 보관 자료를 바로 넘긴다")
    }
}

extension ReleaseNetworkTests {
    @MainActor
    func testBackgroundInterruptsFetchAndForegroundRetriesWithoutWaitingFiveMinutes() async throws {
        let base = serverBase
        let session = sessionName
        _ = try await Self.control(base: base, session: session, "set?pub=test-only-valid&mode=slow&only=index.json&delay=3")
        let updater = RemoteUpdater(settings: RemoteSettings(location: location, publicKey: try RemoteFixtures.testPublicKey()),
                                    store: RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory()))
        var messages: [ToWeb] = []
        var outcomes: [RemoteOutcome] = []
        updater.deliver = { messages.append($0) }
        updater.onFinish = { _, result, _ in outcomes.append(result) }
        func paths() async throws -> [String] {
            let log = try await Self.control(base: base, session: session, "log")
            let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: log) as? [[String: Any]])
            return rows.compactMap { $0["path"] as? String }
        }
        updater.appDidEnterBackground()
        updater.pageRendered()
        updater.refreshRequested()
        try await Task.sleep(for: .milliseconds(150))
        let beforeStart = try await paths()
        XCTAssertEqual(beforeStart, [])
        updater.appWillEnterForeground()
        for _ in 0..<80 {
            if !(try await paths()).isEmpty { break }
            try await Task.sleep(for: .milliseconds(30))
        }
        let started = try await paths()
        XCTAssertEqual(started, ["/s/\(session)/index.json"])
        updater.appDidEnterBackground()
        for _ in 0..<80 where outcomes.isEmpty { try await Task.sleep(for: .milliseconds(30)) }
        guard case .failed? = outcomes.first else { return XCTFail("진행 중인 받기가 취소돼야 한다") }
        XCTAssertNil(updater.snapshot)
        XCTAssertTrue(messages.isEmpty)
        _ = try await Self.control(base: base, session: session, "set?pub=test-only-valid")
        updater.appWillEnterForeground()
        for _ in 0..<150 where messages.isEmpty { try await Task.sleep(for: .milliseconds(30)) }
        guard case .remote(let value)? = messages.first else { return XCTFail("앞으로 돌아오자 다시 받은 결과가 와야 한다") }
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(value.seq, 2)
    }
}

// MARK: 전경의 새로 확인과 응답 마감

extension ReleaseNetworkTests {
    @MainActor
    func testManualRefreshWaitingInBackgroundBypassesRecentForegroundInterval() async throws {
        _ = try await Self.control(base: serverBase, session: sessionName, "set?pub=test-only-valid")
        let updater = RemoteUpdater(settings: RemoteSettings(location: location, publicKey: try RemoteFixtures.testPublicKey()),
                                    store: RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory()))
        var sent: [ToWeb] = []
        updater.deliver = { sent.append($0) }
        updater.pageRendered()
        for _ in 0..<100 where sent.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        guard case .remote(let first)? = sent.first else { return XCTFail("첫 발행물을 받는다") }
        updater.appDidEnterBackground()
        updater.refreshRequested()
        XCTAssertEqual(sent.count, 1)
        updater.appWillEnterForeground()
        for _ in 0..<100 where sent.count < 2 { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertEqual(sent, [.remote(first), .remote(first)], "5분 안이어도 대기하던 새로 확인에는 같은 seq로 응답한다")
    }

    func testCancellingSiblingAbortsInFlightNetworkRequest() async throws {
        enum Rejected: Error { case sibling }
        actor Observation {
            var result: Result<[UInt8], ReleaseFetchSession.Failure>?
            func record(_ value: Result<[UInt8], ReleaseFetchSession.Failure>) { result = value }
        }
        try await set("pub=test-only-valid&mode=slow&delay=4")
        let client = ReleaseFetchSession(limit: 9)
        defer { client.close() }
        let source = NetworkReleaseSource(location: location, session: client)
        let base = serverBase
        let session = sessionName
        let seen = Observation()
        do {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { await seen.record(await source.get("index.json")) }
                group.addTask {
                    // 실제 서버에 도착한 뒤 형제 작업이 실패한다.
                    for _ in 0..<100 {
                        let data = try await Self.control(base: base, session: session, "log")
                        let log = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
                        if !log.isEmpty { throw Rejected.sibling }
                        try await Task.sleep(for: .milliseconds(20))
                    }
                    XCTFail("형제 요청을 거부하기 전에 받기가 시작돼야 한다")
                }
                while try await group.next() != nil {}
            }
        } catch Rejected.sibling {}
        let result = await seen.result
        XCTAssertEqual(result, .failure(.network(URLError.cancelled.rawValue)), "서버가 정상 본문을 쓸 때까지 기다리지 않는다")
    }

    private final class DelayedPublishDisk: StoreDisk, @unchecked Sendable {
        enum Phase { case beforeReplace, afterReplace }
        let phase: Phase
        let real = FileStoreDisk()
        let release = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var committed = false
        private var paused = false
        var reachedPause: Bool { lock.withLock { paused } }

        init(_ phase: Phase) { self.phase = phase }
        private func pauseOnce() {
            let wait = lock.withLock {
                guard !paused else { return false }
                paused = true
                return true
            }
            if wait { _ = release.wait(timeout: .now() + 10) }
        }

        func exists(_ url: URL) -> Bool { real.exists(url) }
        func read(_ url: URL) throws -> Data { try real.read(url) }
        func list(_ url: URL) -> [URL] {
            if phase == .afterReplace, url.lastPathComponent == "staging", lock.withLock({ committed }) { pauseOnce() }
            return real.list(url)
        }
        func makeDirectory(_ url: URL) throws { try real.makeDirectory(url) }
        func writeNew(_ data: Data, to url: URL) throws {
            try real.writeNew(data, to: url)
            if phase == .beforeReplace, url.lastPathComponent.hasPrefix(RemoteStore.temporaryPrefix) { pauseOnce() }
        }
        func replace(_ destination: URL, with source: URL) throws {
            try real.replace(destination, with: source)
            if destination.lastPathComponent == RemoteStore.fileName { lock.withLock { committed = true } }
        }
        func moveWithoutReplacing(_ source: URL, to destination: URL) throws { try real.moveWithoutReplacing(source, to: destination) }
        func remove(_ url: URL) throws { try real.remove(url) }
    }

    @MainActor
    private func delayedPublish(_ phase: DelayedPublishDisk.Phase) async throws -> (RemoteUpdater, DelayedPublishDisk) {
        _ = try await Self.control(base: serverBase, session: sessionName, "set?pub=test-only-valid")
        let disk = DelayedPublishDisk(phase)
        let store = RemoteStore(storeDirectory: RemoteFixtures.temporaryDirectory(), disk: disk)
        let updater = RemoteUpdater(settings: RemoteSettings(location: location, publicKey: try RemoteFixtures.testPublicKey()),
                                    store: store, requestLimit: 2)
        return (updater, disk)
    }

    @MainActor
    func testSlowCleanupDoesNotHoldManualReplyOrSendLateReplyToNextRefresh() async throws {
        let (updater, disk) = try await delayedPublish(.afterReplace)
        defer { disk.release.signal() }
        var sent: [ToWeb] = []
        var outcomes: [RemoteOutcome] = []
        updater.deliver = { sent.append($0) }
        updater.onFinish = { _, result, _ in outcomes.append(result) }
        updater.refreshRequested()
        for _ in 0..<90 where sent.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertTrue(disk.reachedPause)
        let value = try XCTUnwrap(updater.snapshotForWeb)
        XCTAssertEqual(sent, [.remote(value)], "기한 내에 저장한 판은 정리 중에도 첫 요청에 성공으로 한 번 답한다")
        XCTAssertTrue(outcomes.isEmpty)
        updater.refreshRequested()
        XCTAssertEqual(sent, [.remote(value), .remoteFailed], "만료된 작업에 다음 요청을 붙이지 않는다")
        disk.release.signal()
        for _ in 0..<100 where outcomes.isEmpty { try await Task.sleep(for: .milliseconds(30)) }
        XCTAssertEqual(outcomes, [.accepted(value)])
        XCTAssertEqual(sent, [.remote(value), .remoteFailed], "옛 작업이 다음 요청에 늦은 응답을 보내지 않는다")
        updater.refreshRequested()
        for _ in 0..<100 where sent.count < 3 { try await Task.sleep(for: .milliseconds(30)) }
        XCTAssertEqual(sent, [.remote(value), .remoteFailed, .remote(value)])
    }

    @MainActor
    func testSlowCleanupAnnouncesFirstAutomaticAcceptanceExactlyOnce() async throws {
        let (updater, disk) = try await delayedPublish(.afterReplace)
        defer { disk.release.signal() }
        var sent: [ToWeb] = []
        var outcomes: [RemoteOutcome] = []
        updater.deliver = { sent.append($0) }
        updater.onFinish = { _, result, _ in outcomes.append(result) }
        XCTAssertNil(updater.snapshotForWeb)
        updater.pageRendered()
        for _ in 0..<90 where sent.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertTrue(disk.reachedPause)
        let value = try XCTUnwrap(updater.snapshotForWeb)
        XCTAssertEqual(value.seq, 2)
        XCTAssertEqual(sent, [.remote(value)], "새로 확인이 없는 첫 화면에도 받은 판을 알린다")
        XCTAssertTrue(outcomes.isEmpty)
        disk.release.signal()
        for _ in 0..<100 where outcomes.isEmpty { try await Task.sleep(for: .milliseconds(30)) }
        XCTAssertEqual(outcomes, [.accepted(value)])
        XCTAssertEqual(sent, [.remote(value)])
    }

    @MainActor
    func testManualDeadlineBeforeRenameCannotPublishAfterTheFailure() async throws {
        let (updater, disk) = try await delayedPublish(.beforeReplace)
        defer { disk.release.signal() }
        var sent: [ToWeb] = []
        var outcomes: [RemoteOutcome] = []
        updater.deliver = { sent.append($0) }
        updater.onFinish = { _, result, _ in outcomes.append(result) }
        updater.refreshRequested()
        for _ in 0..<90 where sent.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertTrue(disk.reachedPause)
        XCTAssertNil(updater.snapshotForWeb)
        XCTAssertEqual(sent, [.remoteFailed])
        updater.refreshRequested()
        XCTAssertEqual(sent, [.remoteFailed, .remoteFailed])
        disk.release.signal()
        for _ in 0..<100 where outcomes.isEmpty { try await Task.sleep(for: .milliseconds(30)) }
        guard case .failed? = outcomes.first else { return XCTFail("마감이 먼저라서 저장하지 않아야 한다") }
        XCTAssertNil(updater.snapshot)
        XCTAssertEqual(sent, [.remoteFailed, .remoteFailed])
        updater.refreshRequested()
        for _ in 0..<100 where sent.count < 3 { try await Task.sleep(for: .milliseconds(30)) }
        let value = try XCTUnwrap(updater.snapshotForWeb)
        XCTAssertEqual(sent, [.remoteFailed, .remoteFailed, .remote(value)])
    }
}
