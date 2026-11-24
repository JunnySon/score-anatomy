import XCTest

/// 손가락 누름을 직접 만들어 보낸다(작업 지시서 3-2의 3-4). XCUITest 안에 있는 비공개 장치(XCPointerEventPath,
/// XCSynthesizedEventRecord)를 쓴다. XCUITest 의 doubleTap 도 안에서 같은 장치를 쓴다. 이 파일은 화면 테스트에만 있고
/// 앱에는 들어가지 않는다. 장치를 못 찾으면(Xcode 가 바뀌어 이름이 달라지면) unavailable 오류를 던진다.
///
/// 이 맥(Xcode 26.4.1, iOS 26.4 시뮬레이터)에서 2026-11-24 에 재 본 이 장치의 성질(웹이 받은 이벤트의 시각으로 잼):
/// - 한 기록 안의 손가락 길(누름 하나)은 앞 길이 끝나자마자 이어서 보낸다. 길마다 정한 시작 시각과 손가락 번호(index)는
///   지켜지지 않았다(1초로 정해도 손뗌에서 다음 누름까지 0ms). 그래서 한 기록에 누름 여럿을 넣으면 "아주 빠른 이어 누름"이 된다.
/// - 한 길 안에서는 시각이 지켜진다(누르고 있는 시간, 누른 채 움직임). 길 하나에서 떼었다 다시 누르는 것은 되지 않았다.
/// - 기록을 따로 보내면 누름 시작 사이가 0.28~0.30초 밑으로 내려가지 않았다. 앞 기록이 끝나기 전에 보낸 기록은 버려졌다.
/// 그래서 누름 시작 사이가 0.07초 남짓(아주 빠름)과 0.28초 사이인 두 번 누름은 만들 수 없다.
@MainActor
enum TouchSynth {
    /// 누름 하나: 누를 자리, 누르고 있는 시간(초), 누른 채 지나갈 점과 그 시각(누름 시작에서 잰 초, 끌기에 쓴다).
    struct Stroke {
        var point: CGPoint
        var hold: TimeInterval
        var moves: [(CGPoint, TimeInterval)]

        init(_ point: CGPoint, hold: TimeInterval = 0.05, moves: [(CGPoint, TimeInterval)] = []) {
            self.point = point
            self.hold = hold
            self.moves = moves
        }
    }

    enum Failure: Error, CustomStringConvertible {
        case unavailable(String)
        case synthesizeFailed

        var description: String {
            switch self {
            case .unavailable(let name): return "XCUITest 의 누름 만들기 장치를 찾지 못함: \(name)"
            case .synthesizeFailed: return "누름 만들기가 실패함"
            }
        }
    }

    private typealias InitTouch = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
    private typealias AtOffset = @convention(c) (AnyObject, Selector, Double) -> Void
    private typealias MoveTo = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
    private typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
    private typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
    private typealias Synthesize = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer?) -> Bool

    private static func instance(of className: String) throws -> NSObject {
        guard let cls = NSClassFromString(className) else { throw Failure.unavailable(className) }
        guard let made = (cls as AnyObject).perform(NSSelectorFromString("alloc"))?.takeUnretainedValue() as? NSObject else {
            throw Failure.unavailable("\(className) alloc")
        }
        return made
    }

    private static func method<T>(_ object: NSObject, _ name: String, as type: T.Type) throws -> (Selector, T) {
        let selector = NSSelectorFromString(name)
        guard object.responds(to: selector) else { throw Failure.unavailable(name) }
        return (selector, unsafeBitCast(object.method(for: selector), to: type))
    }

    /// 장치가 있는지만 본다(누르지 않는다).
    static var isAvailable: Bool {
        guard let pathClass = NSClassFromString("XCPointerEventPath") as? NSObject.Type,
              let recordClass = NSClassFromString("XCSynthesizedEventRecord") as? NSObject.Type else { return false }
        return pathClass.instancesRespond(to: NSSelectorFromString("initForTouchAtPoint:offset:"))
            && pathClass.instancesRespond(to: NSSelectorFromString("liftUpAtOffset:"))
            && pathClass.instancesRespond(to: NSSelectorFromString("moveToPoint:atOffset:"))
            && recordClass.instancesRespond(to: NSSelectorFromString("initWithName:interfaceOrientation:"))
            && recordClass.instancesRespond(to: NSSelectorFromString("addPointerEventPath:"))
            && recordClass.instancesRespond(to: NSSelectorFromString("synthesizeWithError:"))
    }

    /// 누름 여럿을 한 기록으로 보낸다. 위에 적은 성질 때문에 누름 사이의 틈은 0ms 다(아주 빠르게 이어 누름).
    /// 누름이 모두 끝난 뒤에 돌아온다. 세로 화면만 쓴다(앱이 세로 고정).
    static func burst(_ strokes: [Stroke], name: String = "sa-burst") throws {
        guard !strokes.isEmpty else { return }
        let rawRecord = try instance(of: "XCSynthesizedEventRecord")
        let (initRecordSel, initRecord) = try method(rawRecord, "initWithName:interfaceOrientation:", as: InitRecord.self)
        guard let record = initRecord(rawRecord, initRecordSel, name as NSString, UIInterfaceOrientation.portrait.rawValue) as? NSObject else {
            throw Failure.unavailable("XCSynthesizedEventRecord init")
        }
        let (addSel, add) = try method(record, "addPointerEventPath:", as: AddPath.self)
        var start = 0.0
        for stroke in strokes {
            let rawPath = try instance(of: "XCPointerEventPath")
            let (initSel, initTouch) = try method(rawPath, "initForTouchAtPoint:offset:", as: InitTouch.self)
            guard let path = initTouch(rawPath, initSel, stroke.point, start) as? NSObject else {
                throw Failure.unavailable("XCPointerEventPath init")
            }
            if !stroke.moves.isEmpty {
                let (moveSel, move) = try method(path, "moveToPoint:atOffset:", as: MoveTo.self)
                for (point, time) in stroke.moves { move(path, moveSel, point, start + time) }
            }
            let (liftSel, lift) = try method(path, "liftUpAtOffset:", as: AtOffset.self)
            lift(path, liftSel, start + stroke.hold)
            add(record, addSel, path)
            start += stroke.hold + 0.01
        }
        let (synthSel, synthesize) = try method(record, "synthesizeWithError:", as: Synthesize.self)
        guard synthesize(record, synthSel, nil) else { throw Failure.synthesizeFailed }
    }

    /// 한 번 누른다(기록 하나).
    static func tap(at point: CGPoint, hold: TimeInterval = 0.05) throws {
        try burst([Stroke(point, hold: hold)], name: "sa-tap")
    }

    /// 같은 자리를 두 번 누르되 누름 시작 사이를 interval 에 맞춰 기다린다. 기록을 따로 보내서 0.28초쯤보다 짧게는
    /// 만들 수 없다(interval 이 그보다 짧으면 가장 짧은 간격이 된다). 실제 간격은 웹이 받은 이벤트로 잰다.
    static func spacedTaps(at point: CGPoint, interval: TimeInterval) throws {
        let started = Date()
        try tap(at: point)
        let wait = interval - Date().timeIntervalSince(started)
        if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        try tap(at: point)
    }
}
