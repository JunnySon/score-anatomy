import Foundation

/// 엄격한 JSON 읽기(docs/시험_배포_규격.md 3장). 받은 발행물(index.json, 시험 파일)을 웹의 JSON.parse 와 같은 뜻으로 읽는다.
///
/// - 바이트는 엄격한 UTF-8 이어야 한다(웹의 TextDecoder('utf-8', { fatal: true }) 와 같다). 맨 앞의 BOM 은 빈칸이 아니라서 읽지 못한다.
/// - 문법은 RFC 8259 그대로다: 빈칸은 공백, 탭, LF, CR 만, 숫자는 앞자리 0 이나 + 를 받지 않고, 글자 안의 제어 문자(U+0000~U+001F)는
///   이스케이프해야 한다. 값 뒤에 빈칸 말고 다른 것이 오면 틀린 것이다.
/// - 글자는 자바스크립트처럼 UTF-16 코드 단위로 둔다(짝 없는 서로게이트 \uD800 같은 것도 그대로 견줄 수 있게).
/// - 숫자는 자바스크립트처럼 Double 로 읽는다(1e400 은 무한대).
/// - 객체에 같은 키가 둘 이상이면 JSON.parse 처럼 마지막 것을 쓴다.
/// - 값마다 원본 바이트 안의 자리(range)를 남겨서, 넘겨받은 바이트를 다시 직렬화하지 않고 그대로 웹에 넘길 수 있게 한다.
/// - 깊이는 maxDepth 까지만 받는다(재귀가 스택을 넘지 않게). 발행 도구에는 같은 깊이 제한이 없어 더 깊은 발행물은 여기서 거부한다.
enum StrictJSON {
    static let maxDepth = 64

    enum Failure: Error, Equatable, Sendable {
        /// 엄격한 UTF-8 이 아니다.
        case notUTF8
        /// 문법이 틀렸다(바이트 자리).
        case syntax(at: Int)
        /// 너무 깊다.
        case tooDeep
    }

