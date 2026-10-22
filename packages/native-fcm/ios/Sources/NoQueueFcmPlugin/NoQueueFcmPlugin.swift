import Capacitor
import FirebaseCore
import FirebaseMessaging
import Foundation
import UserNotifications

// Does not take ownership of UNUserNotificationCenter or the Capacitor notification
// router. The existing PushNotifications plugin remains responsible for UI/events.
@objc(NoQueueFcmPlugin)
public class NoQueueFcmPlugin: CAPPlugin, CAPBridgedPlugin, MessagingDelegate {
    public let identifier = "NoQueueFcmPlugin"
    public let jsName = "NoQueueFcm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private lazy var driver = FirebaseFcmDriver(delegate: self)
    private lazy var session = FcmSession(driver: driver)
    private var operation = 0
    override public func load() {
        // No FirebaseApp.configure(), APNs registration or token fetch at load.
        session.onToken = { [weak self] token in self?.notifyListeners("tokenReceived", data: ["token": token]) }
        session.onError = { [weak self] in self?.notifyListeners("tokenError", data: ["code": "fcm_registration_failed"]) }
        NotificationCenter.default.addObserver(self, selector: #selector(receivedAPNs(_:)), name: .capacitorDidRegisterForRemoteNotifications, object: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    @objc func availability(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["available": self.available, "initialized": self.driver.initialized]) }
    }
    private var available: Bool {
        getConfig().getBoolean("enabled", false) && FirebaseFcmDriver.validOptions() != nil
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.operation += 1
            let operation = self.operation
            guard self.available else { call.reject("fcm_unavailable"); return }
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                DispatchQueue.main.async {
                    guard self.operation == operation else { call.reject("fcm_cancelled"); return }
                    guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else {
                        call.reject("fcm_permission_required"); return
                    }
                    do { try self.session.start(available: self.available); call.resolve() }
                    catch { call.reject("fcm_unavailable") }
                }
            }
        }
    }
    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.operation += 1; self.session.pause(); call.resolve() }
    }
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.operation += 1
            self.session.stop { error in
                if error != nil { call.reject("fcm_revocation_failed") } else { call.resolve() }
            }
        }
    }
    @objc private func receivedAPNs(_ notification: Notification) {
        guard let token = notification.object as? Data else { return }
        DispatchQueue.main.async { self.session.receivedAPNs(token) }
    }
    public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        DispatchQueue.main.async { self.session.rotated(fcmToken) }
    }
}

private final class FirebaseFcmDriver: FcmDriver {
    private weak var delegate: MessagingDelegate?
    init(delegate: MessagingDelegate) { self.delegate = delegate }
    var initialized: Bool { FirebaseApp.app() != nil }
    static func validOptions() -> FirebaseOptions? {
        // Client configuration is NOT a service-account key. Reject other projects,
        // missing files and accidental Analytics enablement before initializing SDK.
        guard let file = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: file),
              options.projectID == "nq-app-f3127", options.bundleID == "com.noqueue-app.ios",
              options.gcmSenderID == "54689871019",
              options.googleAppID.range(of: "^1:54689871019:ios:[a-fA-F0-9]+$", options: .regularExpression) != nil,
              options.apiKey?.range(of: "^AIza[A-Za-z0-9_-]{35}$", options: .regularExpression) != nil,
              Bundle.main.bundleIdentifier == options.bundleID,
              Bundle.main.object(forInfoDictionaryKey: "FirebaseMessagingAutoInitEnabled") as? Bool == false,
              Bundle.main.object(forInfoDictionaryKey: "FirebaseAppDelegateProxyEnabled") as? Bool == false,
              Bundle.main.object(forInfoDictionaryKey: "FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED") as? Bool == true else { return nil }
        return options
    }
    func configure() throws {
        guard let options = Self.validOptions() else { throw FcmSessionError.unavailable }
        if let existing = FirebaseApp.app() {
            guard existing.options.googleAppID == options.googleAppID else { throw FcmSessionError.unavailable }
        } else {
            FirebaseConfiguration.shared.setLoggerLevel(.error)
            FirebaseApp.configure(options: options)
        }
        // Never persist auto-init=true: no token generation on a later disabled boot.
        Messaging.messaging().isAutoInitEnabled = false
        Messaging.messaging().delegate = delegate
    }
    func bindAPNs(_ token: Data) { Messaging.messaging().apnsToken = token }
    func fetchToken(_ completion: @escaping (String?, Error?) -> Void) {
        Messaging.messaging().token { token, error in DispatchQueue.main.async { completion(token, error) } }
    }
    func deleteToken(_ completion: @escaping (Error?) -> Void) {
        Messaging.messaging().isAutoInitEnabled = false
        Messaging.messaging().deleteToken { error in DispatchQueue.main.async { completion(error) } }
    }
}
