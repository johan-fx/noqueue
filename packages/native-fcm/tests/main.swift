import Foundation

final class FakeFcm: FcmDriver {
    var initialized = false, configured = 0, bound = 0, deleted = 0
    var failConfiguration = false
    var fetches: [(String?, Error?) -> Void] = []
    var deletion: ((Error?) -> Void)?
    func configure() throws {
        configured += 1
        if failConfiguration { throw FcmSessionError.unavailable }
        initialized = true
    }
    func bindAPNs(_ token: Data) { bound += 1 }
    func fetchToken(_ completion: @escaping (String?, Error?) -> Void) { fetches.append(completion) }
    func deleteToken(_ completion: @escaping (Error?) -> Void) { deleted += 1; deletion = completion }
}
var checks = 0
func check(_ value: Bool) { precondition(value, "FCM lifecycle assertion failed"); checks += 1 }
func rejects(_ action: () throws -> Void) { do { try action(); preconditionFailure("Must reject") } catch { checks += 1 } }
let driver = FakeFcm()
// Loading, unavailable start and stopping an uninitialized bridge cause NO SDK IO.
let f = FcmSession(driver: driver)
var received: [String] = [], errors = 0
f.onToken = { received.append($0) }; f.onError = { errors += 1 }
check(driver.configured == 0)
rejects { try f.start(available: false) }
f.receivedAPNs(Data([1])); f.rotated("early"); f.stop { check($0 == nil) }
check(driver.configured == 0 && driver.deleted == 0 && driver.fetches.isEmpty)
// APNs must be bound and an explicit token fetch confirmed before rotation events.
try f.start(available: true)
f.rotated("cached-before-apns"); check(received.isEmpty)
f.receivedAPNs(Data([1])); check(driver.bound == 1 && driver.fetches.count == 1)
f.rotated("cached-during-fetch"); check(received.isEmpty)
driver.fetches[0]("MiXeD_fcm:token", nil)
f.rotated("MiXeD_fcm:token"); check(received == ["MiXeD_fcm:token"])
f.rotated("Rotated_token"); check(received.last == "Rotated_token")
// Refresh on resume can resend the same token to refresh server updated_at.
try f.start(available: true); f.receivedAPNs(Data([2])); driver.fetches[1]("Rotated_token", nil)
check(received.count == 3)
// Pending old-generation results cannot restore registration after stop/restart.
try f.start(available: true); f.receivedAPNs(Data([3]))
f.stop { check($0 == nil) }; check(driver.deleted == 1)
rejects { try f.start(available: true) }
driver.fetches[2]("late-after-disable", nil); f.rotated("late-rotation"); check(received.count == 3)
driver.deletion?(nil)
try f.start(available: true); f.receivedAPNs(Data([4])); driver.fetches[2]("late-from-previous-session", nil)
check(received.count == 3)
driver.fetches[3](nil, FcmSessionError.unavailable); check(errors == 1)
driver.fetches[3]("new-token", nil); check(received.last == "new-token")
f.pause(); f.rotated("paused"); check(received.last == "new-token" && driver.deleted == 1)
// Failed deletion remains retryable and configuration failure never makes us active.
f.stop { check($0 != nil) }; driver.deletion?(FcmSessionError.unavailable)
f.stop { check($0 == nil) }; driver.deletion?(nil); check(driver.deleted == 3)
driver.failConfiguration = true
rejects { try f.start(available: true) }; f.receivedAPNs(Data([5])); check(driver.fetches.count == 4)
print("FCM lifecycle: \(checks) assertions passed; synthetic driver, no Firebase initialization/network")
