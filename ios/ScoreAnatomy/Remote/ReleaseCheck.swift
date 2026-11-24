import CryptoKit
import Foundation

/// 발행물(index.json, index.json.sig, 시험 파일)의 확인(docs/시험_배포_규격.md 2장, 3장).
/// 발행 도구의 exams:verify(scripts/exams/verify.ts)와 같은 기준으로, 받은 바이트를 다시 직렬화하지 않고 그대로 본다.
///
/// 시험 파일의 내용 검사(validateExam)와 잠금 달력 검사(validateLocks)는 Swift 로 옮기지 않는다. 같은 규칙을 두 언어로 두면 어긋나서
/// 시험 날 멀쩡한 발행물을 버릴 수 있어서, 넘겨받은 시험과 달력은 웹이 다시 검사한다(docs/앱_다리_규격.md 7-4, docs/ios_결정기록.md).
/// 여기서는 웹이 remote 를 통째로 버리지 않을 겉모양(seq, issuedAt, exams 와 locks 가 배열)과 받는 쪽 규칙만 본다.
enum ReleaseRules {
    /// 아는 발행물 형식 번호(scripts/exams/release.ts 의 RELEASE_FORMAT).
    static let format: Double = 1
    /// 파일 하나로 받는 가장 큰 크기(푼 바이트).
    static let maxFileBytes = 5 * 1024 * 1024
    static let indexFile = "index.json"
    static let signatureFile = "index.json.sig"
    static let maxPathLength = 200
    /// 자바스크립트의 Number.MAX_SAFE_INTEGER.
    static let maxSafeInteger: Double = 9_007_199_254_740_991
}

/// 확인하지 못한 까닭. 기록과 시험에 쓴다(웹에는 remoteFailed 하나로 알린다).
enum ReleaseProblem: Error, Equatable, Sendable, CustomStringConvertible {
    case signatureShape
    case signatureMismatch
    case indexNotJSON
    case indexNotObject
    case unknownFormat
    case badSeq
    case badIssuedAt
    case locksNotArray
    case examsNotArray
    case badEntry(index: Int, reason: String)
    case examSHA256(file: String)
    case examNotJSON(file: String)
    case examNotObject(file: String)
    case examId(file: String)
    case examRev(file: String)

    var description: String {
        switch self {
        case .signatureShape: return "index.json.sig 의 모양이 틀려요(Ed25519 서명 64바이트의 표준 base64 한 줄)."
        case .signatureMismatch: return "서명이 맞지 않아요."
        case .indexNotJSON: return "index.json 이 엄격한 UTF-8 의 JSON 이 아니에요."
        case .indexNotObject: return "index.json 이 JSON 객체가 아니에요."
        case .unknownFormat: return "format 이 아는 값(1)이 아니에요."
        case .badSeq: return "seq 가 1 이상의 정수가 아니에요."
        case .badIssuedAt: return "issuedAt 이 실제로 있는 YYYY-MM-DDTHH:mm 이 아니에요."
        case .locksNotArray: return "locks 가 배열이 아니에요."
        case .examsNotArray: return "exams 가 배열이 아니에요."
        case .badEntry(let index, let reason): return "exams 의 \(index + 1)번째 항목: \(reason)"
        case .examSHA256(let file): return "\(file): sha256 이 index.json 에 적힌 값과 달라요."
        case .examNotJSON(let file): return "\(file): 엄격한 UTF-8 의 JSON 이 아니에요."
        case .examNotObject(let file): return "\(file): JSON 객체가 아니에요."
        case .examId(let file): return "\(file): 파일 안의 id 가 index.json 의 id 와 달라요."
        case .examRev(let file): return "\(file): 파일 안의 rev 가 index.json 의 rev 와 달라요."
        }
    }
}

/// index.json 의 시험 항목 하나.
struct ReleaseEntry: Equatable, Sendable {
    let id: JSONString
    let rev: Int
    let file: String
    let sha256: String
}

