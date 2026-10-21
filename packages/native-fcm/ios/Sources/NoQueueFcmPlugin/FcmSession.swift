import Foundation

// Single-threaded (main queue) lifecycle. Testable without Firebase, credentials or network.
protocol FcmDriver: AnyObject {
    var initialized: Bool { get }
    func configure() throws
    func bindAPNs(_ token: Data)
    func fetchToken(_ completion: @escaping (String?, Error?) -> Void)
    func deleteToken(_ completion: @escaping (Error?) -> Void)
}
enum FcmSessionError: Error { case unavailable, stopping }
final class FcmSession {
    private let driver: FcmDriver
    private var active = false, bound = false, validated = false, stopping = false
    private var generation = 0
    private var lastToken: String?
    var onToken: (String) -> Void = { _ in }
    var onError: () -> Void = {}
    init(driver: FcmDriver) { self.driver = driver }
    func start(available: Bool) throws {
        guard available else { throw FcmSessionError.unavailable }
        guard !stopping else { throw FcmSessionError.stopping }
        generation += 1
        active = false; bound = false; validated = false; lastToken = nil
        try driver.configure()
        active = true
    }
    func receivedAPNs(_ token: Data) {
        guard active else { return }
        bound = true
        driver.bindAPNs(token)
        let requestGeneration = generation
        driver.fetchToken { [weak self] token, error in
            guard let self, self.active, requestGeneration == self.generation else { return }
            guard error == nil, let token, !token.isEmpty else { self.onError(); return }
            self.validated = true
            self.emit(token)
        }
    }
    func rotated(_ token: String?) {
        guard active, bound, validated, let token else { return }
        emit(token)
    }
    private func emit(_ token: String) {
        guard !token.isEmpty, token != lastToken else { return }
        lastToken = token
        onToken(token)
    }
    func pause() {
        // Disposal suppresses callbacks, but is NOT a user revocation.
        generation += 1; active = false; bound = false; validated = false; lastToken = nil
    }
    func stop(_ completion: @escaping (Error?) -> Void) {
        pause()
        guard !stopping else { completion(FcmSessionError.stopping); return }
        guard driver.initialized else { completion(nil); return }
        stopping = true
        driver.deleteToken { [weak self] error in
            self?.stopping = false
            completion(error)
        }
    }
}