    /// 바이트 전체가 JSON 값 하나인지 읽는다.
    static func parse(_ bytes: [UInt8]) throws(Failure) -> JSONNode {
        guard String(validating: bytes, as: UTF8.self) != nil else { throw .notUTF8 }
        var parser = Parser(bytes: bytes)
        parser.skipSpace()
        let node = try parser.value(depth: 0)
        parser.skipSpace()
        guard parser.index == bytes.count else { throw .syntax(at: parser.index) }
        return node
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        init(bytes: [UInt8]) {
            self.bytes = bytes
        }

        mutating func skipSpace() {
            while index < bytes.count {
                switch bytes[index] {
                case 0x20, 0x09, 0x0A, 0x0D:
                    index += 1
                default:
                    return
                }
            }
        }

        mutating func value(depth: Int) throws(Failure) -> JSONNode {
            guard index < bytes.count else { throw .syntax(at: index) }
            let start = index
            switch bytes[index] {
            case UInt8(ascii: "{"):
                return try object(depth: depth + 1)
            case UInt8(ascii: "["):
                return try array(depth: depth + 1)
            case UInt8(ascii: "\""):
                let text = try string()
                return JSONNode(value: .string(text), range: start..<index)
            case UInt8(ascii: "t"):
                try literal("true")
                return JSONNode(value: .bool(true), range: start..<index)
            case UInt8(ascii: "f"):
                try literal("false")
                return JSONNode(value: .bool(false), range: start..<index)
            case UInt8(ascii: "n"):
                try literal("null")
                return JSONNode(value: .null, range: start..<index)
            case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"):
                let number = try self.number()
                return JSONNode(value: .number(number), range: start..<index)
            default:
                throw .syntax(at: index)
            }
        }

        mutating func object(depth: Int) throws(Failure) -> JSONNode {
            guard depth <= StrictJSON.maxDepth else { throw .tooDeep }
            let start = index
            index += 1
            var members: [JSONMember] = []
            skipSpace()
            if index < bytes.count, bytes[index] == UInt8(ascii: "}") {
                index += 1
                return JSONNode(value: .object(members), range: start..<index)
            }
            while true {
                skipSpace()
                guard index < bytes.count, bytes[index] == UInt8(ascii: "\"") else { throw .syntax(at: index) }
                let key = try string()
                skipSpace()
                guard index < bytes.count, bytes[index] == UInt8(ascii: ":") else { throw .syntax(at: index) }
                index += 1
                skipSpace()
                let node = try value(depth: depth)
                members.append(JSONMember(key: key, node: node))
                skipSpace()
                guard index < bytes.count else { throw .syntax(at: index) }
                if bytes[index] == UInt8(ascii: ",") {
                    index += 1
                    continue
                }
                guard bytes[index] == UInt8(ascii: "}") else { throw .syntax(at: index) }
                index += 1
                return JSONNode(value: .object(members), range: start..<index)
            }
        }

        mutating func array(depth: Int) throws(Failure) -> JSONNode {
            guard depth <= StrictJSON.maxDepth else { throw .tooDeep }
            let start = index
            index += 1
            var items: [JSONNode] = []
            skipSpace()
            if index < bytes.count, bytes[index] == UInt8(ascii: "]") {
                index += 1
                return JSONNode(value: .array(items), range: start..<index)
            }
            while true {
                skipSpace()
                items.append(try value(depth: depth))
                skipSpace()
                guard index < bytes.count else { throw .syntax(at: index) }
                if bytes[index] == UInt8(ascii: ",") {
                    index += 1
                    continue
                }
                guard bytes[index] == UInt8(ascii: "]") else { throw .syntax(at: index) }
                index += 1
                return JSONNode(value: .array(items), range: start..<index)
            }
        }

        mutating func literal(_ word: StaticString) throws(Failure) {
            let count = word.utf8CodeUnitCount
            guard index + count <= bytes.count else { throw .syntax(at: index) }
            let expected = UnsafeBufferPointer(start: word.utf8Start, count: count)
            for offset in 0..<count where bytes[index + offset] != expected[offset] {
                throw .syntax(at: index + offset)
            }
            index += count
        }

        /// 숫자: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
        mutating func number() throws(Failure) -> Double {
            let start = index
            if bytes[index] == UInt8(ascii: "-") { index += 1 }
            guard index < bytes.count else { throw .syntax(at: index) }
            if bytes[index] == UInt8(ascii: "0") {
                index += 1
            } else if isDigit(bytes[index]) {
                while index < bytes.count, isDigit(bytes[index]) { index += 1 }
            } else {
                throw .syntax(at: index)
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
                index += 1
                guard index < bytes.count, isDigit(bytes[index]) else { throw .syntax(at: index) }
                while index < bytes.count, isDigit(bytes[index]) { index += 1 }
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: "e") || bytes[index] == UInt8(ascii: "E") {
                index += 1
                if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
                guard index < bytes.count, isDigit(bytes[index]) else { throw .syntax(at: index) }
                while index < bytes.count, isDigit(bytes[index]) { index += 1 }
            }
            let text = String(decoding: bytes[start..<index], as: UTF8.self)
            // Double(String) 은 가장 가까운 값으로 반올림하고, 너무 크면 무한대가 된다(자바스크립트의 Number 와 같다).
            guard let value = Double(text) else { throw .syntax(at: start) }
            return value
        }

        /// 글자 하나를 읽어 UTF-16 코드 단위로 돌려준다. index 는 여는 따옴표에 있어야 한다.
        mutating func string() throws(Failure) -> JSONString {
            index += 1
            var units: [UInt16] = []
            while true {
                guard index < bytes.count else { throw .syntax(at: index) }
                let byte = bytes[index]
                switch byte {
                case UInt8(ascii: "\""):
                    index += 1
                    return JSONString(units: units)
                case UInt8(ascii: "\\"):
                    index += 1
                    guard index < bytes.count else { throw .syntax(at: index) }
                    let escape = bytes[index]
                    index += 1
                    switch escape {
                    case UInt8(ascii: "\""): units.append(0x22)
                    case UInt8(ascii: "\\"): units.append(0x5C)
                    case UInt8(ascii: "/"): units.append(0x2F)
                    case UInt8(ascii: "b"): units.append(0x08)
                    case UInt8(ascii: "f"): units.append(0x0C)
                    case UInt8(ascii: "n"): units.append(0x0A)
                    case UInt8(ascii: "r"): units.append(0x0D)
                    case UInt8(ascii: "t"): units.append(0x09)
                    case UInt8(ascii: "u"):
                        guard index + 4 <= bytes.count else { throw .syntax(at: index) }
                        var unit: UInt16 = 0
                        for offset in 0..<4 {
                            guard let digit = hexValue(bytes[index + offset]) else { throw .syntax(at: index + offset) }
                            unit = unit << 4 | UInt16(digit)
                        }
                        index += 4
                        units.append(unit)
                    default:
                        throw .syntax(at: index - 1)
                    }
                case 0x00..<0x20:
                    // 이스케이프하지 않은 제어 문자는 JSON 이 아니다.
                    throw .syntax(at: index)
                case 0x00..<0x80:
                    units.append(UInt16(byte))
                    index += 1
                default:
                    // 여러 바이트 글자. 바이트 전체를 미리 엄격한 UTF-8 로 확인했으니 모양이 맞다.
                    let (scalar, length) = decodeScalar(at: index)
                    index += length
                    units.append(contentsOf: String(scalar).utf16)
                }
            }
        }

        private func decodeScalar(at start: Int) -> (Unicode.Scalar, Int) {
            let lead = bytes[start]
            let length: Int
            var value: UInt32
            if lead >= 0xF0 {
                length = 4
                value = UInt32(lead & 0x07)
            } else if lead >= 0xE0 {
                length = 3
                value = UInt32(lead & 0x0F)
            } else {
                length = 2
                value = UInt32(lead & 0x1F)
            }
            for offset in 1..<length {
                value = value << 6 | UInt32(bytes[start + offset] & 0x3F)
            }
            return (Unicode.Scalar(value) ?? "\u{FFFD}", length)
        }

        private func isDigit(_ byte: UInt8) -> Bool {
            byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9")
        }

        private func hexValue(_ byte: UInt8) -> UInt8? {
            switch byte {
            case UInt8(ascii: "0")...UInt8(ascii: "9"): return byte - UInt8(ascii: "0")
            case UInt8(ascii: "a")...UInt8(ascii: "f"): return byte - UInt8(ascii: "a") + 10
            case UInt8(ascii: "A")...UInt8(ascii: "F"): return byte - UInt8(ascii: "A") + 10
            default: return nil
            }
        }
    }
}