/// 서명과 format, seq 까지 확인한 index.json.
struct SignedIndex: Sendable {
    let bytes: [UInt8]
    let root: JSONNode
    let seq: Int
}

/// 항목 모양까지 모두 확인한 index.json.
struct CheckedIndex: Sendable {
    let seq: Int
    let issuedAt: String
    let entries: [ReleaseEntry]
    /// locks 값의 바이트 그대로(JSON 배열). 다시 직렬화하지 않고 웹에 넘긴다.
    let locks: [UInt8]
}

enum ReleaseCheck {
    // MARK: 공개 키와 서명의 글자

    /// 공개 키 파일(표준 base64 44자 한 줄, 끝의 줄바꿈 하나는 괜찮음)을 32바이트로 읽는다. 모양이 틀리면 nil.
    /// scripts/exams/sign.ts 의 parsePublicKeyText 와 같은 기준이다.
    static func publicKeyBytes(fromFile bytes: [UInt8]) -> [UInt8]? {
        guard let text = String(validating: bytes, as: UTF8.self) else { return nil }
        return strictBase64(oneLine(text), letters: 43, padding: 1, length: 32)
    }

    /// 서명 파일(표준 base64 88자 한 줄, 끝의 줄바꿈 하나는 괜찮음)을 64바이트로 읽는다. 모양이 틀리면 nil.
    /// UTF-8 이 아니면 빈 글자로 보고 틀린 것으로 한다(verify.ts 의 checkIndex 와 같다).
    static func signatureBytes(fromFile bytes: [UInt8]) -> [UInt8]? {
        let text = String(validating: bytes, as: UTF8.self) ?? ""
        return strictBase64(oneLine(text), letters: 86, padding: 2, length: 64)
    }

    /// 공개 키의 지문: 공개 키 32바이트의 SHA-256 을 16진수로 적은 것의 앞 16자.
    static func fingerprint(_ publicKey: [UInt8]) -> String {
        String(sha256Hex(publicKey).prefix(16))
    }

    static func sha256Hex(_ bytes: [UInt8]) -> String {
        SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined()
    }

    /// 끝의 줄바꿈 하나(LF 나 CRLF)만 뺀다. 그 밖의 빈칸이나 줄은 그대로 둬서 모양 검사에 걸리게 한다.
    private static func oneLine(_ text: String) -> String {
        if text.hasSuffix("\r\n") { return String(text.dropLast(2)) }
        if text.hasSuffix("\n") { return String(text.dropLast(1)) }
        return text
    }

    /// 표준 base64 를 바이트로. 다시 적었을 때 같은 글자가 되는 것만 받는다(남는 비트가 0이 아닌 글자 등은 받지 않음).
    private static func strictBase64(_ body: String, letters: Int, padding: Int, length: Int) -> [UInt8]? {
        let ascii = Array(body.utf8)
        guard ascii.count == letters + padding else { return nil }
        for (offset, byte) in ascii.enumerated() {
            if offset < letters {
                guard isBase64Letter(byte) else { return nil }
            } else {
                guard byte == UInt8(ascii: "=") else { return nil }
            }
        }
        guard let data = Data(base64Encoded: body), data.count == length, data.base64EncodedString() == body else { return nil }
        return Array(data)
    }

