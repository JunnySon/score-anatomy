import UIKit

/// 앱이 뒤로 가거나 끝날 때 쓰던 저장이 끝나도록 시스템에 시간을 요청하는 일. 단위 테스트가 가짜로 바꿀 수 있게 따로 둔다.
@MainActor
protocol BackgroundTasking: AnyObject {
    func begin(name: String, expiration: @escaping @MainActor () -> Void) -> UIBackgroundTaskIdentifier
    func end(_ identifier: UIBackgroundTaskIdentifier)
}

/// UIApplication 의 백그라운드 작업.
@MainActor
final class AppBackgroundTasks: BackgroundTasking {
    func begin(name: String, expiration: @escaping @MainActor () -> Void) -> UIBackgroundTaskIdentifier {
        UIApplication.shared.beginBackgroundTask(withName: name) {
            MainActor.assumeIsolated { expiration() }
        }
    }

    func end(_ identifier: UIBackgroundTaskIdentifier) {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
    }
}

/// 저장 하나가 끝날 때까지 잡아 두는 시간. 끝나거나 시간이 다 되면 한 번만 놓는다.
@MainActor
final class BackgroundTicket {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    private weak var tasks: BackgroundTasking?

    init(tasks: BackgroundTasking, name: String) {
        self.tasks = tasks
        identifier = tasks.begin(name: name) { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        tasks?.end(identifier)
        identifier = .invalid
    }
}