/// JSON 값 하나와 원본 바이트 안의 자리.
struct JSONNode: Sendable {
    let value: JSONValue
    /// 원본 바이트 안에서 이 값이 차지하는 자리(앞뒤 빈칸은 빼고).
    let range: Range<Int>

    /// 객체의 칸. 같은 키가 둘 이상이면 마지막 것(JSON.parse 와 같다). 객체가 아니거나 없으면 nil.
    func member(_ key: String) -> JSONNode? {
        guard case .object(let members) = value else { return nil }
        let units = Array(key.utf16)
        return members.last(where: { $0.key.units == units })?.node
    }

    var isObject: Bool {
        if case .object = value { return true }
        return false
    }
}

indirect enum JSONValue: Sendable {
    case object([JSONMember])
    case array([JSONNode])
    case string(JSONString)
    case number(Double)
    case bool(Bool)
    case null
}

struct JSONMember: Sendable {
    let key: JSONString
    let node: JSONNode
}

/// JSON 글자. 자바스크립트의 글자처럼 UTF-16 코드 단위로 둔다.
struct JSONString: Sendable, Hashable {
    let units: [UInt16]

    init(units: [UInt16]) {
        self.units = units
    }

    init(_ text: String) {
        units = Array(text.utf16)
    }

    /// 사람이 읽는 글자(짝 없는 서로게이트는 U+FFFD 로 바뀐다). 견줄 때는 units 를 쓴다.
    var text: String {
        String(decoding: units, as: UTF16.self)
    }

    /// 영어 글자와 숫자 같은 ASCII 로만 되어 있으면 그 글자. 아니면 nil.
    var ascii: String? {
        guard units.allSatisfy({ $0 < 0x80 }) else { return nil }
        return String(decoding: units.map { UInt8($0) }, as: UTF8.self)
    }

    /// 자바스크립트의 String.prototype.trim 이 지우는 빈칸(WhiteSpace 와 LineTerminator)만으로 되어 있는지.
    var isBlankForJavaScript: Bool {
        units.allSatisfy(Self.isJavaScriptSpace)
    }

    static func isJavaScriptSpace(_ unit: UInt16) -> Bool {
        switch unit {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }
}