    private static func isBase64Letter(_ byte: UInt8) -> Bool {
        switch byte {
        case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "+"), UInt8(ascii: "/"):
            return true
        default:
            return false
        }
    }

    // MARK: index.json

    /// 차례 1~4: 서명(index.json 받은 바이트 그대로), 엄격한 UTF-8 의 JSON 객체, format, seq.
    /// 서명이 맞지 않으면 다른 것은 보지 않는다.
    static func signedIndex(index: [UInt8], signature: [UInt8], publicKey: [UInt8]) -> Result<SignedIndex, ReleaseProblem> {
        guard let sig = signatureBytes(fromFile: signature) else { return .failure(.signatureShape) }
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(Data(sig), for: Data(index))
        else { return .failure(.signatureMismatch) }
        let root: JSONNode
        do {
            root = try StrictJSON.parse(index)
        } catch {
            return .failure(.indexNotJSON)
        }
        guard root.isObject else { return .failure(.indexNotObject) }
        guard case .number(let format)? = root.member("format")?.value, format == ReleaseRules.format else {
            return .failure(.unknownFormat)
        }
        guard let seq = safeInteger(root.member("seq"), minimum: 1) else { return .failure(.badSeq) }
        return .success(SignedIndex(bytes: index, root: root, seq: seq))
    }

    /// 차례 5: issuedAt, locks 와 exams 의 겉모양, 항목마다 id, rev, file(안전한 경로), sha256.
    static func entries(of signed: SignedIndex) -> Result<CheckedIndex, ReleaseProblem> {
        let root = signed.root
        guard case .string(let issued)? = root.member("issuedAt")?.value, let issuedAt = issued.ascii, isValidYmdHm(issuedAt) else {
            return .failure(.badIssuedAt)
        }
        guard let locksNode = root.member("locks"), case .array = locksNode.value else { return .failure(.locksNotArray) }
        guard case .array(let items)? = root.member("exams")?.value else { return .failure(.examsNotArray) }
        var entries: [ReleaseEntry] = []
        var ids = Set<JSONString>()
        var files = Set<String>()
        for (number, item) in items.enumerated() {
            guard item.isObject else { return .failure(.badEntry(index: number, reason: "객체가 아니에요.")) }
            guard case .string(let id)? = item.member("id")?.value, !id.isBlankForJavaScript else {
                return .failure(.badEntry(index: number, reason: "id 가 비어 있어요."))
            }
            guard ids.insert(id).inserted else { return .failure(.badEntry(index: number, reason: "id 가 앞의 항목과 겹쳐요.")) }
            guard let rev = safeInteger(item.member("rev"), minimum: 1) else {
                return .failure(.badEntry(index: number, reason: "rev 는 1 이상의 정수여야 해요."))
            }
            guard case .string(let fileText)? = item.member("file")?.value, let file = fileText.ascii, isSafePath(file) else {
                return .failure(.badEntry(index: number, reason: "file 이 안전한 상대 경로가 아니에요."))
            }
            guard files.insert(file).inserted else { return .failure(.badEntry(index: number, reason: "file 이 앞의 항목과 겹쳐요.")) }
            guard case .string(let shaText)? = item.member("sha256")?.value, let sha = shaText.ascii, isSHA256Hex(sha) else {
                return .failure(.badEntry(index: number, reason: "sha256 은 16진수 소문자 64자여야 해요."))
            }
            entries.append(ReleaseEntry(id: id, rev: rev, file: file, sha256: sha))
        }
        let locks = Array(signed.bytes[locksNode.range])
        return .success(CheckedIndex(seq: signed.seq, issuedAt: issuedAt, entries: entries, locks: locks))
    }

    // MARK: 시험 파일

    /// 차례 6~7: 시험 파일의 SHA-256, 엄격한 UTF-8 의 JSON 객체, 파일 안의 id 와 rev 가 목록과 같은지.
    /// rev 는 웹의 revOf(rev 가 없거나 null 이면 1)와 같은 뜻으로 본다.
    static func examFile(_ bytes: [UInt8], for entry: ReleaseEntry) -> Result<Void, ReleaseProblem> {
        guard sha256Hex(bytes) == entry.sha256 else { return .failure(.examSHA256(file: entry.file)) }
        let root: JSONNode
        do {
            root = try StrictJSON.parse(bytes)
        } catch {
            return .failure(.examNotJSON(file: entry.file))
        }
        guard root.isObject else { return .failure(.examNotObject(file: entry.file)) }
        guard case .string(let id)? = root.member("id")?.value, id == entry.id else { return .failure(.examId(file: entry.file)) }
        guard revOf(root) == Double(entry.rev) else { return .failure(.examRev(file: entry.file)) }
        return .success(())
    }

    /// 시험 객체의 판 번호(웹의 revOf: exam.rev ?? 1). 숫자가 아니면 nil(웹에서는 글자 등이 와서 목록의 rev 와 같지 않다).
    static func revOf(_ exam: JSONNode) -> Double? {
        guard let rev = exam.member("rev") else { return 1 }
        switch rev.value {
        case .null: return 1
        case .number(let value): return value
        default: return nil
        }
    }

    /// 시험 객체의 id(웹에 넘기는 차례와 합치기에 쓴다).
    static func idOf(_ exam: JSONNode) -> JSONString? {
        guard case .string(let id)? = exam.member("id")?.value else { return nil }
        return id
    }

    // MARK: 모양 검사

    /// 자바스크립트의 Number.isSafeInteger(x) && x >= minimum.
    static func safeInteger(_ node: JSONNode?, minimum: Int) -> Int? {
        guard case .number(let value)? = node?.value, value.isFinite, value.rounded(.towardZero) == value,
              abs(value) <= ReleaseRules.maxSafeInteger, value >= Double(minimum)
        else { return nil }
        return Int(value)
    }

    /// 발행물의 안전한 경로(docs/시험_배포_규격.md 2-5, verify.ts 의 SAFE_PATH_RE): 200자까지, / 로 나눈 조각마다 영어 글자, 숫자,
    /// 밑줄, 붙임표로 시작하고 그 뒤에는 점도 올 수 있다. index.json 과 index.json.sig 는 안 된다.
    static func isSafePath(_ path: String) -> Bool {
        let bytes = Array(path.utf8)
        guard !bytes.isEmpty, bytes.count <= ReleaseRules.maxPathLength,
              path != ReleaseRules.indexFile, path != ReleaseRules.signatureFile
        else { return false }
        for segment in bytes.split(separator: UInt8(ascii: "/"), omittingEmptySubsequences: false) {
            guard let first = segment.first, isPathLead(first) else { return false }
            for byte in segment.dropFirst() where !(isPathLead(byte) || byte == UInt8(ascii: ".")) {
                return false
            }
        }
        return true
    }

    private static func isPathLead(_ byte: UInt8) -> Bool {
        switch byte {
        case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "_"), UInt8(ascii: "-"):
            return true
        default:
            return false
        }
    }

    static func isSHA256Hex(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        return bytes.count == 64 && bytes.allSatisfy { ($0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9")) || ($0 >= UInt8(ascii: "a") && $0 <= UInt8(ascii: "f")) }
    }

    /// 실제로 있는 "YYYY-MM-DDTHH:mm"(웹의 src/logic/dates.ts 의 isValidYmdHm 과 같다).
    static func isValidYmdHm(_ text: String) -> Bool {
        let b = Array(text.utf8)
        guard b.count == 16, b[4] == UInt8(ascii: "-"), b[7] == UInt8(ascii: "-"), b[10] == UInt8(ascii: "T"), b[13] == UInt8(ascii: ":") else {
            return false
        }
        func digits(_ range: Range<Int>) -> Int? {
            var value = 0
            for i in range {
                guard b[i] >= UInt8(ascii: "0"), b[i] <= UInt8(ascii: "9") else { return nil }
                value = value * 10 + Int(b[i] - UInt8(ascii: "0"))
            }
            return value
        }
        guard let y = digits(0..<4), let m = digits(5..<7), let d = digits(8..<10), let h = digits(11..<13), let mi = digits(14..<16) else {
            return false
        }
        guard y >= 1, (1...12).contains(m), d >= 1, h <= 23, mi <= 59 else { return false }
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
        let days: Int
        switch m {
        case 2: days = leap ? 29 : 28
        case 4, 6, 9, 11: days = 30
        default: days = 31
        }
        return d <= days
    }
}
