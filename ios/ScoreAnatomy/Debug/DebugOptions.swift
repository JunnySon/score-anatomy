#if DEBUG
import Foundation

// 시험과 캡처에만 쓰는 장치(DEBUG 빌드 전용).
// 이 폴더의 파일은 Release 빌드에서 통째로 빠진다(project.yml 의 EXCLUDED_SOURCE_FILE_NAMES: Debug*.swift).
// 파일 안도 #if DEBUG 로 감싸 두어서, 실수로 빌드에 들어가도 Release 에서는 코드가 생기지 않는다.

/// DEBUG 전용 실행 인자.
///
/// - `-SAStoreDir <폴더>`: 기록 파일(store.json)을 둘 폴더. 없으면 Application Support/번들 ID.
/// - `-SASeed <이름>`: 켜기 전에 정해 둔 기록을 심는다. empty(지움), unreadable(글자가 아닌 바이트), future(더 높은 version).
/// - `-SAProbeDir <폴더>`: 탐침 결과와 명령 파일을 두는 폴더. 있으면 명령 파일(cmd-번호.js)을 받아 웹뷰에서 돌린다.
/// - `-SAProbe <이름,이름>`: 화면이 그려진 뒤 한 번 돌리는 탐침. network(차단 확인), state(웹 환경).
/// - `-SAProbePort <번호>`: network 탐침이 부르는 주소(127.0.0.1)의 포트.
/// - `-SAProbeControl`: 차단 규칙을 걸지 않는다. 탐침이 새는 요청을 잡아내는지 보는 대조 실행에만 쓴다.
/// - `-SAForceLoadFailure`: 묶음 대신 없는 파일을 연다(불러오기 실패 안내 확인).
/// - `-SAAppearance <light|dark>`: 앱의 밝기를 정해 둔다(캡처용). 이 맥의 시뮬레이터에서는 시스템 밝기 바꾸기가 앱에 닿지 않았다.
/// - `-SAEventLog`: 웹이 받는 손가락 이벤트와 click 을 문서가 열리기 전부터 window.__saEventLog 에 적는다(작업 지시서 3-2의 3-4).
/// - `-SAExamURL <주소>`: 시험 자료를 받는 주소. 시험 서버(http://127.0.0.1)도 받는다(작업 지시서 4의 3-3). Release 에는 이 장치가 없다.
/// - `-SAExamKeyFile <파일>`: 믿는 공개 키 파일(테스트 전용 공개 키 등). Release 의 공개 키는 exam-data/public-key.txt 하나뿐이다.
/// - `-SAExamInterval <초>`: 앞으로 돌아왔을 때 다시 받기까지의 간격(기본 300초, 화면 테스트가 줄여 쓴다).
struct DebugOptions: Sendable {
    var storeDirectory: URL?
    var seed: String?
    var probeDirectory: URL?
    var probes: Set<String> = []
    var probePort: Int?
    var probeControl = false
    var forceLoadFailure = false
    var appearance: String?
    var eventLog = false
    var examURL: String?
    var examKeyFile: URL?
    var examInterval: TimeInterval?

    static func parse(_ arguments: [String]) -> DebugOptions {
        var options = DebugOptions()
        var index = 1
        while index < arguments.count {
            let key = arguments[index]
            let value: String? = index + 1 < arguments.count ? arguments[index + 1] : nil
            switch key {
            case "-SAStoreDir":
                if let value { options.storeDirectory = URL(fileURLWithPath: value, isDirectory: true) }
                index += 1
            case "-SASeed":
                options.seed = value
                index += 1
            case "-SAProbeDir":
                if let value { options.probeDirectory = URL(fileURLWithPath: value, isDirectory: true) }
                index += 1
            case "-SAProbe":
                if let value {
                    options.probes.formUnion(value.split(separator: ",").map { String($0) })
                }
                index += 1
            case "-SAProbePort":
                options.probePort = value.flatMap { Int($0) }
                index += 1
            case "-SAProbeControl":
                options.probeControl = true
            case "-SAForceLoadFailure":
                options.forceLoadFailure = true
            case "-SAAppearance":
                options.appearance = value
                index += 1
            case "-SAEventLog":
                options.eventLog = true
            case "-SAExamURL":
                options.examURL = value
                index += 1
            case "-SAExamKeyFile":
                if let value { options.examKeyFile = URL(fileURLWithPath: value) }
                index += 1
            case "-SAExamInterval":
                options.examInterval = value.flatMap { TimeInterval($0) }
                index += 1
            default:
                break
            }
            index += 1
        }
        return options
    }

    /// 받는 주소와 공개 키. 실행 인자로 준 것이 있으면 그것을 쓴다(주소가 틀렸거나 키 파일을 읽지 못하면 없는 것으로).
    func remoteSettings(fallback: RemoteSettings) -> RemoteSettings {
        let location: RemoteLocation? = examURL.map { RemoteLocation($0, allowLoopbackHTTP: true) } ?? fallback.location
        let key: [UInt8]? = examKeyFile.map { url in
            (try? Data(contentsOf: url)).flatMap { ReleaseCheck.publicKeyBytes(fromFile: Array($0)) }
        } ?? fallback.publicKey
        return RemoteSettings(location: location, publicKey: key)
    }
}

/// 정해 둔 기록 심기.
enum DebugSeeds {
    static func apply(_ name: String, to store: StoreFile) {
        let manager = FileManager.default
        try? manager.createDirectory(at: store.directory, withIntermediateDirectories: true)
        switch name {
        case "empty":
            try? manager.removeItem(at: store.fileURL)
        case "unreadable":
            // UTF-8 로 읽을 수 없는 바이트. 껍데기는 store 에 빈 글자를 넣고, 웹은 보관을 먼저 요청한다.
            try? Data([0xFF, 0xFE, 0xFD, 0x80, 0x81, 0x7B]).write(to: store.fileURL)
        case "future":
            // 웹이 아는 것보다 높은 version. 웹은 덮어쓰지 않고 보관을 먼저 요청한다.
            try? Data(#"{"version":99,"sessions":[]}"#.utf8).write(to: store.fileURL)
        default:
            break
        }
    }
}
#endif
